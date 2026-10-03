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

// ---------------------------------------------------------------------------
// Argumentová politika pro exec_in
//
// Samotný název binárky nestačí: přes povolené binárky šlo obejít maskování
// tajemství (grep na /proc/1/environ), zapisovat do souborového systému
// (curl -o, wget -O) nebo zastavit službu (nginx -s stop). Každá binárka proto
// má vlastní validátor, který se spouští PŘED voláním dockeru a vrací finální
// argv (např. curl dostane vynucené --proto =http,https).
// Pravidla jsou záměrně v kódu; MCP volání je nemůže zeslabit. Jediné, co jde
// rozšířit konfigurací, jsou povolené prefixy cest pro grep (execGrepPathPrefixes).
// ---------------------------------------------------------------------------

export const DEFAULT_GREP_PATH_PREFIXES = ["/etc/nginx/", "/var/log/nginx/"];

// Cesty, které se nesmí číst/vypisovat přes žádnou binárku.
const FORBIDDEN_PATH_PREFIXES = ["/proc", "/sys", "/dev", "/run/secrets", "/var/run/secrets", "/etc/shadow", "/etc/gshadow"];

function reject(binary, reason) {
  throw new Error(`exec_in argument rejected for ${binary}: ${reason}`);
}

function normalizePosix(value) {
  return path.posix.normalize(value.replace(/\\/g, "/"));
}

function isForbiddenPath(value) {
  const normalized = normalizePosix(value);
  const base = path.posix.basename(normalized);
  if (base === ".env" || base.endsWith(".env") || base.startsWith(".env.")) return true;
  return FORBIDDEN_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

function assertSafePath(binary, value) {
  if (value.split(/[\\/]/).includes("..")) reject(binary, `path traversal is not allowed: ${value}`);
  if (isForbiddenPath(value)) reject(binary, `path is not allowed: ${value}`);
}

function looksLikePath(value) {
  return value.startsWith("/") || value.startsWith(".") || value.includes("/");
}

function isNumber(value) {
  return /^\d+(\.\d+)?$/.test(value);
}

function validateNginx(binary, args) {
  const allowed = new Set(["-t", "-T", "-v", "-V"]);
  if (args.length !== 1 || !allowed.has(args[0])) {
    reject(binary, "only exactly one of -t, -T, -v, -V is allowed");
  }
  return args;
}

function validateGrep(binary, args, options) {
  const prefixes = options.grepPathPrefixes ?? DEFAULT_GREP_PATH_PREFIXES;
  const noArgFlags = new Set(["n", "i", "c", "v", "E", "F", "H", "l", "w", "x"]);
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") reject(binary, "-- is not allowed");
    if (arg.startsWith("--")) reject(binary, `option is not allowed: ${arg}`);
    if (arg.startsWith("-") && arg.length > 1) {
      const letters = arg.slice(1);
      for (let position = 0; position < letters.length; position += 1) {
        const letter = letters[position];
        if (noArgFlags.has(letter)) continue;
        if (letter === "m") {
          const inline = letters.slice(position + 1);
          if (inline) {
            if (!/^\d+$/.test(inline)) reject(binary, `invalid -m value: ${arg}`);
          } else {
            index += 1;
            if (!/^\d+$/.test(args[index] ?? "")) reject(binary, "-m requires a number");
          }
          break;
        }
        reject(binary, `option is not allowed: -${letter}`);
      }
      continue;
    }
    positional.push(arg);
  }
  if (positional.length < 2) reject(binary, "a pattern and at least one file path are required");
  for (const file of positional.slice(1)) {
    if (!file.startsWith("/")) reject(binary, `path must be absolute: ${file}`);
    assertSafePath(binary, file);
    const normalized = normalizePosix(file);
    if (!prefixes.some((prefix) => normalized.startsWith(prefix))) {
      reject(binary, `path is outside the allowed prefixes (${prefixes.join(", ")}): ${file}`);
    }
  }
  return args;
}

