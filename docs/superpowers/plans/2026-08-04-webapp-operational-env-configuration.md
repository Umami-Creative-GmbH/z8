# Webapp Operational Environment Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace approved hardcoded server operational constants with validated environment variables whose defaults preserve current behavior.

**Architecture:** `apps/webapp/src/env.ts` remains the only process-environment boundary and exposes validated decimal strings. Server consumers convert those strings to numbers at their existing configuration boundaries; webhook configuration moves out of the shared type module into a server-only module. No telemetry, vendor endpoint, product-policy, or client-side constant changes.

**Tech Stack:** TypeScript, Next.js 16, `@t3-oss/env-nextjs`, Zod 4, Vitest, BullMQ, ioredis, Nodemailer, TUS

---

## File Map

- Modify `apps/webapp/src/env.ts`: declare defaults, validation, runtime mappings, and webhook cross-field validation.
- Modify `apps/webapp/src/env.test.ts`: prove defaults, overrides, malformed-value rejection, and webhook consistency.
- Modify `apps/webapp/src/lib/queue/index.ts`, `apps/webapp/src/lib/redis.ts`, and `apps/webapp/src/lib/health.ts`: consume queue and Redis settings.
- Modify queue/Redis/health tests: prove configured values reach BullMQ, ioredis, and timeout behavior.
- Modify `apps/webapp/src/lib/email/transports/smtp-transport.ts` and its test: configure Nodemailer timeouts.
- Modify `apps/webapp/src/lib/turnstile/service.ts`; create `apps/webapp/src/lib/turnstile/service.test.ts`: configure and prove provider timeout without changing its URL.
- Create `apps/webapp/src/lib/webhooks/webhook-config.server.ts`; modify webhook queue, service, worker, delivery, index, and tests: centralize parsed server-only webhook configuration.
- Modify job, import, export, cleanup, domain-cache, and secret-store status consumers and focused tests.
- Modify three upload route consumers and focused tests; leave client upload hooks unchanged.
- Modify `apps/webapp/src/env-usage.test.ts` only if a new server-boundary assertion is needed; otherwise use it unchanged as a regression test.

### Task 1: Add Validated Operational Environment Settings

**Files:**
- Modify: `apps/webapp/src/env.ts:9-177,186-333`
- Modify: `apps/webapp/src/env.test.ts:14-192`

- [ ] **Step 1: Write failing table-driven default and override tests**

Add these fixtures and tests to `src/env.test.ts`:

