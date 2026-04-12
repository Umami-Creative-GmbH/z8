# Non-Web Image Trimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim the `worker`, `migration`, and `db-seed` images so they install only target-specific dependencies and copy only the runtime files those entrypoints actually need.

**Architecture:** Add a small packaging layer under `docker/targets/` plus one helper script that can resolve runtime file graphs from `apps/webapp`, generate committed per-target `package.json` files, and assemble target-specific runtime directories for Docker builds. Rework the three non-web Dockerfiles to stop pruning or copying the full webapp workspace, and instead install from committed target manifests plus target lockfiles.

**Tech Stack:** Docker, pnpm, Node.js, tsx, Drizzle Kit, Next.js repo layout, simple Node filesystem scripting

---

## File Map

- Create: `docker/scripts/prepare-target-runtime.mjs`
  Purpose: read a target include manifest, trace local imports under `apps/webapp`, collect bare package imports, generate a committed target `package.json`, and assemble a flattened runtime tree for Docker builds.
- Create: `docker/targets/worker/include.txt`
  Purpose: define the worker runtime roots that should be traced and copied.
- Create: `docker/targets/migration/include.txt`
  Purpose: define the migration runtime roots that should be traced and copied.
- Create: `docker/targets/db-seed/include.txt`
  Purpose: define the db-seed runtime roots that should be traced and copied.
- Create: `docker/targets/worker/package.json`
  Purpose: committed trimmed dependency manifest for the worker image.
- Create: `docker/targets/migration/package.json`
  Purpose: committed trimmed dependency manifest for the migration image.
- Create: `docker/targets/db-seed/package.json`
  Purpose: committed trimmed dependency manifest for the db-seed image.
- Create: `docker/targets/worker/pnpm-lock.yaml`
  Purpose: pinned dependency graph for worker image installs.
- Create: `docker/targets/migration/pnpm-lock.yaml`
  Purpose: pinned dependency graph for migration image installs.
- Create: `docker/targets/db-seed/pnpm-lock.yaml`
  Purpose: pinned dependency graph for db-seed image installs.
- Modify: `package.json`
  Purpose: add one repo-level script to regenerate all target manifests and target lockfiles.
- Modify: `apps/webapp/scripts/migrate-with-lock.js`
  Purpose: switch the default migration command from `pnpm dlx` to `pnpm exec` so the trimmed migration image can use its committed runtime dependency set without network fetches at container start.
- Modify: `docker/Dockerfile.worker`
  Purpose: replace the current `turbo prune` plus broad `apps/webapp` copy flow with target assembly plus target-local install.
- Modify: `docker/Dockerfile.migration`
  Purpose: replace the current `turbo prune` plus broad `apps/webapp` copy flow with target assembly plus target-local install.
- Modify: `docker/Dockerfile.db-seed`
  Purpose: replace the current `turbo prune` plus broad `apps/webapp` copy flow with target assembly plus target-local install.

### Task 1: Add Target Runtime Metadata And Generation Tooling

**Files:**
- Create: `docker/scripts/prepare-target-runtime.mjs`
- Create: `docker/targets/worker/include.txt`
- Create: `docker/targets/migration/include.txt`
- Create: `docker/targets/db-seed/include.txt`
- Modify: `package.json`
- Test: `docker/scripts/prepare-target-runtime.mjs`

- [ ] **Step 1: Verify the target packaging script does not exist yet**

Run: `pnpm node docker/scripts/prepare-target-runtime.mjs list worker`

Expected: FAIL with a Node module resolution error because `docker/scripts/prepare-target-runtime.mjs` does not exist yet.

- [ ] **Step 2: Create the target include manifests**

Create `docker/targets/worker/include.txt`:

```text
src/worker.ts
tsconfig.json
```

Create `docker/targets/migration/include.txt`:

```text
scripts/migrate-with-lock.js
drizzle.config.ts
drizzle/
src/db/auth-schema.ts
src/db/schema/index.ts
tsconfig.json
```

Create `docker/targets/db-seed/include.txt`:

```text
src/db/seed/do-seed.ts
tsconfig.json
```

- [ ] **Step 3: Create the runtime preparation script**

Create `docker/scripts/prepare-target-runtime.mjs`:

