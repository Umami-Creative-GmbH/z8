# Docker Runtime And Standalone Optimization Design

## Purpose

Z8 runtime images currently work, but some launch paths can still invoke package-manager shims. In particular, Corepack may download `pnpm@11.3.0` at container startup when a runtime command uses `pnpm`. The goal is to make runtime containers more deterministic, reduce image size where practical, and keep build behavior stable.

## Scope

This work covers the production Docker images and deployment manifests for:

- `z8-webapp`
- `z8-worker`
- `z8-migration`
- `z8-db-seed`
- `z8-docs`
- `z8-marketing`

It does not change application behavior, deployment topology, registry publishing semantics, or environment variable contracts.

## Design Goals

- Runtime containers should not need to execute `pnpm`, `pnpm exec`, or `bun x` to start normal workloads.
- Build stages may continue using Corepack and pnpm.
- Runtime images should copy the smallest dependable set of files.
- Next.js applications should use standalone output when it is compatible with their runtime needs.
- Changes should be phased so low-risk runtime command cleanup can be verified separately from image-size reductions.

## Phase 1: Runtime Command Cleanup

### Migration Image

The migration image already starts with `node ./scripts/migrate-with-lock.js`. The script currently defaults to `pnpm exec drizzle-kit migrate --config ./drizzle.config.ts`, and the production Kubernetes job overrides `DRIZZLE_MIGRATE_COMMAND` with the same package-manager command.

Change both paths to use the local installed binary:

```sh
./node_modules/.bin/drizzle-kit migrate --config ./drizzle.config.ts
```

This keeps the advisory-lock wrapper intact while removing Corepack from the runtime migration path.

### DB Seed Image

The seed image currently starts through `pnpm exec tsx`. Change it to use the local `tsx` binary when available:

```json
["./node_modules/.bin/tsx", "src/db/seed/do-seed.ts"]
```

If the runtime target does not include `tsx` as a dependency, add it to the generated seed target dependencies rather than relying on a global package-manager install.

### Worker Image

The worker image starts with `tsx src/worker.ts` after installing `tsx` globally. Prefer an explicit local binary:

```json
["./node_modules/.bin/tsx", "src/worker.ts"]
```

If `tsx` is not present in the runtime dependency graph, add it to the worker runtime target. Avoid depending on a global install in the final image unless a local dependency is not feasible.

### Marketing Image

The marketing image starts with `bun x next start`. This is similar to package-manager execution at runtime. Replace it with a direct local Next startup command or, after the standalone pass, a standalone `server.js` command. The preferred final state is not to require Bun for runtime startup unless the app specifically needs Bun APIs.

## Phase 2: Next Standalone Runtime Images

Enable or verify Next.js standalone output for the `webapp`, `docs`, and `marketing` apps. Runtime images should copy only traced standalone files and required static assets:

- `.next/standalone`
- `.next/static`
- `public`
- app content files that Next tracing does not include but the app reads at runtime
- generated data files required by startup or rendered pages

Runtime startup should use the standalone server entrypoint, usually:

```sh
node server.js
```

For monorepo standalone output, the Dockerfile must place files so the generated server entrypoint can resolve package paths exactly as Next expects.

## File And Runtime Considerations

The webapp currently copies source, scripts, Drizzle files, config files, and broad `node_modules` into the final image. During the standalone pass, each copied path must be justified by runtime usage.

Known runtime-sensitive paths include:

- `apps/webapp/scripts/migrate-with-lock.js` for migration images
- `apps/webapp/drizzle` and `apps/webapp/drizzle.config.ts` for migrations
- generated license data under `apps/webapp/src/data/licenses.json` if rendered at runtime
- docs content/source config if the docs app reads them after build
- public/static assets for all Next apps

If standalone tracing misses a required file, explicitly copy that file rather than falling back to copying the full app tree.

## Testing

Verification should happen in increasing scope:

1. Run Docker workflow contract tests.
2. Build affected images locally when feasible.
3. Start containers with minimal required environment and verify the expected process launches without package-manager download messages.
4. Smoke-test HTTP images through their health endpoints.
5. Verify migration and seed commands can resolve local binaries in their runtime images.
6. Run the GitHub image publishing workflow through a branch or merged main run and confirm all target and manifest jobs pass.

Application unit tests are not the primary proof for this change because the behavior under test is image composition and startup. Run app tests only if implementation changes touch application code.

## Rollout

Implement in two commits or PR sections:

1. Runtime command cleanup for migration, seed, worker, and marketing startup paths.
2. Standalone image conversion for webapp, docs, and marketing.

If standalone conversion exposes tracing gaps or app-specific runtime assumptions, keep the runtime cleanup and split the standalone work into smaller app-specific follow-ups.

## Risks

- Next standalone tracing may omit files loaded dynamically at runtime.
- Monorepo path layout can make standalone `server.js` placement non-obvious.
- Switching marketing away from `bun x` may reveal a hidden runtime dependency on Bun behavior.
- Local image builds may be slower during validation, especially multi-arch workflows.

## Success Criteria

- Production runtime commands no longer invoke `pnpm exec` or `bun x`.
- Containers do not print Corepack package-manager download messages during normal startup.
- Webapp, docs, and marketing images use standalone runtime layout where compatible.
- Image publishing workflows complete successfully.
- Runtime smoke tests pass for webapp, docs, marketing, worker, migration, and seed images.
