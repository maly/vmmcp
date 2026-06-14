import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_WRITABLE_GLOBS = [
  "nginx-vhost/*",
  "*.conf"
];

const DEFAULT_READABLE_GLOBS = [
  "docker-compose.yml",
  ...DEFAULT_WRITABLE_GLOBS,
  "start",
  "update"
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
    composeProjectDir: path.resolve(cwd, env.composeProjectDir || cwd),
    writableGlobs: parseList(env.writableGlobs, DEFAULT_WRITABLE_GLOBS),
    readableGlobs: parseList(env.readableGlobs, DEFAULT_READABLE_GLOBS),
    denyGlobs: parseList(env.denyGlobs, DEFAULT_DENY_GLOBS),
    envFiles: parseList(env.envFiles, DEFAULT_ENV_FILES),
    envProtectedPatterns: parseList(
      env.envProtectedPatterns,
      DEFAULT_ENV_PROTECTED_PATTERNS
    ),
    allowedScripts: parseList(env.allowedScripts, DEFAULT_ALLOWED_SCRIPTS)
  };
}

export function findConfigPath(argv = process.argv, cwd = process.cwd()) {
  const configIndex = argv.indexOf("--config");
  if (configIndex !== -1) {
    const value = argv[configIndex + 1];
    if (!value) {
      throw new Error("--config requires a path");
    }
    return path.resolve(cwd, value);
  }

  return path.resolve(cwd, "config.json");
}

export async function loadConfigFile(configPath) {
  const absoluteConfigPath = path.resolve(configPath);
  const raw = await fs.readFile(absoluteConfigPath, "utf8");
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse config JSON ${absoluteConfigPath}: ${error.message}`);
  }

  return loadConfig(parsed, path.dirname(absoluteConfigPath));
}