```js
import fs from "node:fs/promises";
import path from "node:path";

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
    if (await pathExists(candidate)) {
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Add a repo script that regenerates all target manifests and target lockfiles**

Update `package.json` inside the `scripts` block with:

```json
"docker:sync:non-web-targets": "pnpm node docker/scripts/prepare-target-runtime.mjs manifest worker && pnpm node docker/scripts/prepare-target-runtime.mjs manifest migration && pnpm node docker/scripts/prepare-target-runtime.mjs manifest db-seed && pnpm --dir docker/targets/worker install --lockfile-only --ignore-workspace && pnpm --dir docker/targets/migration install --lockfile-only --ignore-workspace && pnpm --dir docker/targets/db-seed install --lockfile-only --ignore-workspace"
```

- [ ] **Step 5: Run the new script and inspect the traced output for each target**

Run: `pnpm docker:sync:non-web-targets && pnpm node docker/scripts/prepare-target-runtime.mjs list worker && pnpm node docker/scripts/prepare-target-runtime.mjs list migration && pnpm node docker/scripts/prepare-target-runtime.mjs list db-seed`

Expected:

- PASS
- `docker/targets/worker/package.json` exists
- `docker/targets/migration/package.json` exists
- `docker/targets/db-seed/package.json` exists
- each `list` command prints a JSON object with `files` and `packages`

- [ ] **Step 6: Commit the target packaging metadata and tooling**

```bash
git add package.json docker/scripts/prepare-target-runtime.mjs docker/targets/worker/include.txt docker/targets/migration/include.txt docker/targets/db-seed/include.txt docker/targets/worker/package.json docker/targets/migration/package.json docker/targets/db-seed/package.json docker/targets/worker/pnpm-lock.yaml docker/targets/migration/pnpm-lock.yaml docker/targets/db-seed/pnpm-lock.yaml
git commit -m "build: add non-web image target manifests"
```

### Task 2: Make Migration Runtime Use Local Tooling

**Files:**
- Modify: `apps/webapp/scripts/migrate-with-lock.js`
- Test: `apps/webapp/scripts/migrate-with-lock.js`

- [ ] **Step 1: Verify the migration script still defaults to `pnpm dlx`**

Run: `rg -n 'pnpm dlx drizzle-kit migrate' apps/webapp/scripts/migrate-with-lock.js`

Expected: one matching line showing the current default migration command.

- [ ] **Step 2: Switch the default migration command to the locally installed binary**

Update `apps/webapp/scripts/migrate-with-lock.js`:

```js
const migrateCommand =
  process.env.DRIZZLE_MIGRATE_COMMAND ??
  "pnpm exec drizzle-kit migrate --config ./drizzle.config.ts";
```

- [ ] **Step 3: Verify the updated default command is in place**

Run: `rg -n 'pnpm exec drizzle-kit migrate' apps/webapp/scripts/migrate-with-lock.js`

Expected: one matching line showing the new default command.

- [ ] **Step 4: Commit the migration command update**

```bash
git add apps/webapp/scripts/migrate-with-lock.js
git commit -m "build: use local drizzle binary in migration image"
```

### Task 3: Rebuild The Worker Image Around The Target Runtime

**Files:**
- Modify: `docker/Dockerfile.worker`
- Test: `docker/Dockerfile.worker`

- [ ] **Step 1: Record baseline image sizes before any Dockerfile rewrite**

Run: `docker build -f docker/Dockerfile.worker -t z8-worker:baseline . && docker build -f docker/Dockerfile.migration -t z8-migration:baseline . && docker build -f docker/Dockerfile.db-seed -t z8-db-seed:baseline . && docker image inspect z8-worker:baseline z8-migration:baseline z8-db-seed:baseline --format '{{.RepoTags}} {{.Size}}'`

Expected: PASS. Three baseline images build successfully and print numeric sizes that will be compared against the rewritten images later.

- [ ] **Step 2: Confirm the current worker image still copies broad webapp payloads**

Run: `rg -n '\.next|COPY --from=workspace .*/src|COPY --from=workspace .*/public|turbo prune webapp --docker' docker/Dockerfile.worker`

Expected: matches showing that the worker image still prunes `webapp`, copies `.next`, and copies broad app directories.

- [ ] **Step 3: Replace the worker Dockerfile with target runtime assembly**

Update `docker/Dockerfile.worker` to:

```Dockerfile
# syntax=docker/dockerfile:1.4
ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

