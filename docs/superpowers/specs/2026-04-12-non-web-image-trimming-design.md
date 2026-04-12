# Non-Web Image Trimming Design

## Goal

Reduce the runtime size and dependency surface of the `worker`, `migration`, and `db-seed` images so they no longer package the full webapp payload.

## Why

The current Dockerfiles are split per image, but the non-web targets still behave like thin wrappers around the `webapp` workspace. All three images prune `webapp`, install the webapp dependency graph, and then copy broad slices of `apps/webapp` into the final runtime image. `worker` and `migration` currently copy Next build output and large application directories, while `db-seed` still installs the full webapp workspace just to run the seed entrypoint.

That produces images that are larger than necessary, harder to reason about, and more likely to drift because runtime packaging is based on broad directory copies instead of explicit target needs.

## Recommended Approach

Add a small target-packaging layer under `docker/targets/` and keep the application code in `apps/webapp` unchanged.

Each target gets:

- a committed trimmed `package.json`
- an explicit payload manifest describing which files belong in that target runtime
- any target-local packaging helper files needed by the Docker build

The Dockerfiles for `worker`, `migration`, and `db-seed` then assemble a dedicated runtime workspace for that target instead of copying most of `apps/webapp` into the image.

## Target Layout

Use a flat target structure under `docker/targets/`:

- `docker/targets/worker/package.json`
- `docker/targets/worker/include.txt`
- `docker/targets/migration/package.json`
- `docker/targets/migration/include.txt`
- `docker/targets/db-seed/package.json`
- `docker/targets/db-seed/include.txt`

If the Docker build needs shared packaging logic, place it under `docker/` as a small helper script rather than spreading custom shell logic across the Dockerfiles.

## Runtime Model

The `webapp` image is not part of this change.

For each non-web target, the Docker build should:

1. start from the repository build context as it does today
2. create a target-specific runtime workspace
3. copy only the files listed for that target into the workspace
4. copy in the target's committed trimmed `package.json`
5. install only the dependencies required by that target runtime, including any execution tooling the container command depends on
6. set the working directory to that runtime workspace and run the target entrypoint

This shifts packaging from directory-level copying to explicit runtime assembly.

## Per-Target Scope

### Worker

The worker image should carry only the worker entrypoint and the runtime modules it imports.

Expected inclusions:

- `src/worker.ts`
- worker runtime dependencies under `src/lib/**` that are actually imported by the worker code path
- any runtime config files required to resolve those imports

Expected exclusions unless imports prove otherwise:

- `.next`
- `public`
- route handlers and UI code
- migration files
- seed files

The worker image should no longer copy Next build output by default.

### Migration

The migration image should carry only the migration runner and the files needed by `drizzle-kit migrate`.

Expected inclusions:

- `scripts/migrate-with-lock.js`
- `drizzle.config.ts`
- `drizzle/**`
- schema sources referenced by `drizzle.config.ts`
- any DB modules required for migration execution

Expected exclusions:

- `.next`
- `public`
- route handlers and UI code
- worker-only code
- seed-only code unless a shared import requires it

The migration image should be able to run without shipping the broader webapp runtime tree.

### Db-Seed

The db-seed image should carry only the seed entrypoint and the files required by the seed path.

Expected inclusions:

- `src/db/seed/do-seed.ts`
- `src/db/seed/**`
- schema and DB modules imported by the seed path
- any static seed data or helper modules required by those imports

Expected exclusions:

- `.next`
- `public`
- route handlers and UI code
- migration-only scripts
- unrelated operational code not used by the seed path

## Dependency Strategy

The trimmed `package.json` for each target is committed to the repository and becomes the dependency contract for that image.

The target manifests should contain only the dependencies needed at runtime for that target. That includes execution tools that are part of the container contract, such as `tsx` for TS entrypoints or migration tooling needed by the migration command. They should not inherit the entire `apps/webapp/package.json` dependency set just because the source files happen to live under `apps/webapp`.

This design intentionally prefers explicit target manifests over inferred manifests so the image boundary is visible in code review.

## File Boundaries

Keep these boundaries explicit:

- target packaging metadata lives under `docker/targets/*`
- Dockerfile orchestration stays in `docker/Dockerfile.*`
- application runtime code remains in `apps/webapp`
- no broader refactor into new packages or apps in this pass

## Non-Goals

- No refactor of worker, migration, or seed code into separate packages
- No changes to the `webapp` image
- No behavior changes to migration, seed, or worker execution beyond packaging
- No change to deployment wiring, image names, or container entrypoint intent
- No attempt to generalize this pattern to every image in the repository during this pass

## Risks

The main risk is drift between the committed target manifests and the actual runtime imports.

Specific risks:

- the worker import graph may reach more shared modules than expected
- `drizzle-kit migrate` may need schema or config inputs that are easy to miss if packaging is too aggressive
- seed code may depend on shared DB helpers outside the initial seed folder assumptions

## Failure Model

Missing files or dependency mismatches should fail during image build, not after deployment.

The implementation should therefore prefer explicit copy steps or manifest-driven checks that make a missing runtime file obvious during `docker build`.

If one target proves broader than expected, widen only that target's payload. Do not fall back to copying all of `apps/webapp` for every image.

## Validation

The implementation should verify both correctness and trimming:

- build `docker/Dockerfile.worker`
- build `docker/Dockerfile.migration`
- build `docker/Dockerfile.db-seed`
- confirm each build succeeds with the target-specific manifest and payload
- inspect the final image contents or layer behavior to confirm `.next` and unrelated webapp assets are gone from migration and seed, and removed or sharply reduced for worker
- compare image sizes before and after the change

Suggested verification commands:

- `docker build -f docker/Dockerfile.worker -t z8-worker:test .`
- `docker build -f docker/Dockerfile.migration -t z8-migration:test .`
- `docker build -f docker/Dockerfile.db-seed -t z8-db-seed:test .`

## Implementation Shape

This should be implemented as a focused packaging change:

1. add committed target manifests and file lists under `docker/targets/`
2. update the three non-web Dockerfiles to assemble target-specific runtime workspaces
3. keep the app code in place and avoid broader structural refactors
4. verify the resulting images still run their intended entrypoints with reduced payloads

The safest version of this work is the smallest one that makes the target boundaries explicit and removes the current dependency on copying the full webapp runtime into non-web images.
