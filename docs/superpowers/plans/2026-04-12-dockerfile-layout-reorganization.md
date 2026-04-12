# Dockerfile Layout Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the image-specific Dockerfiles and their matching Dockerfile-specific ignore files into `docker/` and update every operational reference without changing build behavior.

**Architecture:** Keep the existing explicit Dockerfile naming scheme and relocate the files into a flat `docker/` directory. Preserve repository-root build context (`.`), then update local build commands, Compose, GitHub Actions, and workflow contract scripts so every consumer resolves the new paths. Finish with path-focused verification that checks only operational files, not historical plans/specs.

**Tech Stack:** Docker, Docker Compose, GitHub Actions, Node.js workflow contract scripts, pnpm, ripgrep

---

## File Structure

- Create: `docker/`
  Purpose: single home for all image-specific Docker build inputs.
- Move: `Dockerfile.webapp` -> `docker/Dockerfile.webapp`
- Move: `Dockerfile.worker` -> `docker/Dockerfile.worker`
- Move: `Dockerfile.migration` -> `docker/Dockerfile.migration`
- Move: `Dockerfile.db-seed` -> `docker/Dockerfile.db-seed`
- Move: `Dockerfile.docs` -> `docker/Dockerfile.docs`
- Move: `Dockerfile.marketing` -> `docker/Dockerfile.marketing`
- Move: `Dockerfile.webapp.dockerignore` -> `docker/Dockerfile.webapp.dockerignore`
- Move: `Dockerfile.worker.dockerignore` -> `docker/Dockerfile.worker.dockerignore`
- Move: `Dockerfile.migration.dockerignore` -> `docker/Dockerfile.migration.dockerignore`
- Move: `Dockerfile.db-seed.dockerignore` -> `docker/Dockerfile.db-seed.dockerignore`
- Move: `Dockerfile.docs.dockerignore` -> `docker/Dockerfile.docs.dockerignore`
- Move: `Dockerfile.marketing.dockerignore` -> `docker/Dockerfile.marketing.dockerignore`
- Modify: `package.json`
  Purpose: local `pnpm docker:build*` commands must point at `docker/`.
- Modify: `docker-compose.prod.yml`
  Purpose: production compose services must build from `docker/Dockerfile.*`.
- Modify: `.github/workflows/publish-images.yml`
  Purpose: main app image matrix must publish from `docker/Dockerfile.webapp`, `docker/Dockerfile.worker`, and `docker/Dockerfile.migration`.
- Modify: `.github/workflows/publish-docs-image.yml`
  Purpose: docs publish workflow must build from `docker/Dockerfile.docs`.
- Modify: `.github/workflows/publish-marketing-image.yml`
  Purpose: marketing publish workflow must build from `docker/Dockerfile.marketing`.
- Modify: `scripts/ci/verify-publish-images-workflow.mjs`
  Purpose: workflow contract assertions must expect the new `docker/` matrix entries.
- Modify: `scripts/ci/verify-publish-docs-image-workflow.mjs`
  Purpose: docs workflow contract should assert the relocated Dockerfile path.
- Modify: `deploy/README.md`
  Purpose: deployment documentation and example commands must show `docker/` paths.

### Task 1: Move Docker Build Files Into `docker/`

**Files:**
- Create: `docker/`
- Move: `Dockerfile.webapp` -> `docker/Dockerfile.webapp`
- Move: `Dockerfile.worker` -> `docker/Dockerfile.worker`
- Move: `Dockerfile.migration` -> `docker/Dockerfile.migration`
- Move: `Dockerfile.db-seed` -> `docker/Dockerfile.db-seed`
- Move: `Dockerfile.docs` -> `docker/Dockerfile.docs`
- Move: `Dockerfile.marketing` -> `docker/Dockerfile.marketing`
- Move: `Dockerfile.webapp.dockerignore` -> `docker/Dockerfile.webapp.dockerignore`
- Move: `Dockerfile.worker.dockerignore` -> `docker/Dockerfile.worker.dockerignore`
- Move: `Dockerfile.migration.dockerignore` -> `docker/Dockerfile.migration.dockerignore`
- Move: `Dockerfile.db-seed.dockerignore` -> `docker/Dockerfile.db-seed.dockerignore`
- Move: `Dockerfile.docs.dockerignore` -> `docker/Dockerfile.docs.dockerignore`
- Move: `Dockerfile.marketing.dockerignore` -> `docker/Dockerfile.marketing.dockerignore`

- [ ] **Step 1: Write the failing file-location check**

