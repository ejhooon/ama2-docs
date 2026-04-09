import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const config = JSON.parse(
  await fs.readFile(path.join(repoRoot, 'scripts/public-docs-harness.config.json'), 'utf8'),
);
const mintConfig = JSON.parse(await fs.readFile(path.join(repoRoot, 'mint.json'), 'utf8'));
const mdxFiles = await walkForFiles(repoRoot, '.mdx');
const mdxRoutes = mdxFiles.map((file) => toRoute(repoRoot, file));
const navigationPages = flattenNavigationPages(mintConfig.navigation ?? []);
const failures = [];

for (const page of navigationPages) {
  const filePath = path.join(repoRoot, `${page}.mdx`);
  if (!(await exists(filePath))) {
    failures.push(`Navigation page is missing its file: ${page}`);
  }
}

for (const group of mintConfig.navigation ?? []) {
  const groupPages = (group.pages ?? []).filter((page) => typeof page === 'string');
  if (!groupPages.some((page) => page.startsWith('api-reference/') && page !== 'api-reference/overview')) {
    continue;
  }
  if (group.openapi !== config.publicOpenAPISpecPath) {
    failures.push(
      `Navigation group "${group.group}" must declare openapi: "${config.publicOpenAPISpecPath}"`,
    );
  }
}

for (const route of mdxRoutes) {
  if (navigationPages.includes(route) || config.hiddenPages.includes(route)) {
    continue;
  }
  failures.push(`MDX page is orphaned from navigation and hidden allowlist: ${route}`);
}

for (const file of mdxFiles) {
  const route = toRoute(repoRoot, file);
  const content = await fs.readFile(file, 'utf8');

  for (const phrase of config.bannedPhrases) {
    const pattern = new RegExp(escapeRegExp(phrase), 'i');
    if (pattern.test(content)) {
      failures.push(`${route}: banned phrase found: ${phrase}`);
    }
  }

  if (route.startsWith('api-reference/') && route !== 'api-reference/overview') {
    const openapiPattern = /^openapi:\s*["']\/openapi\/public-runtime\.json\s+(GET|POST|DELETE)\s+\/api\/v1\/.+["']$/m;
    if (!openapiPattern.test(content)) {
      failures.push(`${route}: API pages must use openapi frontmatter backed by /openapi/public-runtime.json`);
    }
  }

  for (const target of extractInternalLinks(content)) {
    const resolved = normalizeLinkTarget(target);
    if (resolved === '') {
      continue;
    }
    if (hasStaticExtension(resolved)) {
      const staticPath = path.join(repoRoot, resolved.replace(/^\//, ''));
      if (!(await exists(staticPath))) {
        failures.push(`${route}: broken static link: ${target}`);
      }
      continue;
    }
    const linkedRoute = resolved.replace(/^\//, '');
    if (!mdxRoutes.includes(linkedRoute)) {
      failures.push(`${route}: broken internal link: ${target}`);
    }
  }
}

const openapiPath = path.join(repoRoot, config.publicOpenAPISpecPath.replace(/^\//, ''));
if (!(await exists(openapiPath))) {
  failures.push(`Public OpenAPI artifact is missing: ${config.publicOpenAPISpecPath}`);
} else {
  const openapi = JSON.parse(await fs.readFile(openapiPath, 'utf8'));
  if (String(openapi?.info?.title ?? '').includes('Plant Store')) {
    failures.push('Public OpenAPI artifact still contains placeholder Plant Store metadata');
  }
  const paths = Object.keys(openapi?.paths ?? {});
  if (paths.length === 0) {
    failures.push('Public OpenAPI artifact does not declare any paths');
  }
  if (paths.includes('/plants') || paths.includes('/plants/{id}')) {
    failures.push('Public OpenAPI artifact still contains placeholder /plants paths');
  }
  for (const expectedPath of config.expectedOpenAPIPaths) {
    if (!paths.includes(expectedPath)) {
      failures.push(`Public OpenAPI artifact is missing expected path: ${expectedPath}`);
    }
  }
}

if (failures.length > 0) {
  console.error('FAIL: public docs validation failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('PASS: public docs validation passed');

async function walkForFiles(root, extension) {
  const results = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkForFiles(fullPath, extension)));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(extension)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function toRoute(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/').replace(/\.mdx$/, '');
}

function flattenNavigationPages(navigation) {
  const pages = [];
  for (const item of navigation) {
    for (const page of item.pages ?? []) {
      if (typeof page === 'string') {
        pages.push(page);
      }
    }
  }
  return pages;
}

function extractInternalLinks(content) {
  const targets = [];
  const patterns = [/\[[^\]]+\]\((\/[^)\s]+)\)/g, /href=["'](\/[^"']+)["']/g];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      targets.push(match[1]);
    }
  }
  return targets;
}

function normalizeLinkTarget(target) {
  if (!target.startsWith('/')) {
    return '';
  }
  const [pathOnly] = target.split(/[?#]/, 1);
  return pathOnly.replace(/\/$/, '');
}

function hasStaticExtension(target) {
  return /\.[a-zA-Z0-9]+$/.test(target);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
