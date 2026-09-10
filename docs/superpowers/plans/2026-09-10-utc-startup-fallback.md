# UTC Startup Fallback Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan inline, task by task.

**Goal:** Remove timezone prefixes from webapp package scripts while defaulting server processes to UTC when TZ is missing or empty.

**Architecture:** Use direct `process.env.TZ ||= "UTC"` initialization at independent startup boundaries. Preserve explicit timezone overrides. Expose TZ through the server env schema with a runtime fallback even when validation is skipped; guard process mutation from browser execution. Database session UTC remains explicit.

**Tech Stack:** TypeScript, Node.js, Next.js, Vitest, Zod, shell scripts.

## Approved design

The user approved direct startup fallbacks and preservation of explicitly configured TZ values. Next.js and Vitest need their own defaults because they do not load application env before starting workers. Auth generation has a CommonJS preload; migration tooling has independent entry points. Seed and queue scripts already load application env before their operations; approvals loads it through its database import.

## Tasks

- [x] Extend `apps/webapp/src/env.test.ts` to check missing, empty, and explicit TZ with validation enabled and skipped, and browser execution without process mutation. Run `pnpm --dir apps/webapp exec vitest run src/env.test.ts` and confirm the new tests fail before implementation.
- [x] In `apps/webapp/src/env.ts`, add `if (typeof window === "undefined") { process.env.TZ ||= "UTC"; }`, server schema `TZ: z.string().default("UTC")`, and runtime mapping `TZ: optionalEnv(process.env.TZ) ?? "UTC"`.
- [x] Add `process.env.TZ ||= "UTC";` to `apps/webapp/next.config.ts`, `apps/webapp/vitest.config.ts`, and `apps/webapp/scripts/register-auth-generate-alias.cjs`. Replace forced TZ assignments in `apps/webapp/drizzle.config.ts` and `apps/webapp/scripts/migrate-with-lock.js` with that fallback. Initialize it in the Node branch of `apps/webapp/src/instrumentation.ts` for standalone Next startup.
- [x] Remove every `TZ=UTC ` prefix in `apps/webapp/package.json`, preserving all other script content and existing user edits. Remove the integration shell runner's TZ assignment since Vitest owns its default, and update its existing contract test.
- [x] Run targeted env, PostgreSQL UTC, and integration runner tests; run process-isolated timezone probes for env and config entry points. Check missing, empty, and explicit TZ. Do not run database mutations or commands requiring Phase secrets.
- [x] Review `git diff --check` and the final diff. Report exact validation results. Do not commit without a user request.

## Verification results

- Red: nine new timezone cases failed because env.TZ was undefined.
- Green: 76 tests passed across env, env usage, PostgreSQL UTC, and integration runner suites.
- Fifteen isolated Node.js probes passed across env, Next config, Vitest config, Drizzle config, and the auth preload. Each checked both process.env.TZ and Intl's effective default timezone for missing, empty, and Europe/Berlin inputs.
- `git diff --check` passed. Database/queue operations requiring Phase secrets were not run.
