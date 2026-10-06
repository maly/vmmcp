import path from "node:path";

function toPosixPath(value) {
  return value.replaceAll("\\", "/");
}

function escapeRegExp(value) {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`^${source}$`);
}

function matchesAny(globs, relativePath) {
  return globs.some((glob) => globToRegExp(toPosixPath(glob)).test(relativePath));
}

export function resolveProjectPath(config, inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("Path must be a non-empty string");
  }

  const root = path.resolve(config.composeProjectDir);
  const absolutePath = path.resolve(root, inputPath);
  const relativePath = path.relative(root, absolutePath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Path is outside compose project: ${inputPath}`);
  }

  return {
    absolutePath,
    relativePath: toPosixPath(relativePath || path.basename(absolutePath))
  };
}

// ---------------------------------------------------------------------------
// Natvrdo zakázané cesty pro souborové nástroje
//
// Nezávisle na readableGlobs/writableGlobs/denyGlobs se přes file nástroje nesmí
// číst ani zapisovat úložiště záloh (.mcp-backups/**) ani env soubory. Zálohy
// obsahují nemaskované kopie env souborů a jejich podvržením šlo přes
// restore_file přepsat skript spouštěný přes run_script. Env soubory se čtou
// a mění jen přes read_env / set_env_var.
// ---------------------------------------------------------------------------

export const BACKUP_DIR_NAME = ".mcp-backups";

// Windows ignoruje velikost písmen a koncové tečky/mezery v názvech souborů.
function normalizeSegment(segment) {
  return segment.toLowerCase().replace(/[. ]+$/, "");
}

function normalizeForCompare(relativePath) {
  return toPosixPath(relativePath).split("/").map(normalizeSegment).join("/");
}

// Stejné pravidlo používá exec_in pro cesty uvnitř kontejnerů.
export function isEnvFileName(name) {
  const base = normalizeSegment(name);
  return base === ".env" || base.endsWith(".env") || base.startsWith(".env.");
}

export function isInsideBackupDir(relativePath) {
  return normalizeSegment(toPosixPath(relativePath).split("/")[0]) === BACKUP_DIR_NAME;
}

export function isHardDeniedPath(config, relativePath) {
  const posixPath = toPosixPath(relativePath);
  if (isInsideBackupDir(posixPath) || isEnvFileName(path.posix.basename(posixPath))) {
    return true;
  }

  const normalized = normalizeForCompare(posixPath);
  return config.envFiles.some((file) => {
    try {
      return normalizeForCompare(resolveProjectPath(config, file).relativePath) === normalized;
    } catch {
      return false;
    }
  });
}

function isAllowed(config, inputPath, allowGlobs) {
  let resolved;
  try {
    resolved = resolveProjectPath(config, inputPath);
  } catch {
    return false;
  }

  if (isHardDeniedPath(config, resolved.relativePath)) {
    return false;
  }

  if (matchesAny(config.denyGlobs, resolved.relativePath)) {
    return false;
  }

  return matchesAny(allowGlobs, resolved.relativePath);
}

export function canRead(config, inputPath) {
  return isAllowed(config, inputPath, config.readableGlobs);
}

export function canWrite(config, inputPath) {
  return isAllowed(config, inputPath, config.writableGlobs);
}

export function canDelete(config, inputPath) {
  return canWrite(config, inputPath);
}

export function canCopyDestination(config, inputPath) {
  return canWrite(config, inputPath);
}