```bash
set -euo pipefail
for file in \
  Dockerfile.webapp \
  Dockerfile.worker \
  Dockerfile.migration \
  Dockerfile.db-seed \
  Dockerfile.docs \
  Dockerfile.marketing \
  Dockerfile.webapp.dockerignore \
  Dockerfile.worker.dockerignore \
  Dockerfile.migration.dockerignore \
  Dockerfile.db-seed.dockerignore \
  Dockerfile.docs.dockerignore \
  Dockerfile.marketing.dockerignore
do
  test -f "docker/$file"
done
```

- [ ] **Step 2: Run the location check to verify it fails before the move**

Run: `bash -lc 'set -euo pipefail; for file in Dockerfile.webapp Dockerfile.worker Dockerfile.migration Dockerfile.db-seed Dockerfile.docs Dockerfile.marketing Dockerfile.webapp.dockerignore Dockerfile.worker.dockerignore Dockerfile.migration.dockerignore Dockerfile.db-seed.dockerignore Dockerfile.docs.dockerignore Dockerfile.marketing.dockerignore; do test -f "docker/$file"; done'`
Expected: FAIL because `docker/` does not contain the relocated files yet.

- [ ] **Step 3: Create `docker/` and move every Docker build file into it**

```bash
mkdir -p docker
mv Dockerfile.webapp docker/Dockerfile.webapp
mv Dockerfile.worker docker/Dockerfile.worker
mv Dockerfile.migration docker/Dockerfile.migration
mv Dockerfile.db-seed docker/Dockerfile.db-seed
mv Dockerfile.docs docker/Dockerfile.docs
mv Dockerfile.marketing docker/Dockerfile.marketing
mv Dockerfile.webapp.dockerignore docker/Dockerfile.webapp.dockerignore
mv Dockerfile.worker.dockerignore docker/Dockerfile.worker.dockerignore
mv Dockerfile.migration.dockerignore docker/Dockerfile.migration.dockerignore
mv Dockerfile.db-seed.dockerignore docker/Dockerfile.db-seed.dockerignore
mv Dockerfile.docs.dockerignore docker/Dockerfile.docs.dockerignore
mv Dockerfile.marketing.dockerignore docker/Dockerfile.marketing.dockerignore
```

- [ ] **Step 4: Re-run the location check to verify the move passed**

Run: `bash -lc 'set -euo pipefail; for file in Dockerfile.webapp Dockerfile.worker Dockerfile.migration Dockerfile.db-seed Dockerfile.docs Dockerfile.marketing Dockerfile.webapp.dockerignore Dockerfile.worker.dockerignore Dockerfile.migration.dockerignore Dockerfile.db-seed.dockerignore Dockerfile.docs.dockerignore Dockerfile.marketing.dockerignore; do test -f "docker/$file"; done'`
Expected: PASS with no output.

- [ ] **Step 5: Commit the filesystem reorganization**

```bash
git add docker/ Dockerfile.webapp Dockerfile.worker Dockerfile.migration Dockerfile.db-seed Dockerfile.docs Dockerfile.marketing Dockerfile.webapp.dockerignore Dockerfile.worker.dockerignore Dockerfile.migration.dockerignore Dockerfile.db-seed.dockerignore Dockerfile.docs.dockerignore Dockerfile.marketing.dockerignore
git commit -m "refactor: move Dockerfiles into docker dir"
```

### Task 2: Update Local Build And Compose References

**Files:**
- Modify: `package.json`
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Write the failing path check for local build consumers**

```bash
rg -n 'docker/Dockerfile\.(webapp|worker|migration|db-seed|docs)' package.json docker-compose.prod.yml
```

- [ ] **Step 2: Run the path check to verify it fails before editing references**

Run: `rg -n 'docker/Dockerfile\.(webapp|worker|migration|db-seed|docs)' package.json docker-compose.prod.yml`
Expected: no matches yet, so the command exits with status `1`.

- [ ] **Step 3: Update `package.json` docker build scripts to the relocated paths**

```json
"docker:build": "docker build -f docker/Dockerfile.webapp -t z8-webapp:latest .",
"docker:build:webapp": "docker build -f docker/Dockerfile.webapp -t z8-webapp:latest .",
"docker:build:worker": "docker build -f docker/Dockerfile.worker -t z8-worker:latest .",
"docker:build:migration": "docker build -f docker/Dockerfile.migration -t z8-migration:latest .",
"docker:build:seed": "docker build -f docker/Dockerfile.db-seed -t z8-db-seed:latest .",
"docker:build:all": "docker build -f docker/Dockerfile.webapp -t z8-webapp:latest . && docker build -f docker/Dockerfile.worker -t z8-worker:latest . && docker build -f docker/Dockerfile.migration -t z8-migration:latest . && docker build -f docker/Dockerfile.db-seed -t z8-db-seed:latest ."
```

- [ ] **Step 4: Update `docker-compose.prod.yml` build blocks to the relocated paths**

