CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS topic_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,

    key_concepts JSONB DEFAULT '[]'::jsonb,
    memory_aids JSONB DEFAULT '[]'::jsonb,
    common_traps JSONB DEFAULT '[]'::jsonb,
    worked_examples JSONB DEFAULT '[]'::jsonb,
    exam_tips JSONB DEFAULT '[]'::jsonb,
    past_question_patterns JSONB DEFAULT '[]'::jsonb,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(topic_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_knowledge_topic_id
ON topic_knowledge(topic_id);