```ts
const operationalDefaults = {
	QUEUE_HEALTH_TIMEOUT_MS: "1000",
	QUEUE_JOB_ATTEMPTS: "3",
	QUEUE_JOB_BACKOFF_DELAY_MS: "1000",
	QUEUE_COMPLETED_JOB_RETENTION_COUNT: "100",
	QUEUE_COMPLETED_JOB_RETENTION_SECONDS: "86400",
	QUEUE_FAILED_JOB_RETENTION_COUNT: "500",
	QUEUE_FAILED_JOB_RETENTION_SECONDS: "604800",
	REDIS_MAX_RECONNECT_ATTEMPTS: "8",
	REDIS_LOG_THROTTLE_MS: "30000",
	REDIS_MAX_RETRIES_PER_REQUEST: "1",
	REDIS_RECONNECT_BASE_DELAY_MS: "100",
	REDIS_RECONNECT_MAX_DELAY_MS: "2000",
	REDIS_HEALTH_TIMEOUT_MS: "1000",
	SMTP_CONNECTION_TIMEOUT_MS: "10000",
	SMTP_GREETING_TIMEOUT_MS: "10000",
	SMTP_SOCKET_TIMEOUT_MS: "30000",
	TURNSTILE_TIMEOUT_MS: "5000",
	WEBHOOK_RETRY_DELAYS_MS: "0,1000,5000,30000,120000,600000",
	WEBHOOK_MAX_ATTEMPTS: "6",
	WEBHOOK_TIMEOUT_MS: "30000",
	WEBHOOK_MAX_RESPONSE_BODY_LENGTH: "10240",
	WORK_BALANCE_JOB_BATCH_LIMIT: "1000",
	CLOCKODO_IMPORT_QUERY_CHUNK_SIZE: "500",
	CLOCKODO_IMPORT_CONCURRENCY: "4",
	EXPORT_FETCH_BATCH_SIZE: "1000",
	TUS_MAX_UPLOAD_SIZE_BYTES: "10485760",
	IMAGE_MAX_UPLOAD_SIZE_BYTES: "10485760",
	TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: "10485760",
	TUS_MULTIPART_PART_SIZE_BYTES: "8388608",
	JOB_EXECUTION_RETENTION_DAYS: "90",
	DOMAIN_CACHE_TTL_SECONDS: "300",
	SECRET_STORE_STATUS_CACHE_TTL_SECONDS: "86400",
} as const;

test("defaults operational settings to their existing values", async () => {
	const unset = Object.fromEntries(Object.keys(operationalDefaults).map((key) => [key, undefined]));
	const { env } = await importEnv(unset);

	for (const [key, value] of Object.entries(operationalDefaults)) {
		expect(env[key as keyof typeof env]).toBe(value);
	}
});

test("accepts operational setting overrides", async () => {
	const overrides = Object.fromEntries(
		Object.keys(operationalDefaults).map((key) => [
			key,
			key === "WEBHOOK_RETRY_DELAYS_MS" ? "0,2,4,8,16,32" : "6",
		]),
	);
	const { env } = await importEnv(overrides);

	for (const [key, value] of Object.entries(overrides)) {
		expect(env[key as keyof typeof env]).toBe(value);
	}
});
```

- [ ] **Step 2: Write failing validation tests**

```ts
test.each(["0", "-1", "1.5", "invalid"])(
	"rejects malformed positive operational integer %s",
	async (value) => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});
		await expect(importEnv({ QUEUE_JOB_ATTEMPTS: value })).rejects.toThrow("process.exit:1");
	},
);

test.each([" ", "-1,2", "0,,2", "0,1.5", "invalid"])(
	"rejects malformed webhook retry delays %s",
	async (value) => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});
		await expect(importEnv({ WEBHOOK_RETRY_DELAYS_MS: value })).rejects.toThrow(
			"process.exit:1",
		);
	},
);

test("rejects webhook attempts that exceed configured delays", async () => {
	vi.spyOn(process, "exit").mockImplementation((code) => {
		throw new Error(`process.exit:${code}`);
	});
	await expect(
		importEnv({ WEBHOOK_RETRY_DELAYS_MS: "0,1000", WEBHOOK_MAX_ATTEMPTS: "3" }),
	).rejects.toThrow("process.exit:1");
});
```

- [ ] **Step 3: Run the env tests and verify the new tests fail**

Run: `pnpm --filter webapp test -- src/env.test.ts`

Expected: FAIL because the new keys do not exist and webhook cross-field validation is absent.

- [ ] **Step 4: Add reusable numeric validators and all server-schema declarations**

Add near `optionalEnv`:

```ts
const positiveIntegerEnv = (name: string) =>
	z
		.string()
		.regex(/^\d+$/, `${name} must be a positive integer`)
		.refine((value) => Number(value) > 0, `${name} must be greater than zero`);

const nonNegativeIntegerListEnv = (name: string) =>
	z.string().regex(/^\d+(,\d+)*$/, `${name} must be comma-separated non-negative integers`);
```

Declare every key from `operationalDefaults` in `server`, using `positiveIntegerEnv("KEY").default("VALUE")`; declare `WEBHOOK_RETRY_DELAYS_MS` with `nonNegativeIntegerListEnv("WEBHOOK_RETRY_DELAYS_MS").default("0,1000,5000,30000,120000,600000")`.

- [ ] **Step 5: Add explicit runtime mappings and cross-field validation**

Add `KEY: process.env.KEY` for all 32 keys in `runtimeEnv`. Replace the early return in `createFinalSchema` with independent checks:

