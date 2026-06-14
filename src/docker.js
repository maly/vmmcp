import { runCommand } from "./commandRunner.js";

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse ${label} JSON: ${error.message}`);
  }
}

export async function ps({ runner = runCommand, cwd } = {}) {
  const result = await runner("docker", ["compose", "ps", "--format", "json"], { cwd });
  return parseJson(result.stdout, "docker compose ps");
}

export async function composeConfig({ runner = runCommand, cwd } = {}) {
  const result = await runner("docker", ["compose", "config", "--format", "json"], { cwd });
  return parseJson(result.stdout, "docker compose config");
}

export async function logs({ runner = runCommand, container, tail = 200 } = {}) {
  const result = await runner("docker", [
    "logs",
    "--tail",
    String(tail),
    container
  ]);
  return result.stdout;
}

export async function inspect({ runner = runCommand, container } = {}) {
  const result = await runner("docker", ["inspect", container]);
  return parseJson(result.stdout, "docker inspect");
}