const CURL_NO_ARG_SHORT = new Set(["s", "S", "f", "L", "k", "v", "I", "i", "4", "6", "g"]);
const CURL_NO_ARG_LONG = new Set([
  "--silent", "--show-error", "--fail", "--location", "--insecure", "--verbose", "--head",
  "--include", "--http1.1", "--http2", "--ipv4", "--ipv6", "--globoff", "--compressed"
]);
const CURL_VALUE_SHORT = { "-m": "number", "-X": "method", "-H": "text", "-d": "text", "-F": "form", "-w": "text" };
const CURL_VALUE_LONG = {
  "--max-time": "number", "--connect-timeout": "number", "--max-redirs": "number",
  "--request": "method", "--header": "text", "--data": "text", "--data-raw": "text",
  "--form": "form", "--write-out": "text"
};

function checkCurlValue(binary, option, kind, value) {
  if (value === undefined) reject(binary, `${option} requires a value`);
  if (kind === "number" && !isNumber(value)) reject(binary, `${option} requires a number`);
  if (kind === "method" && !/^[A-Z]+$/.test(value)) reject(binary, `${option} requires an HTTP method`);
  // @soubor / <soubor> by curl načetl z lokálního souborového systému
  if (kind === "text" && value.startsWith("@")) reject(binary, `${option} value must not start with @`);
  if (kind === "form" && /[@<]/.test(value)) reject(binary, `${option} value must not contain @ or <`);
}

function validateCurl(binary, args) {
  const urls = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") reject(binary, "-- is not allowed");
    if (arg.startsWith("--")) {
      if (CURL_NO_ARG_LONG.has(arg)) continue;
      if (CURL_VALUE_LONG[arg]) {
        index += 1;
        checkCurlValue(binary, arg, CURL_VALUE_LONG[arg], args[index]);
        continue;
      }
      reject(binary, `option is not allowed: ${arg}`);
    }
    if (arg.startsWith("-") && arg.length > 1) {
      if (CURL_VALUE_SHORT[arg]) {
        index += 1;
        checkCurlValue(binary, arg, CURL_VALUE_SHORT[arg], args[index]);
        continue;
      }
      const letters = arg.slice(1).split("");
      if (letters.every((letter) => CURL_NO_ARG_SHORT.has(letter))) continue;
      reject(binary, `option is not allowed: ${arg}`);
    }
    if (!/^https?:\/\//i.test(arg)) reject(binary, `URL must start with http:// or https://: ${arg}`);
    urls.push(arg);
  }
  if (urls.length === 0) reject(binary, "an http:// or https:// URL is required");
  return ["--proto", "=http,https", "--proto-redir", "=http,https", ...args];
}

const WGET_NO_ARG_SHORT = new Set(["q", "S", "v", "4", "6"]);
const WGET_NO_ARG_LONG = new Set([
  "--quiet", "--server-response", "--spider", "--no-check-certificate", "--no-verbose", "-nv"
]);

function validateWget(binary, args) {
  const urls = [];
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") reject(binary, "-- is not allowed");
    if (arg === "-O" || arg === "--output-document") {
      index += 1;
      if (args[index] !== "-") reject(binary, "output must go to stdout (-O -)");
      continue;
    }
    if (arg === "--output-document=-") continue;
    if (WGET_NO_ARG_LONG.has(arg)) {
      rest.push(arg);
      continue;
    }
    if (arg === "-T" || arg === "--timeout" || arg === "-t" || arg === "--tries") {
      index += 1;
      if (!isNumber(args[index] ?? "")) reject(binary, `${arg} requires a number`);
      rest.push(arg, args[index]);
      continue;
    }
    if (/^--(timeout|tries)=\d+(\.\d+)?$/.test(arg)) {
      rest.push(arg);
      continue;
    }
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 1) {
      const letters = arg.slice(1);
      // -qO- / -qO - (výstup na stdout) i čisté kombinace přepínačů bez argumentu
      let body = letters;
      if (letters.endsWith("O-")) {
        body = letters.slice(0, -2);
      } else if (letters.endsWith("O")) {
        index += 1;
        if (args[index] !== "-") reject(binary, "output must go to stdout (-O -)");
        body = letters.slice(0, -1);
      }
      if (body.split("").every((letter) => WGET_NO_ARG_SHORT.has(letter))) {
        if (body) rest.push(`-${body}`);
        continue;
      }
      reject(binary, `option is not allowed: ${arg}`);
    }
    if (arg.startsWith("-")) reject(binary, `option is not allowed: ${arg}`);
    if (!/^https?:\/\//i.test(arg)) reject(binary, `URL must start with http:// or https://: ${arg}`);
    urls.push(arg);
  }
  if (urls.length === 0) reject(binary, "an http:// or https:// URL is required");
  return ["-O", "-", ...rest, ...urls];
}