```ts
createFinalSchema: (shape) =>
	z.object(shape).superRefine((env, ctx) => {
		if (env.SECRET_STORE_PROVIDER === "scaleway") {
			for (const key of [
				"SCALEWAY_ACCESS_KEY",
				"SCALEWAY_SECRET_KEY",
				"SCALEWAY_PROJECT_ID",
			] as const) {
				if (!env[key]) {
					ctx.addIssue({
						code: "custom",
						path: [key],
						message: `${key} is required when SECRET_STORE_PROVIDER=scaleway`,
					});
				}
			}
		}

		const retryDelayCount = env.WEBHOOK_RETRY_DELAYS_MS.split(",").length;
		if (Number(env.WEBHOOK_MAX_ATTEMPTS) > retryDelayCount) {
			ctx.addIssue({
				code: "custom",
				path: ["WEBHOOK_MAX_ATTEMPTS"],
				message: "WEBHOOK_MAX_ATTEMPTS cannot exceed WEBHOOK_RETRY_DELAYS_MS entries",
			});
		}
	}),
```

- [ ] **Step 6: Run env tests**

Run: `pnpm --filter webapp test -- src/env.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit this task if the user has requested commits**

```bash
git add apps/webapp/src/env.ts apps/webapp/src/env.test.ts
git commit -m "feat: validate operational environment settings"
```

### Task 2: Configure Queue, Redis, and Health Behavior

**Files:**
- Modify: `apps/webapp/src/lib/queue/index.ts:21-28,142-157,369-376`
- Modify: `apps/webapp/src/lib/queue/health.test.ts`
- Modify: `apps/webapp/src/lib/redis.ts:6-75`
- Modify: `apps/webapp/src/lib/redis.test.ts:17-56`
- Modify: `apps/webapp/src/lib/health.ts:10-89`
- Modify: `apps/webapp/src/lib/health.test.ts`

- [ ] **Step 1: Extend consumer tests with explicit env overrides**

In queue tests, mock queue env values and assert the `Queue` constructor receives:

```ts
expect(queueOptions.defaultJobOptions).toEqual({
	attempts: 4,
	backoff: { type: "exponential", delay: 250 },
	removeOnComplete: { count: 12, age: 34 },
	removeOnFail: { count: 56, age: 78 },
});
```

In `redis.test.ts`, extend the mocked env with values `9`, `45000`, `2`, `150`, and `2500`, then assert:

```ts
const options = mocks.Redis.mock.calls[0]?.[0];
expect(options).toMatchObject({ maxRetriesPerRequest: 2 });
expect(options.retryStrategy(1)).toBe(150);
expect(options.retryStrategy(2)).toBe(300);
expect(options.retryStrategy(9)).toBe(2500);
expect(options.retryStrategy(10)).toBeNull();
```

Use fake timers in queue and general health tests with `QUEUE_HEALTH_TIMEOUT_MS: "25"` and `REDIS_HEALTH_TIMEOUT_MS: "25"`; advance 25 ms and expect the existing unhealthy/degraded result.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter webapp test -- src/lib/queue/health.test.ts src/lib/redis.test.ts src/lib/health.test.ts`

Expected: FAIL because consumers still use hardcoded values.

- [ ] **Step 3: Replace queue literals with env values**

```ts
const queueHealthTimeoutMs = Number(env.QUEUE_HEALTH_TIMEOUT_MS);

const defaultJobOptions: JobsOptions = {
	attempts: Number(env.QUEUE_JOB_ATTEMPTS),
	backoff: { type: "exponential", delay: Number(env.QUEUE_JOB_BACKOFF_DELAY_MS) },
	removeOnComplete: {
		count: Number(env.QUEUE_COMPLETED_JOB_RETENTION_COUNT),
		age: Number(env.QUEUE_COMPLETED_JOB_RETENTION_SECONDS),
	},
	removeOnFail: {
		count: Number(env.QUEUE_FAILED_JOB_RETENTION_COUNT),
		age: Number(env.QUEUE_FAILED_JOB_RETENTION_SECONDS),
	},
};
```

