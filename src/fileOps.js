import fs from "node:fs/promises";
import path from "node:path";
import {
  canCopyDestination,
  canDelete,
  canRead,
  canWrite,
  resolveProjectPath
} from "./pathPolicy.js";

let backupCounter = 0;

function backupId() {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  backupCounter += 1;
  return `${timestamp}-${backupCounter}`;
}

function backupDir(config, relativePath) {
  return path.join(config.composeProjectDir, ".mcp-backups", ...relativePath.split("/"));
}

function isConfiguredEnvFile(config, inputPath) {
  return config.envFiles.includes(inputPath);
}

async function pathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertRealPathInsideProject(
  config,
  resolved,
  { allowMissingLeaf = false } = {}
) {
  const root = await fs.realpath(config.composeProjectDir);
  let target;
  const realPathOrDanglingSymlink = async (candidate) => {
    try {
      return await fs.realpath(candidate);
    } catch (error) {
      if (error.code === "ENOENT") {
        try {
          const stat = await fs.lstat(candidate);
          if (stat.isSymbolicLink()) {
            throw new Error(`Path resolves outside compose project: ${resolved.relativePath}`);
          }
        } catch (lstatError) {
          if (lstatError.code !== "ENOENT") throw lstatError;
        }
      }
      throw error;
    }
  };

  try {
    target = await realPathOrDanglingSymlink(resolved.absolutePath);
  } catch (error) {
    if (!allowMissingLeaf || error.code !== "ENOENT") {
      throw error;
    }
    let ancestor = path.dirname(resolved.absolutePath);
    while (true) {
      try {
        target = await realPathOrDanglingSymlink(ancestor);
        break;
      } catch (ancestorError) {
        if (ancestorError.code !== "ENOENT") throw ancestorError;
        const next = path.dirname(ancestor);
        if (next === ancestor) throw ancestorError;
        ancestor = next;
      }
    }
  }

  if (!isInsideRoot(root, target)) {
    throw new Error(`Path resolves outside compose project: ${resolved.relativePath}`);
  }
}

async function createBackup(config, resolved) {
  if (!(await pathExists(resolved.absolutePath))) {
    return undefined;
  }

  const id = backupId();
  const destinationDir = backupDir(config, resolved.relativePath);
  const destination = path.join(destinationDir, id);
  await fs.mkdir(destinationDir, { recursive: true });
  await fs.copyFile(resolved.absolutePath, destination);
  return id;
}

export async function readFileTool(config, inputPath) {
  if (!canRead(config, inputPath)) {
    throw new Error(`Path is not readable: ${inputPath}`);
  }

  const resolved = resolveProjectPath(config, inputPath);
  await assertRealPathInsideProject(config, resolved);
  return fs.readFile(resolved.absolutePath, "utf8");
}

export async function writeFileTool(config, inputPath, content) {
  if (!canWrite(config, inputPath)) {
    throw new Error(`Path is not writable: ${inputPath}`);
  }

  return writeReadableFileWithBackup(config, inputPath, content);
}

export async function writeReadableFileWithBackup(config, inputPath, content, options = {}) {
  if (!options.skipReadableCheck && !canRead(config, inputPath)) {
    throw new Error(`Path is not readable: ${inputPath}`);
  }

  const resolved = resolveProjectPath(config, inputPath);
  await assertRealPathInsideProject(config, resolved, { allowMissingLeaf: true });
  const id = await createBackup(config, resolved);
  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await fs.writeFile(resolved.absolutePath, content, "utf8");
  return { backupId: id };
}

export async function copyFileTool(config, src, dst) {
  if (!canRead(config, src)) {
    throw new Error(`Source path is not readable: ${src}`);
  }
  if (!canCopyDestination(config, dst)) {
    throw new Error(`Destination path is not writable: ${dst}`);
  }

  const resolvedSrc = resolveProjectPath(config, src);
  const resolvedDst = resolveProjectPath(config, dst);
  await assertRealPathInsideProject(config, resolvedSrc);
  await assertRealPathInsideProject(config, resolvedDst, { allowMissingLeaf: true });
  const id = await createBackup(config, resolvedDst);
  await fs.mkdir(path.dirname(resolvedDst.absolutePath), { recursive: true });
  await fs.copyFile(resolvedSrc.absolutePath, resolvedDst.absolutePath);
  return { backupId: id };
}

export async function deleteFileTool(config, inputPath) {
  if (!canDelete(config, inputPath)) {
    throw new Error(`Path is not deletable: ${inputPath}`);
  }

  const resolved = resolveProjectPath(config, inputPath);
  await assertRealPathInsideProject(config, resolved);
  const id = await createBackup(config, resolved);
  await fs.unlink(resolved.absolutePath);
  return { backupId: id };
}

export async function listBackupsTool(config, inputPath) {
  if (!canRead(config, inputPath) && !isConfiguredEnvFile(config, inputPath)) {
    throw new Error(`Path is not readable: ${inputPath}`);
  }

  const resolved = resolveProjectPath(config, inputPath);
  const dir = backupDir(config, resolved.relativePath);
  try {
    return (await fs.readdir(dir)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function restoreFileTool(config, inputPath, inputBackupId) {
  if (!canRead(config, inputPath) && !isConfiguredEnvFile(config, inputPath)) {
    throw new Error(`Path is not restorable: ${inputPath}`);
  }

  const resolved = resolveProjectPath(config, inputPath);
  const backups = await listBackupsTool(config, inputPath);
  const id = inputBackupId || backups.at(-1);
  if (!id) {
    throw new Error(`No backups available for: ${inputPath}`);
  }
  if (!backups.includes(id)) {
    throw new Error(`Unknown backup id for ${inputPath}: ${id}`);
  }

  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await assertRealPathInsideProject(config, resolved, { allowMissingLeaf: true });
  await fs.copyFile(path.join(backupDir(config, resolved.relativePath), id), resolved.absolutePath);
  return { backupId: id };
}
