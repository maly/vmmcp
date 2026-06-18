import { runCommand } from "./commandRunner.js";
import {
  assertKnownContainer,
  assertKnownService,
  listProjectContainers
} from "./containers.js";

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    try {
      return stdout
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line));
    } catch {
      throw new Error(`Failed to parse ${label} JSON: ${error.message}`);
    }
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

export async function logs({ runner = runCommand, cwd, container, tail = 200 } = {}) {
  const projectState = await listProjectContainers({ runner, cwd });
  assertKnownContainer(projectState, container);
  const result = await runner("docker", [
    "logs",
    "--tail",
    String(tail),
    container
  ], { cwd });
  return result.stdout;
}

export async function inspect({ runner = runCommand, cwd, container } = {}) {
  const projectState = await listProjectContainers({ runner, cwd });
  assertKnownContainer(projectState, container);
  const result = await runner("docker", ["inspect", container], { cwd });
  return parseJson(result.stdout, "docker inspect");
}

export async function composeUp({
  runner = runCommand,
  cwd,
  service,
  forceRecreate = false
} = {}) {
  const args = ["compose", "up", "-d"];
  if (forceRecreate) args.push("--force-recreate");
  if (service) {
    const projectState = await listProjectContainers({ runner, cwd });
    assertKnownService(projectState, service);
    args.push(service);
  }

  return runner("docker", args, { cwd });
}

export async function composePull({ runner = runCommand, cwd, service } = {}) {
  const args = ["compose", "pull"];
  if (service) {
    const projectState = await listProjectContainers({ runner, cwd });
    assertKnownService(projectState, service);
    args.push(service);
  }

  return runner("docker", args, { cwd });
}

export async function composeDown({ runner = runCommand, cwd } = {}) {
  return runner("docker", ["compose", "down"], { cwd });
}

export async function restart({ runner = runCommand, cwd, container } = {}) {
  const projectState = await listProjectContainers({ runner, cwd });
  assertKnownContainer(projectState, container);
  return runner("docker", ["restart", container], { cwd });
}