RUN apk add --no-cache \
    ca-certificates \
    curl \
    libc6-compat \
    libstdc++ \
    tini

ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p "${PNPM_HOME}"

WORKDIR /repo

FROM base AS assembler
COPY apps/webapp ./apps/webapp
COPY docker/scripts ./docker/scripts
COPY docker/targets ./docker/targets
RUN node docker/scripts/prepare-target-runtime.mjs copy worker /runtime

FROM base AS worker
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 app

WORKDIR /app

COPY --from=assembler /runtime/package.json ./package.json
COPY --from=assembler /runtime/pnpm-lock.yaml ./pnpm-lock.yaml

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-workspace

COPY --from=assembler --chown=app:nodejs /runtime/ ./

USER app
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "exec", "tsx", "src/worker.ts"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "const Redis=require('ioredis');const r=new Redis({host:process.env.VALKEY_HOST||'localhost',port:process.env.VALKEY_PORT||6379,password:process.env.VALKEY_PASSWORD,lazyConnect:false});r.ping().then(()=>process.exit(0)).catch(()=>process.exit(1))"
```

- [ ] **Step 4: Build the worker image and verify the runtime no longer contains `.next`**

Run: `docker build -f docker/Dockerfile.worker -t z8-worker:test . && docker run --rm --entrypoint sh z8-worker:test -lc 'test ! -d .next && test ! -d public && test -f src/worker.ts && test -f package.json'`

Expected: PASS. The build succeeds and the runtime inspection command exits 0.

- [ ] **Step 5: Commit the worker image rewrite**

```bash
git add docker/Dockerfile.worker
git commit -m "build: trim worker image payload"
```

### Task 4: Rebuild The Migration Image Around The Target Runtime

**Files:**
- Modify: `docker/Dockerfile.migration`
- Test: `docker/Dockerfile.migration`

- [ ] **Step 1: Confirm the current migration image still copies broad webapp payloads**

Run: `rg -n '\.next|COPY --from=workspace .*/src|COPY --from=workspace .*/public|turbo prune webapp --docker' docker/Dockerfile.migration`

Expected: matches showing that the migration image still prunes `webapp`, copies `.next`, and copies broad app directories.

- [ ] **Step 2: Replace the migration Dockerfile with target runtime assembly**

Update `docker/Dockerfile.migration` to:

```Dockerfile
# syntax=docker/dockerfile:1.4
ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

RUN apk add --no-cache \
    ca-certificates \
    curl \
    libc6-compat \
    libstdc++ \
    tini

ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p "${PNPM_HOME}"

WORKDIR /repo

FROM base AS assembler
COPY apps/webapp ./apps/webapp
COPY docker/scripts ./docker/scripts
COPY docker/targets ./docker/targets
RUN node docker/scripts/prepare-target-runtime.mjs copy migration /runtime

FROM base AS migration
WORKDIR /app

COPY --from=assembler /runtime/package.json ./package.json
COPY --from=assembler /runtime/pnpm-lock.yaml ./pnpm-lock.yaml

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-workspace

COPY --from=assembler /runtime/ ./

CMD ["node", "./scripts/migrate-with-lock.js"]
```

- [ ] **Step 3: Build the migration image and verify the runtime only contains migration assets**

Run: `docker build -f docker/Dockerfile.migration -t z8-migration:test . && docker run --rm --entrypoint sh z8-migration:test -lc 'test ! -d .next && test ! -d public && test -f scripts/migrate-with-lock.js && test -f drizzle.config.ts && test -d drizzle'`

Expected: PASS. The build succeeds and the runtime inspection command exits 0.

- [ ] **Step 4: Commit the migration image rewrite**

```bash
git add docker/Dockerfile.migration
git commit -m "build: trim migration image payload"
```

### Task 5: Rebuild The Db-Seed Image Around The Target Runtime

**Files:**
- Modify: `docker/Dockerfile.db-seed`
- Test: `docker/Dockerfile.db-seed`

- [ ] **Step 1: Confirm the current db-seed image still installs the broad webapp workspace**

Run: `rg -n 'turbo prune webapp --docker|COPY --from=workspace .*/src|COPY --from=deps .*/apps/webapp/node_modules' docker/Dockerfile.db-seed`

Expected: matches showing that the db-seed image still prunes `webapp` and installs the broad webapp workspace.

- [ ] **Step 2: Replace the db-seed Dockerfile with target runtime assembly**

Update `docker/Dockerfile.db-seed` to:

```Dockerfile
# syntax=docker/dockerfile:1.4
ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

