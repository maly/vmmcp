// Portable test runner: Node 20 on Windows does not expand `tests/*.test.js`
// (cmd.exe passes the glob literally), so list the files ourselves.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const files = readdirSync("tests")
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => join("tests", f));

const result = spawnSync(process.execPath, ["--test", ...files, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
