#!/usr/bin/env node
/**
 * Phase 3 — Idempotent remap script.
 *
 * Audits every question currently attached to a generic bucket and
 * attempts to resolve it to a real syllabus topic via a 6-stage
 * pipeline. Safe to re-run; only writes when --apply is supplied.
 *
 * Usage:
 *   node scripts/remapTopicQuestions.js --dry-run
 *   node scripts/remapTopicQuestions.js --dry-run --subject=biology
 *   node scripts/remapTopicQuestions.js --apply
 *   node scripts/remapTopicQuestions.js --apply --limit=500
 *
 * Logs one [TOPIC_REMAP] line per write decision.
 *
 * Expects in the ProxiNG repo:
 *   ../db.js           — pg Pool
 *   ../aiClient.js     — classifyTopic(subject, stem) -> { topic_id, confidence }
 *   ./topicKeywords.json
 */
const path = require("path");
const fs = require("fs");
const db = require("../../db");
let aiClient = null;
try { aiClient = require("../../aiClient"); } catch (_) { aiClient = null; }
const { isGenericTopic } = require("../genericTopics");

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const arg = (k) => {
  const hit = argv.find((a) => a.startsWith(k + "="));
  return hit ? hit.split("=")[1] : null;
};
const APPLY = flag("--apply");
const DRY = !APPLY || flag("--dry-run");
const SUBJECT = arg("--subject");
const LIMIT = Number(arg("--limit") || 0) || null;
const MIN_AI_CONFIDENCE = 0.75;

const KEYWORDS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "topicKeywords.json"), "utf8"));
  } catch (_) { return {}; }
})();

async function loadSyllabusTopicsBySubject() {
  const { rows } = await db.query(`
    SELECT t.id, t.name, t.subject_id, s.name AS subject
      FROM topics t JOIN subjects s ON s.id = t.subject_id
     WHERE COALESCE(t.is_active, true)
  `);
  const bySubject = new Map();
  for (const r of rows) {
    if (isGenericTopic(r.name)) continue;
    const key = r.subject.toLowerCase();
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(r);
  }
  return bySubject;
}

function findTopicByName(topicsForSubject, name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return topicsForSubject.find((t) => t.name.toLowerCase() === n) || null;
}

