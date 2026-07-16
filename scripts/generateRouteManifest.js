const fs = require("fs");
const path = require("path");

const ROOT = "/root/proxing-enterprise";
const SRC_DIR = path.join(ROOT, "src");
const INDEX_FILE = path.join(SRC_DIR, "index.js");
const OUTPUT_FILE = path.join(ROOT, "generated", "routeManifest.json");

function extractMounts(indexSource) {
  const mounts = [];

  const directRequireRegex =
    /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*require\(\s*['"`](\.\/routes\/[^'"`]+)['"`]\s*\)\s*\)/g;

  let match;
  while ((match = directRequireRegex.exec(indexSource)) !== null) {
    const mountBase = match[1];
    const requirePath = match[2];

    mounts.push({
      mountBase,
      routeFile: path.resolve(
        SRC_DIR,
        requirePath.endsWith(".js") ? requirePath : `${requirePath}.js`
      ),
    });
  }

  const requireAssignments = {};
  const requireAssignRegex =
    /const\s+([A-Za-z0-9_]+)\s*=\s*require\(\s*['"`](\.\/routes\/[^'"`]+)['"`]\s*\)/g;

  while ((match = requireAssignRegex.exec(indexSource)) !== null) {
    const varName = match[1];
    const requirePath = match[2];
    requireAssignments[varName] = path.resolve(
      SRC_DIR,
      requirePath.endsWith(".js") ? requirePath : `${requirePath}.js`
    );
  }

  const variableMountRegex =
    /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z0-9_]+)\s*\)/g;

  while ((match = variableMountRegex.exec(indexSource)) !== null) {
    const mountBase = match[1];
    const varName = match[2];

    if (requireAssignments[varName]) {
      mounts.push({
        mountBase,
        routeFile: requireAssignments[varName],
      });
    }
  }

  return mounts;
}

function extractRoutes(routeSource) {
  const routes = [];

  const directRegex =
    /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;

  let match;
  while ((match = directRegex.exec(routeSource)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      routePath: match[2],
    });
  }

  const chainedRegex =
    /router\.route\(\s*['"`]([^'"`]+)['"`]\s*\)((?:\s*\.\s*(?:get|post|put|delete|patch)\s*\([^)]*\))+)/gs;

  while ((match = chainedRegex.exec(routeSource)) !== null) {
    const routePath = match[1];
    const chainBlock = match[2];

    const methodRegex = /\.(get|post|put|delete|patch)\s*\(/g;
    let methodMatch;
    while ((methodMatch = methodRegex.exec(chainBlock)) !== null) {
      routes.push({
        method: methodMatch[1].toUpperCase(),
        routePath,
      });
    }
  }

  return routes;
}

function normalizePath(...parts) {
  const joined = parts.join("/");
  return (
    "/" +
    joined
      .replace(/\/+/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
  );
}

function main() {
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(`Backend index file not found: ${INDEX_FILE}`);
  }

  const indexSource = fs.readFileSync(INDEX_FILE, "utf8");
  const mounts = extractMounts(indexSource);

  if (!mounts.length) {
    throw new Error(
      "No mounted route files found in src/index.js. Check your app.use(...) style."
    );
  }

  const routes = [];

  for (const mount of mounts) {
    if (!fs.existsSync(mount.routeFile)) {
      console.warn(`[manifest] missing route file: ${mount.routeFile}`);
      continue;
    }

    const routeSource = fs.readFileSync(mount.routeFile, "utf8");
    const extracted = extractRoutes(routeSource);

    for (const route of extracted) {
      routes.push({
        method: route.method,
        fullPath: normalizePath(mount.mountBase, route.routePath),
      });
    }
  }

  const unique = [];
  const seen = new Set();

  for (const route of routes) {
    const key = `${route.method} ${route.fullPath}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(route);
    }
  }

  unique.sort((a, b) => {
    if (a.fullPath === b.fullPath) return a.method.localeCompare(b.method);
    return a.fullPath.localeCompare(b.fullPath);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    description:
      "Real mounted Express routes on api.proxing.online. Used for runtime validation and typed client generation.",
    routes: unique,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), "utf8");

  console.log(`[manifest] wrote ${unique.length} routes to ${OUTPUT_FILE}`);
}

main();
