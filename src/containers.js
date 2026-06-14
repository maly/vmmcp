import path from "node:path";
import { runCommand } from "./commandRunner.js";

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse docker compose ps JSON: ${error.message}`);
  }
}

function parseLabels(labels) {
  if (!labels || typeof labels !== "string") return {};

  return Object.fromEntries(
    labels
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf("=");
        if (index === -1) return [pair, ""];
        return [pair.slice(0, index), pair.slice(index + 1)];
      })
  );
}

function rowName(row) {
  return row.Name || row.Names || row.Container || row.ID;
}

function rowService(row, labels) {
  return row.Service || labels["com.docker.compose.service"];
}

export async function listProjectContainers({ runner = runCommand, cwd } = {}) {
  const result = await runner("docker", ["compose", "ps", "--format", "json"], { cwd });
  const rows = parseJson(result.stdout);
  const projectName = path.basename(path.resolve(cwd || process.cwd()));
  const hasProjectLabels = rows.some((row) => {
    const labels = parseLabels(row.Labels);
    return Boolean(labels["com.docker.compose.project"]);
  });

  const services = new Set();
  const containers = new Set();

  for (const row of rows) {
    const labels = parseLabels(row.Labels);
    if (
      hasProjectLabels &&
      labels["com.docker.compose.project"] &&
      labels["com.docker.compose.project"] !== projectName
    ) {
      continue;
    }

    const name = rowName(row);
    const service = rowService(row, labels);
    if (name) containers.add(name);
    if (service) services.add(service);
  }

  return { services, containers };
}

export function assertKnownService(projectState, service) {
  if (!projectState.services.has(service)) {
    throw new Error(`Unknown compose service: ${service}`);
  }
}

export function assertKnownContainer(projectState, container) {
  if (!projectState.containers.has(container)) {
    throw new Error(`Unknown compose container: ${container}`);
  }
}
