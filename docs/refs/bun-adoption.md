# Bun adoption assessment

Assessed on 2026-11-16 with Bun 1.4.4, Node 26.13.0 and pnpm 12.21.0.

Bun is viable as Z8's package manager. Completely replacing Node is not a
drop-in change: the worker preload fails on Bun, and the performance evidence
tools intentionally depend on Node/V8 behavior. Keep Node and pnpm in the
supported configuration until a coordinated migration is implemented. The
oxlint/oxfmt migration is independent of that decision.

## Tooling migration delivered

Oxlint 1.94.0 and Oxfmt 0.79.0 replace Biome/Ultracite in dependencies, shared
configuration, scripts, editor settings, workflows and catalog generation.
Suppression comments were migrated; application logic was not rewritten.
The general quality workflow retains its existing manual-only trigger.

Validation passed: frozen pnpm installation, 60 Docker/CI tooling tests, 125
catalog and worker-preload tests, and focused formatter/linter checks. Repeated
catalog generation produced the same file hash. The full source checks still
report 90 lint errors, 229 warnings and 2,268 formatting differences. These
are migration/source debt, not a clean baseline; no broad fixes were applied.

## Package manager

A scratch copy of the manifests, patches and original lockfile was migrated
with `bun pm migrate`, then installed with `bun install --frozen-lockfile`.

- All 2,126 unique package versions and integrity hashes were preserved.
- Workspace overrides and patch mappings migrated. The Drizzle patch was
  physically applied, and `pako/lib/zlib/deflate.js` resolved.
- The normal install ran the docs workspace's Fumadocs generation successfully.
- Turbo 2.11.11 `prune webapp --docker` and a frozen install of the result passed.
- The worker, migration and db-seed standalone manifests and locks each migrated
  and passed a frozen production install.

The source checkout was not converted to Bun. These experiments used the
dependency graph before replacing Biome/Ultracite with oxlint/oxfmt.

