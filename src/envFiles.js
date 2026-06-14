import fs from "node:fs/promises";
import { assertRealPathInsideProject, writeReadableFileWithBackup } from "./fileOps.js";
import { resolveProjectPath } from "./pathPolicy.js";

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
      const resolved = resolveProjectPath(config, file);
      await assertRealPathInsideProject(config, resolved);
      files[file] = maskEnv(
        parseEnv(await fs.readFile(resolved.absolutePath, "utf8")),
        config.envProtectedPatterns
      );
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

function validateEnvAssignment(key, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid env key: ${key}`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error("Env value must not contain newlines");
  }
}

export async function setEnvVar({ config, file, key, value } = {}) {
  if (!config.envFiles.includes(file)) {
    throw new Error(`Path is not configured env file: ${file}`);
  }
  validateEnvAssignment(key, value);
  if (isProtectedKey(key, config.envProtectedPatterns)) {
    throw new Error(`Refusing to edit protected env key: ${key}`);
  }

  const resolved = resolveProjectPath(config, file);
  await assertRealPathInsideProject(config, resolved);
  const content = await fs.readFile(resolved.absolutePath, "utf8");
  return writeReadableFileWithBackup(
    config,
    file,
    updateEnvContent(content, key, value),
    { skipReadableCheck: true }
  );
}
