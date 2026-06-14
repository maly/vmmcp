import path from "node:path";
import { runCommand } from "./commandRunner.js";
import { assertKnownContainer, listProjectContainers } from "./containers.js";
import { canWrite } from "./pathPolicy.js";

export const EXEC_BINARIES = [
  "nginx",
  "grep",
  "curl",
  "wget",
  "getent",
  "nslookup",
  "ls",
  "test"
];

function assertAllowedArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("exec_in requires a non-empty argv array");
  }
  const binary = argv[0];
  if (!EXEC_BINARIES.includes(binary)) {
    throw new Error(`exec_in binary is not allowed: ${binary}`);
  }
}

export async function execIn({ runner = runCommand, cwd, container, argv } = {}) {
  assertAllowedArgv(argv);
  const projectState = await listProjectContainers({ runner, cwd });
  assertKnownContainer(projectState, container);
  return runner("docker", ["exec", container, ...argv], { cwd });
}

export async function runScript({ config, runner = runCommand, name } = {}) {
  if (!config.allowedScripts.includes(name)) {
    throw new Error(`Script is not allowed: ${name}`);
  }
  if (canWrite(config, name)) {
    throw new Error(`Refusing to run script writable through MCP policy: ${name}`);
  }

  const scriptPath = path.join(config.composeProjectDir, name);
  return runner(scriptPath, [], { cwd: config.composeProjectDir });
}