Pass `queueHealthTimeoutMs` to the existing queue health timeout. Keep BullMQ's `maxRetriesPerRequest: null` unchanged.

- [ ] **Step 4: Replace Redis and general health literals**

In `redis.ts`, parse each setting once and use:

```ts
maxRetriesPerRequest: Number(env.REDIS_MAX_RETRIES_PER_REQUEST),
retryStrategy(times) {
	if (times > Number(env.REDIS_MAX_RECONNECT_ATTEMPTS)) return null;
	return Math.min(
		Number(env.REDIS_RECONNECT_BASE_DELAY_MS) * 2 ** (times - 1),
		Number(env.REDIS_RECONNECT_MAX_DELAY_MS),
	);
},
```

Use `Number(env.REDIS_LOG_THROTTLE_MS)` in `shouldLogRedisEvent`. In `health.ts`, replace the local timeout with `Number(env.REDIS_HEALTH_TIMEOUT_MS)`.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter webapp test -- src/lib/queue/health.test.ts src/lib/redis.test.ts src/lib/redis-config.test.ts src/lib/health.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit this task if the user has requested commits**

```bash
git add apps/webapp/src/lib/queue apps/webapp/src/lib/redis.ts apps/webapp/src/lib/redis.test.ts apps/webapp/src/lib/health.ts apps/webapp/src/lib/health.test.ts
git commit -m "feat: configure queue and Redis operations"
```

### Task 3: Configure SMTP, Turnstile, and Webhook Requests

**Files:**
- Modify: `apps/webapp/src/lib/email/transports/smtp-transport.ts:64-92`
- Modify: `apps/webapp/src/lib/email/transports/smtp-transport.test.ts`
- Modify: `apps/webapp/src/lib/turnstile/service.ts:16-70`
- Create: `apps/webapp/src/lib/turnstile/service.test.ts`
- Create: `apps/webapp/src/lib/webhooks/webhook-config.server.ts`
- Modify: `apps/webapp/src/lib/webhooks/types.ts:73-97`
- Modify: `apps/webapp/src/lib/webhooks/index.ts:11-23`
- Modify: `apps/webapp/src/lib/webhooks/webhook-queue.ts:7-103`
- Modify: `apps/webapp/src/lib/webhooks/webhook-service.ts:7-325`
- Modify: `apps/webapp/src/lib/webhooks/webhook-worker.ts:7-136`
- Modify: `apps/webapp/src/lib/webhooks/webhook-delivery.ts:7-156`
- Create: `apps/webapp/src/lib/webhooks/webhook-queue.test.ts`
- Modify: `apps/webapp/src/lib/webhooks/webhook-delivery.test.ts`

- [ ] **Step 1: Write SMTP and Turnstile override tests**

Mock `@/env` in the SMTP test with timeout strings and assert `createTransportMock` receives `connectionTimeout: 111`, `greetingTimeout: 222`, and `socketTimeout: 333`.

Create `service.test.ts`, mock `TURNSTILE_SECRET_KEY: "secret"` and `TURNSTILE_TIMEOUT_MS: "25"`, then stub `fetch` with a promise that listens to `init.signal` and rejects with an `AbortError` when aborted. Use fake timers, call `verifyTurnstileToken("token")`, advance 25 ms, and assert the signal is aborted and the result is `{ success: false, error: "Turnstile verification timed out" }`.

- [ ] **Step 2: Write webhook configuration and scheduling tests**

Mock env values `WEBHOOK_RETRY_DELAYS_MS: "0,10,20"`, `WEBHOOK_MAX_ATTEMPTS: "3"`, `WEBHOOK_TIMEOUT_MS: "25"`, and `WEBHOOK_MAX_RESPONSE_BODY_LENGTH: "4"`. Assert:

```ts
expect(RETRY_DELAYS_MS).toEqual([0, 10, 20]);
expect(MAX_ATTEMPTS).toBe(3);
expect(WEBHOOK_TIMEOUT_MS).toBe(25);
expect(MAX_RESPONSE_BODY_LENGTH).toBe(4);
```