```yaml
migration:
  build:
    context: .
    dockerfile: docker/Dockerfile.migration

db-seed:
  build:
    context: .
    dockerfile: docker/Dockerfile.db-seed

webapp:
  build:
    context: .
    dockerfile: docker/Dockerfile.webapp

docs:
  build:
    context: .
    dockerfile: docker/Dockerfile.docs

worker:
  build:
    context: .
    dockerfile: docker/Dockerfile.worker
```

- [ ] **Step 5: Re-run the path check to verify local references now resolve to `docker/`**

Run: `rg -n 'docker/Dockerfile\.(webapp|worker|migration|db-seed|docs)' package.json docker-compose.prod.yml`
Expected: matches for all updated commands and compose services.

- [ ] **Step 6: Commit the local build and compose path updates**

```bash
git add package.json docker-compose.prod.yml
git commit -m "chore: update local Dockerfile paths"
```

### Task 3: Update Publish Workflows And Workflow Contracts

**Files:**
- Modify: `.github/workflows/publish-images.yml`
- Modify: `.github/workflows/publish-docs-image.yml`
- Modify: `.github/workflows/publish-marketing-image.yml`
- Modify: `scripts/ci/verify-publish-images-workflow.mjs`
- Modify: `scripts/ci/verify-publish-docs-image-workflow.mjs`

- [ ] **Step 1: Write the failing path check for workflow and contract files**

```bash
rg -n 'docker/Dockerfile\.(webapp|worker|migration|docs|marketing)' \
  .github/workflows/publish-images.yml \
  .github/workflows/publish-docs-image.yml \
  .github/workflows/publish-marketing-image.yml \
  scripts/ci/verify-publish-images-workflow.mjs \
  scripts/ci/verify-publish-docs-image-workflow.mjs
```

- [ ] **Step 2: Run the path check to verify it fails before editing CI references**

Run: `rg -n 'docker/Dockerfile\.(webapp|worker|migration|docs|marketing)' .github/workflows/publish-images.yml .github/workflows/publish-docs-image.yml .github/workflows/publish-marketing-image.yml scripts/ci/verify-publish-images-workflow.mjs scripts/ci/verify-publish-docs-image-workflow.mjs`
Expected: no matches yet, so the command exits with status `1`.

- [ ] **Step 3: Update the main publish workflow and its contract script to expect the relocated matrix paths**

```yaml
- repository: z8-webapp
  dockerfile: docker/Dockerfile.webapp
  arch: amd64
  platform: linux/amd64
  runner: ubuntu-latest
- repository: z8-webapp
  dockerfile: docker/Dockerfile.webapp
  arch: arm64
  platform: linux/arm64
  runner: ubuntu-24.04-arm
- repository: z8-worker
  dockerfile: docker/Dockerfile.worker
  arch: amd64
  platform: linux/amd64
  runner: ubuntu-latest
- repository: z8-worker
  dockerfile: docker/Dockerfile.worker
  arch: arm64
  platform: linux/arm64
  runner: ubuntu-24.04-arm
- repository: z8-migration
  dockerfile: docker/Dockerfile.migration
  arch: amd64
  platform: linux/amd64
  runner: ubuntu-latest
- repository: z8-migration
  dockerfile: docker/Dockerfile.migration
  arch: arm64
  platform: linux/arm64
  runner: ubuntu-24.04-arm
```

```js
const includeMatches = [
	...publishTargetsJob.matchAll(
		/repository: (z8-webapp|z8-worker|z8-migration)\n\s+dockerfile: (docker\/Dockerfile\.webapp|docker\/Dockerfile\.worker|docker\/Dockerfile\.migration)\n\s+arch: (amd64|arm64)/g,
	),
];

const expectedMatrixEntries = new Set([
	"z8-webapp:docker/Dockerfile.webapp:amd64",
	"z8-webapp:docker/Dockerfile.webapp:arm64",
	"z8-worker:docker/Dockerfile.worker:amd64",
	"z8-worker:docker/Dockerfile.worker:arm64",
	"z8-migration:docker/Dockerfile.migration:amd64",
	"z8-migration:docker/Dockerfile.migration:arm64",
]);
```

- [ ] **Step 4: Update the docs and marketing workflows plus the docs contract check**

```yaml
# .github/workflows/publish-docs-image.yml
with:
  context: .
  file: ./docker/Dockerfile.docs
  platforms: ${{ matrix.platform }}

# .github/workflows/publish-marketing-image.yml
with:
  context: .
  file: ./docker/Dockerfile.marketing
  platforms: ${{ matrix.platform }}
```

```js
if (buildStep) {
	expect(
		buildStep.includes("file: ./docker/Dockerfile.docs"),
		"Docs image build step must use docker/Dockerfile.docs",
	);
	expect(
		buildStep.includes("labels: |"),
		"Docs image build step must define OCI labels for GHCR package association",
	);
}
```

