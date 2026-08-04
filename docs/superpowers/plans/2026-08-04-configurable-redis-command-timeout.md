# Configurable Redis Command Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow deployments to configure the ioredis connection and command timeout with `REDIS_COMMAND_TIMEOUT_MS`, defaulting to 2000 milliseconds.

**Architecture:** Validate the server-only environment variable as a positive integer string in the central environment schema. Convert the validated string to a number at Redis client construction and pass the same value to both ioredis timeout options.

**Tech Stack:** TypeScript, Zod, `@t3-oss/env-nextjs`, ioredis, Vitest

---

## File Structure

- Modify `apps/webapp/src/env.ts`: validate and expose `REDIS_COMMAND_TIMEOUT_MS`.
- Modify `apps/webapp/src/env.test.ts`: cover default, custom, and invalid timeout values.
- Modify `apps/webapp/src/lib/redis.ts`: consume the validated timeout.
- Modify `apps/webapp/src/lib/redis.test.ts`: verify both ioredis timeout options use the configured value.

### Task 1: Validate The Environment Variable

**Files:**
- Modify: `apps/webapp/src/env.ts:38-45,202-207`
- Test: `apps/webapp/src/env.test.ts:143-160`

- [ ] **Step 1: Write failing environment tests**

Add tests that establish the default, custom value, and rejection behavior:

```ts
test("defaults the Redis command timeout to two seconds", async () => {
	const { env } = await importEnv({ REDIS_COMMAND_TIMEOUT_MS: undefined });

	expect(env.REDIS_COMMAND_TIMEOUT_MS).toBe("2000");
});

test("accepts a custom Redis command timeout", async () => {
	const { env } = await importEnv({ REDIS_COMMAND_TIMEOUT_MS: "3500" });

	expect(env.REDIS_COMMAND_TIMEOUT_MS).toBe("3500");
});

test.each(["0", "-1", "1.5", "invalid"])(
	"rejects invalid Redis command timeout %s",
	async (timeout) => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});

		await expect(importEnv({ REDIS_COMMAND_TIMEOUT_MS: timeout })).rejects.toThrow(
			"process.exit:1",
		);
	},
);
```

- [ ] **Step 2: Run the environment tests and verify failure**

Run:

```bash
pnpm --filter webapp test src/env.test.ts
```

Expected: the timeout tests fail because `REDIS_COMMAND_TIMEOUT_MS` is not present in the validated environment.

- [ ] **Step 3: Add schema and runtime environment entries**

Add the server schema field alongside the Redis settings:

```ts
REDIS_COMMAND_TIMEOUT_MS: z
	.string()
	.regex(/^[1-9]\d*$/, "REDIS_COMMAND_TIMEOUT_MS must be a positive integer")
	.default("2000"),
```

Add the runtime environment mapping:

```ts
REDIS_COMMAND_TIMEOUT_MS: process.env.REDIS_COMMAND_TIMEOUT_MS,
```

- [ ] **Step 4: Run the environment tests and verify success**

Run:

```bash
pnpm --filter webapp test src/env.test.ts
```

Expected: all tests in `src/env.test.ts` pass.

### Task 2: Apply The Configured Timeout

**Files:**
- Modify: `apps/webapp/src/lib/redis.ts:6-8,52-59`
- Test: `apps/webapp/src/lib/redis.test.ts:17-27,44-54`

- [ ] **Step 1: Change the Redis client test to require a custom value**

Add the custom setting to the mocked validated environment:

```ts
REDIS_COMMAND_TIMEOUT_MS: "3500",
```

Update the timeout assertions:

```ts
expect(mocks.Redis.mock.calls[0]?.[0]).toMatchObject({
	commandTimeout: 3_500,
	connectTimeout: 3_500,
	enableOfflineQueue: true,
	lazyConnect: true,
});
```

- [ ] **Step 2: Run the Redis test and verify failure**

Run:

```bash
pnpm --filter webapp test src/lib/redis.test.ts
```

Expected: FAIL because the client still passes the hard-coded `2000` value.

- [ ] **Step 3: Consume the validated environment value**

Replace the hard-coded timeout constant with:

```ts
const redisCommandTimeoutMs = Number(env.REDIS_COMMAND_TIMEOUT_MS);
```

Use it for both client options:

```ts
connectTimeout: redisCommandTimeoutMs,
commandTimeout: redisCommandTimeoutMs,
```

- [ ] **Step 4: Run focused tests and verify success**

Run:

```bash
pnpm --filter webapp test src/env.test.ts src/lib/redis.test.ts
```

Expected: both test files pass with no failures.

- [ ] **Step 5: Run TypeScript verification**

Run:

```bash
pnpm --filter webapp typecheck
```

Expected: command exits successfully with no type errors related to the new environment field.
