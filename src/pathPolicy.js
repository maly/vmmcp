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

function isAllowed(config, inputPath, allowGlobs) {
  let resolved;
  try {
    resolved = resolveProjectPath(config, inputPath);
  } catch {
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
