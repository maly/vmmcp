import { spawn } from "node:child_process";

export class CommandError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "CommandError";
    this.result = result;
  }
}

export function runCommand(file, args = [], options = {}) {
  const { cwd, timeoutMs = 30_000 } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill();
      reject(new CommandError(`Command timed out: ${file}`, {
        file,
        args,
        stdout,
        stderr,
        code: null
      }));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("close", (code) => {
      clearTimeout(timeout);
      const result = { file, args, stdout, stderr, code };
      if (code === 0) {
        resolve(result);
      } else {
        reject(new CommandError(`Command failed: ${file} ${args.join(" ")}`, result));
      }
    });
  });
}