In `webhook-queue.test.ts`, mock `addJob`, verify attempt 2 receives `delay: 10`, attempt 3 receives `delay: 20`, and `scheduleWebhookRetry` returns `null` at attempt 3. In delivery tests, verify a long response is sliced to four characters and an unresolved request reports `Request timeout after 25ms`.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter webapp test -- src/lib/email/transports/smtp-transport.test.ts src/lib/turnstile/service.test.ts src/lib/webhooks/webhook-queue.test.ts src/lib/webhooks/webhook-delivery.test.ts`

Expected: FAIL because network settings remain hardcoded and the server webhook config module is absent.

- [ ] **Step 4: Implement SMTP and Turnstile substitutions**

```ts
connectionTimeout: Number(env.SMTP_CONNECTION_TIMEOUT_MS),
greetingTimeout: Number(env.SMTP_GREETING_TIMEOUT_MS),
socketTimeout: Number(env.SMTP_SOCKET_TIMEOUT_MS),
```

Replace only the Turnstile timer delay with `Number(env.TURNSTILE_TIMEOUT_MS)`. Keep `https://challenges.cloudflare.com/turnstile/v0/siteverify` unchanged.

- [ ] **Step 5: Create the server-only webhook configuration module**

```ts
import "server-only";
import { env } from "@/env";

export const RETRY_DELAYS_MS = env.WEBHOOK_RETRY_DELAYS_MS.split(",").map(Number);
export const MAX_ATTEMPTS = Number(env.WEBHOOK_MAX_ATTEMPTS);
export const WEBHOOK_TIMEOUT_MS = Number(env.WEBHOOK_TIMEOUT_MS);
export const MAX_RESPONSE_BODY_LENGTH = Number(env.WEBHOOK_MAX_RESPONSE_BODY_LENGTH);
```

Remove operational constants from `types.ts` and their barrel re-export from `index.ts`. Import them from `webhook-config.server.ts` in queue, service, worker, and delivery. Change `scheduleWebhookRetry` to compare with `MAX_ATTEMPTS`, not `RETRY_DELAYS_MS.length`. Preserve string slicing semantics in delivery.

- [ ] **Step 6: Run focused tests**

Run: `pnpm --filter webapp test -- src/lib/email/transports/smtp-transport.test.ts src/lib/turnstile/service.test.ts src/lib/webhooks/webhook-queue.test.ts src/lib/webhooks/webhook-delivery.test.ts src/lib/webhooks/webhook-service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit this task if the user has requested commits**

```bash
git add apps/webapp/src/lib/email/transports apps/webapp/src/lib/turnstile apps/webapp/src/lib/webhooks
git commit -m "feat: configure external request operations"
```

### Task 4: Configure Batch Sizes, Retention, and Cache TTLs

**Files:**
- Modify: `apps/webapp/src/lib/jobs/work-balance.ts:1-28`
- Modify: `apps/webapp/src/lib/jobs/work-balance.test.ts`
- Modify: `apps/webapp/src/lib/clockodo/import-orchestrator.ts:1-82`
- Modify: `apps/webapp/src/lib/clockodo/import-orchestrator.test.ts`
- Modify: `apps/webapp/src/lib/export/data-fetchers.ts:1-35,759-977`
- Create: `apps/webapp/src/lib/export/data-fetchers.test.ts`
- Modify: `apps/webapp/src/lib/jobs/execution-cleanup.ts:1-15`
- Modify: `apps/webapp/src/lib/jobs/execution-cleanup.test.ts`
- Modify: `apps/webapp/src/lib/domain/domain-cache.ts:1-76`
- Create: `apps/webapp/src/lib/domain/domain-cache.test.ts`
- Modify: `apps/webapp/src/lib/vault/status.ts:1-154`
- Modify: `apps/webapp/src/lib/vault/status.test.ts`

- [ ] **Step 1: Write focused override tests**

Use explicit `@/env` mocks and dynamic imports where module constants initialize at import time. Prove:

- Work-balance repository and result receive batch limit `2`.
- Five Clockodo records with chunk size `2` produce three chunks and concurrency `2` delays the third operation until one of the first two settles.
- A streaming export fetch uses `{ limit: 2, offset: 0 }`, then `{ limit: 2, offset: 2 }`.
- Execution cleanup calls `cleanupOldExecutions(30)` and returns `daysToKeep: 30`.
- Domain cache with TTL `2` remains valid at 2000 ms and expires at 2001 ms under existing `Date.now() > expiresAt` behavior.
- Secret-store status cache writes Redis with `EX`, `123`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter webapp test -- src/lib/jobs/work-balance.test.ts src/lib/clockodo/import-orchestrator.test.ts src/lib/export/data-fetchers.test.ts src/lib/jobs/execution-cleanup.test.ts src/lib/domain/domain-cache.test.ts src/lib/vault/status.test.ts`

