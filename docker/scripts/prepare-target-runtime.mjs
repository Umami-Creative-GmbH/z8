import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const WEBAPP_ROOT = path.join(REPO_ROOT, "apps", "webapp");
const TARGETS_ROOT = path.join(REPO_ROOT, "docker", "targets");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];
const IMPORT_PATTERN = /(?:import|export)\s+(?:[^\"']+?\s+from\s+)?[\"']([^\"']+)[\"']|import\(\s*[\"']([^\"']+)[\"']\s*\)|require\(\s*[\"']([^\"']+)[\"']\s*\)/g;

function toPackageName(specifier) {
  if (specifier.startsWith("node:")) return null;
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0];
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readIncludeManifest(target) {
  const manifestPath = path.join(TARGETS_ROOT, target, "include.txt");
  const text = await fs.readFile(manifestPath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function resolveFile(baseDir, specifier) {
  const raw = path.resolve(baseDir, specifier);
  const candidates = [
    raw,
    ...SOURCE_EXTENSIONS.map((extension) => `${raw}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(raw, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) {
      continue;
    }

    const stats = await fs.stat(candidate);
    if (stats.isFile()) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve local import: ${specifier} from ${baseDir}`);
}

async function listFilesRecursively(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
      continue;
    }
    files.push(entryPath);
  }

  return files;
}

export async function collectTarget(target) {
  const includeEntries = await readIncludeManifest(target);
  const visitedFiles = new Set();
  const explicitFiles = new Set();
  const externalPackages = new Set();

  async function visitFile(absoluteFilePath) {
    const relativePath = path.relative(WEBAPP_ROOT, absoluteFilePath);
    if (visitedFiles.has(relativePath)) return;
    visitedFiles.add(relativePath);

    const source = await fs.readFile(absoluteFilePath, "utf8");
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;

      if (specifier.startsWith("@/")) {
        const resolved = await resolveFile(path.join(WEBAPP_ROOT, "src"), specifier.slice(2));
        await visitFile(resolved);
        continue;
      }

      if (specifier.startsWith(".")) {
        const resolved = await resolveFile(path.dirname(absoluteFilePath), specifier);
        await visitFile(resolved);
        continue;
      }

      const packageName = toPackageName(specifier);
      if (packageName) externalPackages.add(packageName);
    }
  }

  for (const includeEntry of includeEntries) {
    const absoluteEntryPath = path.join(WEBAPP_ROOT, includeEntry);
    const stats = await fs.stat(absoluteEntryPath);

    if (stats.isDirectory()) {
      const files = await listFilesRecursively(absoluteEntryPath);
      for (const absoluteFilePath of files) {
        explicitFiles.add(path.relative(WEBAPP_ROOT, absoluteFilePath));
        await visitFile(absoluteFilePath);
      }
      continue;
    }

    explicitFiles.add(includeEntry);
    await visitFile(absoluteEntryPath);
  }

  return {
    files: [...new Set([...explicitFiles, ...visitedFiles])].sort(),
    packages: [...externalPackages].sort(),
  };
}

async function writeTargetPackage(target) {
  const rootPackage = await readJson(path.join(REPO_ROOT, "package.json"));
  const webappPackage = await readJson(path.join(WEBAPP_ROOT, "package.json"));
  const { packages } = await collectTarget(target);
  const dependencyEntries = packages.map((packageName) => {
    const version =
      webappPackage.dependencies?.[packageName] ?? webappPackage.devDependencies?.[packageName];

    if (!version) {
      throw new Error(`Package ${packageName} is imported by ${target} but missing from apps/webapp/package.json`);
    }

    return [packageName, version];
  });

  const targetPackage = {
    name: `@z8-target/${target}`,
    private: true,
    packageManager: rootPackage.packageManager,
    pnpm: rootPackage.pnpm,
    dependencies: Object.fromEntries(dependencyEntries),
  };

  const outputPath = path.join(TARGETS_ROOT, target, "package.json");
  await fs.writeFile(outputPath, `${JSON.stringify(targetPackage, null, 2)}\n`);
  console.log(`wrote ${path.relative(REPO_ROOT, outputPath)}`);
}

async function copyTargetRuntime(target, outputDirectory) {
  const outputPath = path.resolve(outputDirectory);
  const { files } = await collectTarget(target);

  await fs.rm(outputPath, { recursive: true, force: true });
  await ensureDir(outputPath);

  for (const relativePath of files) {
    const sourcePath = path.join(WEBAPP_ROOT, relativePath);
    const destinationPath = path.join(outputPath, relativePath);
    await ensureDir(path.dirname(destinationPath));
    await fs.copyFile(sourcePath, destinationPath);
  }

  await fs.copyFile(
    path.join(TARGETS_ROOT, target, "package.json"),
    path.join(outputPath, "package.json"),
  );
  await fs.copyFile(
    path.join(TARGETS_ROOT, target, "pnpm-lock.yaml"),
    path.join(outputPath, "pnpm-lock.yaml"),
  );
}

async function main() {
  const [command, target, outputDirectory] = process.argv.slice(2);

  if (!command || !target) {
    throw new Error("Usage: pnpm node docker/scripts/prepare-target-runtime.mjs <list|manifest|copy> <target> [outputDir]");
  }

  if (command === "list") {
    console.log(JSON.stringify(await collectTarget(target), null, 2));
    return;
  }

  if (command === "manifest") {
    await writeTargetPackage(target);
    return;
  }

  if (command === "copy") {
    if (!outputDirectory) {
      throw new Error("copy requires an output directory");
    }
    await copyTargetRuntime(target, outputDirectory);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