function scoreKeywords(subject, stem) {
  const list = KEYWORDS[subject.toLowerCase()] || [];
  const text = String(stem || "").toLowerCase();
  let best = null;
  for (const entry of list) {
    let hits = 0;
    for (const kw of entry.keywords || []) {
      if (text.includes(String(kw).toLowerCase())) hits++;
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { topic: entry.topic, hits };
  }
  return best;
}

async function resolveTopic(q, topicsBySubject) {
  const subjectKey = (q.subject || "").toLowerCase();
  const topics = topicsBySubject.get(subjectKey) || [];
  if (!topics.length) return { method: "no_syllabus_topics", topic: null };

  // 1. metadata
  const meta = q.metadata || {};
  if (meta.syllabus_topic_id) {
    const t = topics.find((x) => x.id === meta.syllabus_topic_id);
    if (t) return { method: "metadata_id", topic: t };
  }
  if (meta.syllabus_topic_name) {
    const t = findTopicByName(topics, meta.syllabus_topic_name);
    if (t) return { method: "metadata_name", topic: t };
  }

  // 2. tags
  for (const tag of q.tags || []) {
    const t = findTopicByName(topics, tag);
    if (t) return { method: "tag", topic: t };
  }

  // 3. source reference
  if (q.source_syllabus_topic_id) {
    const t = topics.find((x) => x.id === q.source_syllabus_topic_id);
    if (t) return { method: "source", topic: t };
  }

  // 4. lesson mapping
  if (q.lesson_topic_id) {
    const t = topics.find((x) => x.id === q.lesson_topic_id);
    if (t) return { method: "lesson", topic: t };
  }

  // 5. content keyword analysis
  const kw = scoreKeywords(q.subject, q.stem);
  if (kw) {
    const t = findTopicByName(topics, kw.topic);
    if (t) return { method: "keyword", topic: t, confidence: Math.min(1, kw.hits / 3) };
  }

  // 6. AI classifier fallback
  if (aiClient && typeof aiClient.classifyTopic === "function") {
    try {
      const res = await aiClient.classifyTopic(q.subject, q.stem);
      if (res && res.topic_id && (res.confidence || 0) >= MIN_AI_CONFIDENCE) {
        const t = topics.find((x) => x.id === res.topic_id);
        if (t) return { method: "ai", topic: t, confidence: res.confidence };
      }
    } catch (_) { /* swallow */ }
  }

  return { method: "unresolved", topic: null };
}

async function main() {
  console.log(`[TOPIC_REMAP] mode=${APPLY ? "APPLY" : "DRY-RUN"} subject=${SUBJECT || "*"} limit=${LIMIT || "∞"}`);

  const topicsBySubject = await loadSyllabusTopicsBySubject();

  const params = [];
  let where = `WHERE (
    LOWER(t.name) IN ('core concepts','foundations','exam practice','past questions','revision notes','common mistakes','mixed','general','unknown','misc','miscellaneous')
  )`;
  if (SUBJECT) { params.push(SUBJECT); where += ` AND LOWER(s.name) = LOWER($${params.length})`; }
  const limitSql = LIMIT ? ` LIMIT ${Number(LIMIT)}` : "";

  const { rows: questions } = await db.query(`
    SELECT q.id, q.stem, q.metadata, q.tags, q.topic_id AS from_topic_id,
           q.source_id, q.lesson_id,
           cs.syllabus_topic_id AS source_syllabus_topic_id,
           l.topic_id           AS lesson_topic_id,
           s.name AS subject, t.name AS from_topic
      FROM questions q
      JOIN topics   t ON t.id = q.topic_id
      JOIN subjects s ON s.id = t.subject_id
      LEFT JOIN content_sources cs ON cs.id = q.source_id
      LEFT JOIN lessons         l  ON l.id  = q.lesson_id
      ${where}
      ORDER BY q.created_at ASC
      ${limitSql}
  `, params);

  const stats = { total: questions.length, methods: {}, unresolved: [] };

  for (const q of questions) {
    const r = await resolveTopic(q, topicsBySubject);
    stats.methods[r.method] = (stats.methods[r.method] || 0) + 1;

    if (!r.topic) {
      stats.unresolved.push({ id: q.id, subject: q.subject, from: q.from_topic });
      continue;
    }
    if (r.topic.id === q.from_topic_id) continue; // already correct

    const line = {
      question_id: q.id,
      from_topic: q.from_topic,
      to_topic: r.topic.name,
      method: r.method,
      confidence: r.confidence || null,
    };
    console.log("[TOPIC_REMAP]", JSON.stringify(line));

    if (APPLY && !DRY) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(`UPDATE questions SET topic_id = $1, updated_at = NOW() WHERE id = $2`, [r.topic.id, q.id]);
        await client.query(
          `INSERT INTO topic_remap_audit (question_id, from_topic_id, to_topic_id, method, confidence)
           VALUES ($1, $2, $3, $4, $5)`,
          [q.id, q.from_topic_id, r.topic.id, r.method, r.confidence || null],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[TOPIC_REMAP] write_failed", q.id, e.message);
      } finally {
        client.release();
      }
    }
  }

  const unresolvedCsv = "/tmp/topic-remap-unresolved.csv";
  fs.writeFileSync(
    unresolvedCsv,
    "question_id,subject,from_topic\n" +
      stats.unresolved.map((u) => `${u.id},${u.subject},${u.from}`).join("\n"),
  );

  console.log("[TOPIC_REMAP] summary", JSON.stringify({
    mode: APPLY ? "APPLY" : "DRY-RUN",
    total: stats.total,
    by_method: stats.methods,
    unresolved: stats.unresolved.length,
    unresolved_csv: unresolvedCsv,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
