const fs = require('fs');
const path = require('path');
const routeMounts = require('./routeMounts');

const SRC_DIR = path.join(__dirname, '..', 'src', 'routes');
const OUTPUT_FILE = path.join(__dirname, '..', 'src', 'generated', 'routeManifest.json');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walk(fullPath));
    } else if (entry.isFile() && /\.(js|ts)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizePath(part) {
  if (!part) return '';
  if (part === '/') return '';
  return part.startsWith('/') ? part : `/${part}`;
}

function joinPaths(base, sub) {
  const left = normalizePath(base);
  const right = normalizePath(sub);
  return `${left}${right}` || '/';
}

function extractRoutes(content, filePath) {
  const routes = [];
  const regex = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;

  const relativeFile = path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/');
  const mountBase = routeMounts[relativeFile] || '';

  let match;
  while ((match = regex.exec(content)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      localPath: match[2],
      fullPath: joinPaths(mountBase, match[2]),
      file: relativeFile,
      mountBase,
    });
  }

  return routes;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const files = walk(SRC_DIR);
  let allRoutes = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    allRoutes = allRoutes.concat(extractRoutes(content, file));
  }

  allRoutes.sort((a, b) => {
    if (a.fullPath !== b.fullPath) return a.fullPath.localeCompare(b.fullPath);
    return a.method.localeCompare(b.method);
  });

  ensureDir(OUTPUT_FILE);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allRoutes, null, 2));

  console.log(`Exported ${allRoutes.length} routes to ${OUTPUT_FILE}`);
}

main();