Expected: FAIL because consumers still use current literals and two focused test files do not exist.

- [ ] **Step 3: Replace batch and concurrency constants**

Import `env` and use:

```ts
const batchLimit = Number(env.WORK_BALANCE_JOB_BATCH_LIMIT);
const CLOCKODO_IMPORT_QUERY_CHUNK_SIZE = Number(env.CLOCKODO_IMPORT_QUERY_CHUNK_SIZE);
const CLOCKODO_IMPORT_CONCURRENCY = Number(env.CLOCKODO_IMPORT_CONCURRENCY);
const BATCH_SIZE = Number(env.EXPORT_FETCH_BATCH_SIZE);
```

Do not change chunking, paging, offset, or bounded-executor algorithms.

- [ ] **Step 4: Replace retention and TTL constants**

```ts
const DAYS_TO_KEEP = Number(env.JOB_EXECUTION_RETENTION_DAYS);
private readonly TTL_MS = Number(env.DOMAIN_CACHE_TTL_SECONDS) * 1000;
const SCALEWAY_STATUS_CACHE_TTL_SECONDS = Number(env.SECRET_STORE_STATUS_CACHE_TTL_SECONDS);
```

Keep all existing date comparison and cache key behavior unchanged.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter webapp test -- src/lib/jobs/work-balance.test.ts src/lib/clockodo/import-orchestrator.test.ts src/lib/export/data-fetchers.test.ts src/lib/jobs/execution-cleanup.test.ts src/lib/domain/domain-cache.test.ts src/lib/vault/status.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit this task if the user has requested commits**

```bash
git add apps/webapp/src/lib/jobs apps/webapp/src/lib/clockodo apps/webapp/src/lib/export apps/webapp/src/lib/domain apps/webapp/src/lib/vault
git commit -m "feat: configure operational batches and retention"
```

### Task 5: Configure Server Upload Limits

**Files:**
- Modify: `apps/webapp/src/app/api/tus/[[...path]]/route.ts:12-81`
- Modify: `apps/webapp/src/app/api/tus/[[...path]]/route.test.ts:3-175`
- Modify: `apps/webapp/src/app/api/upload/process/route.ts:16-102`
- Modify: `apps/webapp/src/app/api/upload/process/route.test.ts`
- Modify: `apps/webapp/src/app/api/upload/travel-expense/process/route.ts:13-111`
- Modify: `apps/webapp/src/app/api/upload/travel-expense/process/route.test.ts`

- [ ] **Step 1: Write server upload override tests**

Set TUS env mocks to `TUS_MAX_UPLOAD_SIZE_BYTES: "1024"` and `TUS_MULTIPART_PART_SIZE_BYTES: "512"`. Assert upload length `1025` returns 413 and capture the mocked `S3Store` constructor options to assert `partSize: 512`.

For image and travel-expense routes, mock limits as `1024`. Add one metadata `ContentLength: 1025` rejection and one downloaded `Buffer.alloc(1025)` rejection to each route test. Assert 413 responses and error text derived from the configured limit rather than a hardcoded `10MB`.

- [ ] **Step 2: Run route tests and verify failure**