Bun did not migrate `allowBuilds` to `trustedDependencies`. Explicitly preserve
the eight allowed packages and the exclusion of `core-js`; otherwise Bun uses
its default trust list. Also change `packageManager`, preserve the hoisting
configuration, and choose the linker explicitly. See Bun's [migration
documentation](https://bun.sh/docs/pm/cli/install), [lifecycle script
policy](https://bun.sh/docs/pm/lifecycle), and [npmrc
support](https://bun.sh/docs/pm/npmrc).

The coordinated change must cover all six Dockerfiles, the three independent
Docker target lockfiles and their generator, CI setup/cache/filter commands,
package scripts, Tauri commands, and performance scripts that explicitly invoke
pnpm. Turbo pruning worked in isolation; it does not certify the final runtime
images. See [Turbo prune](https://turborepo.com/docs/reference/prune).

## Runtime

### Confirmed blockers

From `apps/webapp`:

```sh
bun --import ./src/worker-preload.mjs -e 'console.log("ok")'
```

This exits with `Export named 'registerHooks' not found in module 'node:module'`.
[worker-preload.mjs](../../apps/webapp/src/worker-preload.mjs) uses that API to
allow `server-only` imports while retaining React exports needed for email
rendering. The worker and several operational commands use this preload.
Replace it with a tested Bun-compatible resolver before switching those entry
points. Bun documents the missing API in its [Node compatibility
reference](https://bun.sh/docs/runtime/nodejs-compat).

[mixed-technical-gzip.mjs](../../scripts/performance/mixed-technical-gzip.mjs)
requires specific Node/zlib versions and rejects Bun. The V8 GC sequence
`setFlagsFromString("--expose_gc"); runInNewContext("gc")` also fails on Bun.
Performance evidence needs requalification if the runtime changes.

`bun --test` is not a replacement for `node --test`. Explicitly running
`bun test scripts/performance/clean-evidence.test.mjs
scripts/performance/action-result-observer.test.mjs` passed 51 tests. That is
partial test compatibility, not evidence that the Vitest suites or V8 coverage
can move unchanged. Keep the existing runners during initial adoption.

### Remaining validation

Bun's [Next.js guide](https://bun.sh/guides/ecosystem/nextjs) documents running
Next through `bun --bun`. Z8 still needs production builds and route smoke
tests, worker/email startup, Pino worker transports, pg and HTTP telemetry,
native dependencies, timezone suites, and graceful shutdown tests on its actual
images. `bun run` alone can still invoke Node through executable shebangs;
successful scripts are not proof of a Bun-only runtime.

## Built-in APIs

### S3: suitable for basic object storage, not complete SDK removal

The installed runtime exposes `Bun.S3Client`. A local, offline presigning probe
with dummy credentials produced an AWS4-HMAC-SHA256 URL with the expected
bucket/key path. This does not validate a real storage service.

Bun's [S3 API](https://bun.sh/docs/runtime/s3) provides reading, writing,
streaming, automatic multipart upload, deletion, metadata, listing and presigned
URLs. Ordinary public asset operations are a reasonable first candidate.
Continue passing explicit organization-specific credentials and configuration;
do not replace the existing tenant-scoped Vault lookup with a global client.

[export-s3-client.ts](../../apps/webapp/src/lib/storage/export-s3-client.ts)
also uses bucket enumeration, version enumeration, copy and explicit multipart
commands. [worm-storage-adapter.ts](../../apps/webapp/src/lib/audit-export/infrastructure/storage/worm-storage-adapter.ts)
reads and writes Object Lock retention. These operations have no corresponding
methods in the inspected Bun client API. Keep the AWS SDK for them. The
`@tus/s3-store` integration independently uses the AWS SDK, so migrating simple
object reads/writes would not remove that dependency.

Validate RustFS/MinIO and configured production providers, path-style addressing,
expiry, streaming failures and multipart abort behavior before changing adapters.

### Images: useful subset, retain Sharp for current full behavior

Bun 1.4.4 includes `Bun.Image`. A real probe decoded Z8's 512×512 PNG icon,
resized it to 128×128, encoded WebP at quality 82, and read back its dimensions
and format successfully. Pixel limits, orientation handling and resizing without
enlargement have documented options. See [Bun Image](https://bun.sh/docs/runtime/image).

[vehicle-photo-processing.ts](../../apps/webapp/src/lib/organization/vehicles/vehicle-photo-processing.ts)
also requires strict decoding and rejects animated inputs using Sharp's `pages`
metadata. Bun's documented metadata only exposes width, height and format;
damaged JPEGs may decode and PNG checksums are not verified. The inspected API
does not provide a direct equivalent for those rejection rules. Preserve the
current behavior before replacing this processor. See the [Image API
reference](https://bun.sh/reference/globals/bun/Image).

[mobile asset generation](../../apps/mobile/scripts/generate-assets.ts) uses
flattening, compositing and SVG masks, which the inspected Bun Image prototype
does not expose. Next's own image optimizer also uses Sharp. A thumbnail
migration therefore would not eliminate Sharp from the repo.

### PostgreSQL: feasible driver migration, not an import substitution

The installed runtime exposes `Bun.SQL`. Bun supports pooling, transactions and
reserved connections; Drizzle provides a `drizzle-orm/bun-sql` adapter. See
[Bun SQL](https://bun.sh/docs/runtime/sql) and [Drizzle's Bun SQL
guide](https://orm.drizzle.team/docs/get-started/bun-sql-new).

Z8's [database module](../../apps/webapp/src/db/index.ts) wraps `pg.Pool` for
Next I/O tracking and tracing. Migration must preserve UTC parsing/session
behavior, raw query result shapes, transaction isolation, and the integration
harness's disposable-database guards and cleanup.

[Billing seat delivery](../../apps/webapp/src/lib/effect/services/billing/seat-delivery.ts)
holds a session advisory lock across Stripe calls and destroys the connection
if unlock fails. Reserved Bun connections need equivalent lifecycle handling.
Migration advisory locks and PgBouncer behavior need verification too. Run the
timezone, concurrency, billing and PostgreSQL integration suites against the
new driver before removing `pg`. No database-backed Bun SQL probe was performed.

## Suggested adoption order

1. Migrate the package manager, retaining Node and the existing test runners.
   Verify frozen installs, all Docker targets and cross-platform desktop/mobile CI.
2. Add a Bun-compatible worker preload and certify Next, workers, telemetry,
   shutdown and performance evidence on Bun.
3. Pilot a small image or ordinary S3 adapter with parity tests. Retain the
   libraries needed by advanced operations and framework integrations.
4. Migrate PostgreSQL separately with full transaction, UTC and lock coverage.

No production credentials or Phase secrets were used. Application builds,
service-backed S3 tests, PostgreSQL integration tests, production container
builds and deployment smoke tests were not performed for this assessment.
