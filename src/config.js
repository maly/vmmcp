import path from "node:path";

const DEFAULT_WRITABLE_GLOBS = [
  "docker-compose.yml",
  "nginx-vhost/*",
  "*.conf",
  "start",
  "update"
];

const DEFAULT_READABLE_GLOBS = [
  ...DEFAULT_WRITABLE_GLOBS,
  ".env",
  "strata.env",
  "*.env"
];

const DEFAULT_DENY_GLOBS = [".ssh/*", "**/id_rsa*", "**/id_ed25519*"];
const DEFAULT_ENV_FILES = [".env", "strata.env"];
const DEFAULT_ENV_PROTECTED_PATTERNS = ["*PASSWORD*", "*API_KEY*", "*SECRET*", "*TOKEN*"];
const DEFAULT_ALLOWED_SCRIPTS = ["start", "update"];

function parseList(value, fallback) {
  if (!value) return [...fallback];
  if (Array.isArray(value)) return value.map(String);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  return {
    composeProjectDir: path.resolve(env.COMPOSE_PROJECT_DIR || cwd),
    writableGlobs: parseList(env.WRITABLE_GLOBS, DEFAULT_WRITABLE_GLOBS),
    readableGlobs: parseList(env.READABLE_GLOBS, DEFAULT_READABLE_GLOBS),
    denyGlobs: parseList(env.DENY_GLOBS, DEFAULT_DENY_GLOBS),
    envFiles: parseList(env.ENV_FILES, DEFAULT_ENV_FILES),
    envProtectedPatterns: parseList(
      env.ENV_PROTECTED_PATTERNS,
      DEFAULT_ENV_PROTECTED_PATTERNS
    ),
    allowedScripts: parseList(env.ALLOWED_SCRIPTS, DEFAULT_ALLOWED_SCRIPTS)
  };
}