RUN apk add --no-cache \
    ca-certificates \
    curl \
    libc6-compat \
    libstdc++ \
    tini

ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p "${PNPM_HOME}"

WORKDIR /repo

FROM base AS assembler
COPY apps/webapp ./apps/webapp
COPY docker/scripts ./docker/scripts
COPY docker/targets ./docker/targets
RUN node docker/scripts/prepare-target-runtime.mjs copy db-seed /runtime

FROM base AS db-seed
WORKDIR /app

COPY --from=assembler /runtime/package.json ./package.json
COPY --from=assembler /runtime/pnpm-lock.yaml ./pnpm-lock.yaml

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-workspace

COPY --from=assembler /runtime/ ./

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "exec", "tsx", "src/db/seed/do-seed.ts"]
```

- [ ] **Step 3: Build the db-seed image and verify the runtime excludes non-seed assets**

Run: `docker build -f docker/Dockerfile.db-seed -t z8-db-seed:test . && docker run --rm --entrypoint sh z8-db-seed:test -lc 'test ! -d .next && test ! -d public && test -f src/db/seed/do-seed.ts && test ! -f scripts/migrate-with-lock.js'`

Expected: PASS. The build succeeds and the runtime inspection command exits 0.

- [ ] **Step 4: Commit the db-seed image rewrite**

```bash
git add docker/Dockerfile.db-seed
git commit -m "build: trim db seed image payload"
```

### Task 6: Run End-To-End Verification And Capture The Reduction

**Files:**
- Modify: `docker/targets/worker/package.json`
- Modify: `docker/targets/migration/package.json`
- Modify: `docker/targets/db-seed/package.json`
- Modify: `docker/targets/worker/pnpm-lock.yaml`
- Modify: `docker/targets/migration/pnpm-lock.yaml`
- Modify: `docker/targets/db-seed/pnpm-lock.yaml`
- Test: `docker/Dockerfile.worker`
- Test: `docker/Dockerfile.migration`
- Test: `docker/Dockerfile.db-seed`

- [ ] **Step 1: Regenerate manifests one final time after the Dockerfile rewrites**

Run: `pnpm docker:sync:non-web-targets`

Expected: PASS. The three target `package.json` files and three target `pnpm-lock.yaml` files are updated to match the latest traced imports.

- [ ] **Step 2: Verify the migration and seed manifests do not carry obvious web-only packages**

Run: `rg -n 'react|react-dom|@radix-ui|next-themes|recharts' docker/targets/migration/package.json docker/targets/db-seed/package.json`

Expected: no matches.

- [ ] **Step 3: Rebuild all three trimmed images**

Run: `docker build -f docker/Dockerfile.worker -t z8-worker:test . && docker build -f docker/Dockerfile.migration -t z8-migration:test . && docker build -f docker/Dockerfile.db-seed -t z8-db-seed:test .`

Expected: PASS. All three images build successfully.

- [ ] **Step 4: Record image sizes for the rewritten images and compare them to baseline**

Run: `docker image inspect z8-worker:baseline z8-migration:baseline z8-db-seed:baseline z8-worker:test z8-migration:test z8-db-seed:test --format '{{.RepoTags}} {{.Size}}'`

Expected: six lines of numeric image sizes showing the baseline tags and the rewritten tags so the reduction is directly visible.

- [ ] **Step 5: Commit the final regenerated manifests and lockfiles**

```bash
git add docker/targets/worker/package.json docker/targets/migration/package.json docker/targets/db-seed/package.json docker/targets/worker/pnpm-lock.yaml docker/targets/migration/pnpm-lock.yaml docker/targets/db-seed/pnpm-lock.yaml
git commit -m "build: pin trimmed non-web image dependencies"
```