const GETENT_DATABASES = new Set(["hosts", "ahosts", "ahostsv4", "ahostsv6", "services", "protocols", "networks"]);

function validateGetent(binary, args) {
  if (args.length < 1 || args.some((arg) => arg.startsWith("-"))) {
    reject(binary, "options are not allowed");
  }
  if (!GETENT_DATABASES.has(args[0])) {
    reject(binary, `database is not allowed: ${args[0]} (allowed: ${[...GETENT_DATABASES].join(", ")})`);
  }
  return args;
}

function validateNslookup(binary, args) {
  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (!/^-(type|querytype|port|timeout|retry)=[A-Za-z0-9]+$/.test(arg)) {
        reject(binary, `option is not allowed: ${arg}`);
      }
    } else if (!/^[A-Za-z0-9._:-]+$/.test(arg)) {
      reject(binary, `invalid host argument: ${arg}`);
    }
  }
  return args;
}

function validateLs(binary, args) {
  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (arg === "-" || !/^-[lahAdtrSF1]+$/.test(arg)) reject(binary, `option is not allowed: ${arg}`);
    } else {
      assertSafePath(binary, arg);
    }
  }
  return args;
}

const TEST_OPERATORS = new Set([
  "!", "=", "!=", "-e", "-f", "-d", "-r", "-w", "-x", "-s", "-L", "-h", "-n", "-z",
  "-eq", "-ne", "-gt", "-lt", "-ge", "-le", "-nt", "-ot"
]);

function validateTest(binary, args) {
  for (const arg of args) {
    if (arg.startsWith("-") && arg.length > 1) {
      if (!TEST_OPERATORS.has(arg)) reject(binary, `operator is not allowed: ${arg}`);
    } else if (looksLikePath(arg)) {
      assertSafePath(binary, arg);
    }
  }
  return args;
}

// Jeden export se všemi pravidly: binárka -> validátor(binary, args, options) => finální args.
export const EXEC_ARG_POLICY = Object.freeze({
  nginx: validateNginx,
  grep: validateGrep,
  curl: validateCurl,
  wget: validateWget,
  getent: validateGetent,
  nslookup: validateNslookup,
  ls: validateLs,
  test: validateTest
});

// Vrací argv, které se skutečně pošle do `docker exec` (může obsahovat vynucené přepínače).
export function assertAllowedArgv(argv, options = {}) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("exec_in requires a non-empty argv array");
  }
  if (argv.some((item) => typeof item !== "string")) {
    throw new Error("exec_in argv items must be strings");
  }
  if (argv.some((item) => item.includes("\0"))) {
    throw new Error("exec_in argv items must not contain NUL characters");
  }
  const binary = argv[0];
  if (!EXEC_BINARIES.includes(binary) || !Object.hasOwn(EXEC_ARG_POLICY, binary)) {
    throw new Error(`exec_in binary is not allowed: ${binary}`);
  }
  return [binary, ...EXEC_ARG_POLICY[binary](binary, argv.slice(1), options)];
}

export async function execIn({ runner = runCommand, cwd, container, argv, grepPathPrefixes } = {}) {
  const safeArgv = assertAllowedArgv(argv, { grepPathPrefixes });
  const projectState = await listProjectContainers({ runner, cwd });
  assertKnownContainer(projectState, container);
  return runner("docker", ["exec", container, ...safeArgv], { cwd });
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