- [ ] **Step 5: Run workflow contract verification after the edits**

Run: `node scripts/ci/verify-publish-images-workflow.mjs && node scripts/ci/verify-publish-docs-image-workflow.mjs && rg -n 'file: ./docker/Dockerfile.marketing' .github/workflows/publish-marketing-image.yml`
Expected:
- `Publish images workflow contract OK`
- `Publish docs image workflow contract OK`
- one `file: ./docker/Dockerfile.marketing` match in the marketing workflow

- [ ] **Step 6: Commit the CI and contract updates**

```bash
git add .github/workflows/publish-images.yml .github/workflows/publish-docs-image.yml .github/workflows/publish-marketing-image.yml scripts/ci/verify-publish-images-workflow.mjs scripts/ci/verify-publish-docs-image-workflow.mjs
git commit -m "chore: update CI Dockerfile paths"
```

### Task 4: Update Deploy Docs And Run The Final Path Sweep

**Files:**
- Modify: `deploy/README.md`

- [ ] **Step 1: Write the failing documentation path check**

```bash
rg -n 'docker/Dockerfile\.(webapp|worker|migration|db-seed|docs|marketing)' deploy/README.md
```

- [ ] **Step 2: Run the documentation path check to verify it fails before the README edit**

Run: `rg -n 'docker/Dockerfile\.(webapp|worker|migration|db-seed|docs|marketing)' deploy/README.md`
Expected: no matches yet, so the command exits with status `1`.

- [ ] **Step 3: Update `deploy/README.md` to document the relocated Dockerfiles**

```md
Production and support images now build from explicit Dockerfiles in `docker/`.

| Dockerfile | Image Name | Purpose |
|--------|------------|---------|
| `docker/Dockerfile.webapp` | z8-webapp | Next.js production server |
| `docker/Dockerfile.worker` | z8-worker | BullMQ job processor + cron |
| `docker/Dockerfile.migration` | z8-migration | One-shot Drizzle migration |
| `docker/Dockerfile.db-seed` | z8-db-seed | One-shot database seeder |
| `docker/Dockerfile.docs` | z8-docs | Next.js documentation site |
| `docker/Dockerfile.marketing` | z8-marketing | Marketing site |

- Builds `webapp`, `worker`, and `migration` directly from `docker/Dockerfile.webapp`, `docker/Dockerfile.worker`, and `docker/Dockerfile.migration`

docker build -f docker/Dockerfile.webapp -t z8-webapp:latest .
docker build -f docker/Dockerfile.worker -t z8-worker:latest .
docker build -f docker/Dockerfile.migration -t z8-migration:latest .
docker build -f docker/Dockerfile.db-seed -t z8-db-seed:latest .
docker build -f docker/Dockerfile.docs -t z8-docs:latest .
docker build -f docker/Dockerfile.marketing -t z8-marketing:latest .
```

- [ ] **Step 4: Run the final stale-reference sweep only across operational files**

Run: `rg -nP '(?<!docker/)Dockerfile\.(webapp|worker|migration|db-seed|docs|marketing)' package.json docker-compose.prod.yml deploy/README.md .github/workflows scripts/ci`
Expected: no matches, proving there are no remaining bare root Dockerfile references in operational files.

- [ ] **Step 5: Run diff hygiene, contract checks, and the final path-presence checks**

Run: `git diff --check -- package.json docker-compose.prod.yml deploy/README.md .github/workflows/publish-images.yml .github/workflows/publish-docs-image.yml .github/workflows/publish-marketing-image.yml scripts/ci/verify-publish-images-workflow.mjs scripts/ci/verify-publish-docs-image-workflow.mjs && node scripts/ci/verify-publish-images-workflow.mjs && node scripts/ci/verify-publish-docs-image-workflow.mjs && bash -lc 'set -euo pipefail; test ! -f Dockerfile.webapp; test ! -f Dockerfile.worker; test ! -f Dockerfile.migration; test ! -f Dockerfile.db-seed; test ! -f Dockerfile.docs; test ! -f Dockerfile.marketing; test -f docker/Dockerfile.webapp; test -f docker/Dockerfile.worker; test -f docker/Dockerfile.migration; test -f docker/Dockerfile.db-seed; test -f docker/Dockerfile.docs; test -f docker/Dockerfile.marketing'`
Expected:
- no output from `git diff --check`
- `Publish images workflow contract OK`
- `Publish docs image workflow contract OK`
- no output from the shell assertions

- [ ] **Step 6: Commit the documentation and final verification changes**

```bash
git add deploy/README.md
git commit -m "docs: document Dockerfile directory layout"
```
