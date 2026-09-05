import assert from "node:assert/strict";
import { test } from "node:test";
import { runCommand } from "../src/commandRunner.js";
import { logs } from "../src/docker.js";

// Replace only Docker with a real process writing to its OS stdout/stderr.
// Keep the production command runner and any stream redirection intact.
function dockerProcess(script) {
  return async (file, args, options) => {
    if (file === "docker" && args[0] === "compose") {
      return { stdout: '[{"Name":"web","Service":"web"}]', stderr: "", code: 0 };
    }
    if (file === "docker") {
      return runCommand(process.execPath, ["-e", script], options);
    }
    assert.equal(file, "sh");
    assert.equal(args[3], "docker");
    return runCommand(file, [...args.slice(0, 3), process.execPath, "-e", script, "--", ...args.slice(4)], options);
  };
}

test("logs returns stderr-only container output", async () => {
  const runner = dockerProcess('require("node:fs").writeSync(2, "alloy warning\\n")');
  assert.equal(await logs({ runner, container: "web" }), "alloy warning\n");
});

test("logs preserves alternating stdout and stderr writes without delays", async () => {
  const runner = dockerProcess(`
    const { writeSync } = require("node:fs");
    for (let i = 0; i < 1000; i++) writeSync(i % 2 + 1, i + "\\n");
  `);
  const expected = Array.from({ length: 1000 }, (_, i) => `${i}\n`).join("");
  assert.equal(await logs({ runner, container: "web" }), expected);
});

test("logs preserves stdout-only container output", async () => {
  const runner = dockerProcess('require("node:fs").writeSync(1, "anu info\\n")');
  assert.equal(await logs({ runner, container: "web" }), "anu info\n");
});

test("logs passes shell metacharacters as literal arguments", async () => {
  const runner = dockerProcess('process.stdout.write(JSON.stringify(process.argv.slice(1)))');
  const tail = '5; echo injected $(echo injected) "quoted"';
  const result = await logs({ runner, container: "web", tail });
  assert.deepEqual(JSON.parse(result), ["logs", "--tail", tail, "web"]);
});

test("logs still rejects a failed command with its diagnostic output", async () => {
  const runner = dockerProcess('require("node:fs").writeSync(2, "docker failure\\n"); process.exit(1)');
  await assert.rejects(() => logs({ runner, container: "web" }), (error) => {
    assert.equal(error.result.code, 1);
    assert.equal(error.result.stdout, "docker failure\n");
    return true;
  });
});