Run: `pnpm --filter webapp test -- 'src/app/api/tus/[[...path]]/route.test.ts' src/app/api/upload/process/route.test.ts src/app/api/upload/travel-expense/process/route.test.ts`

Expected: FAIL because all four server upload values remain hardcoded.

- [ ] **Step 3: Replace upload literals**

```ts
const MAX_TUS_UPLOAD_SIZE = Number(env.TUS_MAX_UPLOAD_SIZE_BYTES);
partSize: Number(env.TUS_MULTIPART_PART_SIZE_BYTES),
const MAX_FILE_SIZE = Number(env.IMAGE_MAX_UPLOAD_SIZE_BYTES);
const MAX_FILE_SIZE_BYTES = Number(env.TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES);
```

Derive both route error messages from the configured byte value. Do not import server env into `use-image-upload.ts` or `use-travel-expense-file-upload.ts`; those client restrictions are excluded.

- [ ] **Step 4: Run route tests**

Run: `pnpm --filter webapp test -- 'src/app/api/tus/[[...path]]/route.test.ts' src/app/api/upload/process/route.test.ts src/app/api/upload/travel-expense/process/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit this task if the user has requested commits**

```bash
git add 'apps/webapp/src/app/api/tus/[[...path]]/route.ts' 'apps/webapp/src/app/api/tus/[[...path]]/route.test.ts' apps/webapp/src/app/api/upload
git commit -m "feat: configure server upload limits"
```

### Task 6: Verify Boundaries, Scope, and Full Webapp Quality

**Files:**
- Verify: `apps/webapp/src/env-usage.test.ts`
- Verify: all files changed in Tasks 1-5
- Verify unchanged: `apps/webapp/src/lib/telemetry.ts`, `apps/webapp/src/lib/telemetry-protocol.ts`

- [ ] **Step 1: Run environment-boundary tests**

Run: `pnpm --filter webapp test -- src/env.test.ts src/env-usage.test.ts`

Expected: PASS; no consumer reads `process.env`, and no client-reachable module reads a server env key.

- [ ] **Step 2: Confirm telemetry was untouched**

Run: `git diff --exit-code -- apps/webapp/src/lib/telemetry.ts apps/webapp/src/lib/telemetry-protocol.ts`

Expected: exit code 0 with no output.

- [ ] **Step 3: Run all focused regression tests together**

Run:

```bash
pnpm --filter webapp test -- \
  src/env.test.ts \
  src/env-usage.test.ts \
  src/lib/queue/health.test.ts \
  src/lib/redis.test.ts \
  src/lib/redis-config.test.ts \
  src/lib/health.test.ts \
  src/lib/email/transports/smtp-transport.test.ts \
  src/lib/turnstile/service.test.ts \
  src/lib/webhooks/webhook-queue.test.ts \
  src/lib/webhooks/webhook-delivery.test.ts \
  src/lib/webhooks/webhook-service.test.ts \
  src/lib/jobs/work-balance.test.ts \
  src/lib/clockodo/import-orchestrator.test.ts \
  src/lib/export/data-fetchers.test.ts \
  src/lib/jobs/execution-cleanup.test.ts \
  src/lib/domain/domain-cache.test.ts \
  src/lib/vault/status.test.ts \
  'src/app/api/tus/[[...path]]/route.test.ts' \
  src/app/api/upload/process/route.test.ts \
  src/app/api/upload/travel-expense/process/route.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run static checking**

Run: `pnpm --filter webapp typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Run the full webapp test suite**

Run: `pnpm --filter webapp test`

Expected: PASS.

- [ ] **Step 6: Inspect the final diff**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors; only the approved spec/plan and operational env migration files appear among this task's changes. Leave unrelated concurrent changes untouched.

- [ ] **Step 7: Commit final verification fixes if the user has requested commits**

```bash
git add apps/webapp/src docs/superpowers/specs/2026-08-04-webapp-operational-env-configuration-design.md docs/superpowers/plans/2026-08-04-webapp-operational-env-configuration.md
git commit -m "test: verify operational env configuration"
```
