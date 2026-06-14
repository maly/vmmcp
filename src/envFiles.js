import { readFileTool, writeReadableFileWithBackup } from "./fileOps.js";

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function isProtectedKey(key, protectedPatterns) {
  return protectedPatterns.some((pattern) => wildcardToRegExp(pattern).test(key));
}

function parseEnvironmentArray(environment) {
  const parsed = {};
  for (const item of environment) {
    const index = item.indexOf("=");
    if (index === -1) continue;
    parsed[item.slice(0, index)] = item.slice(index + 1);
  }
  return parsed;
}

export function parseEnv(content) {
  const entries = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const source = trimmed.startsWith("export ") ? trimmed.slice(7).trimStart() : trimmed;
    const index = source.indexOf("=");
    if (index === -1) continue;
    entries[source.slice(0, index)] = source.slice(index + 1);
  }
  return entries;
}

export function maskEnv(entries, protectedPatterns) {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      isProtectedKey(key, protectedPatterns) ? "****" : value
    ])
  );
}

function serviceEnvironment(composeConfig, service) {
  if (!service || !composeConfig?.services?.[service]?.environment) return {};
  const environment = composeConfig.services[service].environment;
  if (Array.isArray(environment)) return parseEnvironmentArray(environment);
  return { ...environment };
}

export async function readEnv({ config, service, composeConfig } = {}) {
  const files = {};

  for (const file of config.envFiles) {
    try {
      files[file] = maskEnv(parseEnv(await readFileTool(config, file)), config.envProtectedPatterns);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return {
    files,
    environment: maskEnv(
      serviceEnvironment(composeConfig, service),
      config.envProtectedPatterns
    )
  };
}

function updateEnvContent(content, key, value) {
  const lines = content.split(/\r?\n/);
  let updated = false;
  const keyPattern = new RegExp(`^(\\s*(?:export\\s+)?)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);

  const nextLines = lines.map((line) => {
    if (keyPattern.test(line)) {
      updated = true;
      const prefix = line.match(keyPattern)[1];
      return `${prefix}${key}=${value}`;
    }
    return line;
  });

  if (!updated) {
    if (nextLines.length === 0 || nextLines.at(-1) !== "") {
      nextLines.push("");
    }
    nextLines[nextLines.length - 1] = `${key}=${value}`;
    nextLines.push("");
  }

  return nextLines.join("\n");
}

export async function setEnvVar({ config, file, key, value } = {}) {
  if (!config.envFiles.includes(file)) {
    throw new Error(`Path is not configured env file: ${file}`);
  }
  if (isProtectedKey(key, config.envProtectedPatterns)) {
    throw new Error(`Refusing to edit protected env key: ${key}`);
  }

  const content = await readFileTool(config, file);
  return writeReadableFileWithBackup(config, file, updateEnvContent(content, key, value));
}
