# Temporal Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Temporal as Z8's internal time model while preserving database, wire, and time-entry hash contracts.

**Architecture:** Add semantic Temporal modules for strict parsing, primitive serialization, local boundaries, formatting, and timezone ownership. Keep `Date` at Drizzle/framework boundaries, preserve legacy Luxon APIs for unmigrated callers, and pin Node/PostgreSQL execution to UTC.

**Tech Stack:** TypeScript 7, `temporal-polyfill` 1.0.1, Zod, Drizzle ORM, PostgreSQL, Vitest, Next.js 16, pnpm.

**Depends On:** `docs/superpowers/specs/2026-07-10-temporal-timezone-consistency-design.md`

**Unblocks:** The Core web, Telegram, and client-capture plans dated 2026-07-10.

---

## File Map

- Create `apps/webapp/src/lib/datetime/temporal-core.ts`: strict parsers, `Date` adapters, comparisons, and clock.
- Create `apps/webapp/src/lib/datetime/temporal-wire.ts`: fixed-millisecond primitive serialization.
- Create `apps/webapp/src/lib/datetime/temporal-boundaries.ts`: half-open ranges and DST resolution.
- Create `apps/webapp/src/lib/datetime/temporal-format.ts`: named explicit-zone formats.
- Create `apps/webapp/src/lib/timezone/validation.ts`: timezone validation.
- Create `apps/webapp/src/lib/timezone/resolve-timezone.ts`: pure ownership resolution.
- Create `apps/webapp/src/db/postgres-utc.ts`: PostgreSQL UTC configuration.
- Modify `drizzle-adapter.ts`, `timezone-capture.ts`, `effective-timezone.ts`, timezone settings actions, and runtime configuration.
- Delete unused `apps/webapp/src/components/temporal-polyfill-provider.tsx`.
- Do not modify `apps/webapp/src/db/auth-schema.ts` or database timestamp columns.

### Task 1: Pin Existing Hash Bytes

**Files:**
- Modify: `apps/webapp/src/lib/time-tracking/__tests__/blockchain-hash-compatibility.test.ts`

- [ ] **Step 1: Add hard-coded timestamp hash fixtures**

Use the existing `test-employee`, `clock_in`, and null previous-hash fixture and assert fixed hashes for timestamps ending in `.000Z`, `.123Z`, and `.999Z`.

```ts
it.each([
	["2024-01-15T10:30:00.000Z", "a73279cdaf64f2ab3bfc90ad8a142c33cbf5c2fc6de1496a77cd459e399d63ed"],
	["2024-01-15T10:30:00.123Z", "165d9523f6703999733e2dcd2550b880c0bdff7121e123d654406aaee5302b16"],
	["2024-01-15T10:30:00.999Z", "5aa2ee833dede15711d4ef4c1d7ccbb99ec470bbbd0c42f4bdcd92dcfd31a2de"],
])("keeps the golden hash for %s", (timestamp, expected) => {
	expect(calculateHash({
		employeeId: "test-employee",
		type: "clock_in",
		timestamp,
		previousHash: null,
	})).toBe(expected);
});
```

- [ ] **Step 2: Verify characterization passes**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/lib/time-tracking/__tests__/blockchain-hash-compatibility.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/webapp/src/lib/time-tracking/__tests__/blockchain-hash-compatibility.test.ts
git commit -m "test(timekeeping): pin timestamp hash compatibility"
```

### Task 2: Add Temporal Core And Primitive Wire Contracts

**Files:**
- Create: `apps/webapp/src/lib/datetime/temporal-core.ts`
- Create: `apps/webapp/src/lib/datetime/temporal-core.test.ts`
- Create: `apps/webapp/src/lib/datetime/temporal-wire.ts`
- Create: `apps/webapp/src/lib/datetime/temporal-wire.test.ts`

- [ ] **Step 1: Write failing parser, adapter, clock, and wire tests**

```ts
expect(parseInstant("2026-07-10T12:30:00.000Z").epochMilliseconds).toBe(
	1783686600000,
);
expect(() => parseInstant("2026-07-10T12:30:00")).toThrow();
expect(parsePlainDate("2028-02-29").toString()).toBe("2028-02-29");
expect(() => parsePlainDate("2026-07-10T00:00:00Z")).toThrow();
expect(parsePlainTimeMinute("23:59").toString()).toBe("23:59:00");
expect(() => instantFromDate(new Date(Number.NaN))).toThrow();
expect(serializeInstant(parseInstant("2026-07-10T12:30:00Z"))).toBe(
	"2026-07-10T12:30:00.000Z",
);
expect(() => assertPrimitiveDateTimePayload({ value: new Date() })).toThrow();
expect(() =>
	assertPrimitiveDateTimePayload({
		value: parseInstant("2026-07-10T12:30:00Z"),
	}),
).toThrow();
```

- [ ] **Step 2: Run tests and verify red**

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/datetime/temporal-core.test.ts' \
  'src/lib/datetime/temporal-wire.test.ts'
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement `temporal-core.ts`**

```ts
import { Temporal } from "temporal-polyfill";

export type Instant = Temporal.Instant;
export type PlainDate = Temporal.PlainDate;
export type PlainTime = Temporal.PlainTime;
export type ZonedDateTime = Temporal.ZonedDateTime;

export interface Clock {
	nowInstant(): Instant;
}

export const systemClock: Clock = Object.freeze({
	nowInstant: () => Temporal.Now.instant(),
});

export function parseInstant(value: string): Instant {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
		throw new RangeError("Instant requires an explicit offset");
	}
	return Temporal.Instant.from(value);
}

export function parsePlainDate(value: string): PlainDate {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("Date must use YYYY-MM-DD");
	return Temporal.PlainDate.from(value, { overflow: "reject" });
}

export function parsePlainTimeMinute(value: string): PlainTime {
	if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new RangeError("Time must use HH:mm");
	return Temporal.PlainTime.from(value, { overflow: "reject" });
}

export function instantFromDate(value: Date): Instant {
	if (Number.isNaN(value.getTime())) throw new RangeError("Invalid Date");
	return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

export function dateFromInstant(value: Instant): Date {
	return new Date(value.epochMilliseconds);
}
```

- [ ] **Step 4: Implement `temporal-wire.ts`**

```ts
import { z } from "zod";
import { parseInstant, type Instant } from "./temporal-core";

export const instantWireSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export function serializeInstant(value: Instant): string {
	return value.toString({ fractionalSecondDigits: 3 });
}

export function deserializeInstant(value: unknown): Instant {
	return parseInstant(instantWireSchema.parse(value));
}

export function assertPrimitiveDateTimePayload(value: unknown): void {
	walk(value, "$", new WeakSet<object>());
}

function walk(value: unknown, path: string, seen: WeakSet<object>): void {
	if (value instanceof Date) throw new TypeError(`Date at ${path}`);
	if (!value || typeof value !== "object") return;
	const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
	if (typeof tag === "string" && tag.startsWith("Temporal.")) {
		throw new TypeError(`Temporal value at ${path}`);
	}
	if (seen.has(value)) return;
	seen.add(value);
	for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`, seen);
}
```

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add apps/webapp/src/lib/datetime/temporal-{core,core.test,wire,wire.test}.ts
git commit -m "feat(datetime): add temporal core and wire contracts"
```

### Task 3: Add Timezone Validation, Ownership, And DST Boundaries

**Files:**
- Create: `apps/webapp/src/lib/timezone/validation.ts`
- Create: `apps/webapp/src/lib/timezone/validation.test.ts`
- Create: `apps/webapp/src/lib/timezone/resolve-timezone.ts`
- Create: `apps/webapp/src/lib/timezone/resolve-timezone.test.ts`
- Create: `apps/webapp/src/lib/datetime/temporal-boundaries.ts`
- Create: `apps/webapp/src/lib/datetime/temporal-boundaries.test.ts`

- [ ] **Step 1: Write failing validation, ownership, and DST tests**

```ts
expect(parseIanaTimeZone("UTC")).toBe("UTC");
expect(parseIanaTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
expect(parseTimeZone("+05:45")).toBe("+05:45");
expect(() => parseIanaTimeZone("+05:45")).toThrow();
expect(() => parseIanaTimeZone("Not/AZone")).toThrow();
expect(resolvePersonalTimezone({
	userTimezone: "UTC",
	organizationTimezone: "Europe/Berlin",
})).toMatchObject({ timezone: "UTC", source: "user" });
expect(resolvePersonalTimezone({
	userTimezone: undefined,
	organizationTimezone: "Europe/Berlin",
})).toMatchObject({ timezone: "Europe/Berlin", source: "organization" });
```

Add Berlin `2026-03-29` 23-hour and New York `2026-11-01` 25-hour day assertions. Assert Berlin `02:30` spring gap throws `NonexistentWallClockTimeError`; assert the fall fold throws `AmbiguousWallClockTimeError` with `reject` and resolves to distinct instants with `earlier` and `later`.

- [ ] **Step 2: Run tests and verify red**

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/timezone/validation.test.ts' \
  'src/lib/timezone/resolve-timezone.test.ts' \
  'src/lib/datetime/temporal-boundaries.test.ts'
```

Expected: FAIL because the modules are missing.

- [ ] **Step 3: Implement validation and ownership**

`validation.ts` must canonicalize with `Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value).timeZoneId`, reject whitespace, allow fixed offsets only through `parseTimeZone`, and export `parseIanaTimeZone`, `isValidTimeZone`, and `isValidIanaTimeZone`.

`resolve-timezone.ts` exports:

```ts
export interface ResolvedTimezone {
	timezone: string;
	source: "user" | "organization" | "digest_schedule" | "default";
	invalidCandidates: Array<{ source: string; value: string | null }>;
}

export function resolvePersonalTimezone(input: {
	userTimezone: string | null | undefined;
	organizationTimezone: string | null | undefined;
}): ResolvedTimezone;
export function resolveOrganizationTimezone(value: string | null | undefined): ResolvedTimezone;
export function resolveDigestScheduleTimezone(input: {
	digestTimezone: string | null | undefined;
	organizationTimezone: string | null | undefined;
}): ResolvedTimezone;
```

`undefined` means no preference row. Stored `UTC` is a valid user value. Invalid values fall through and are recorded; final fallback is `UTC`.

- [ ] **Step 4: Implement boundaries and wall-clock policies**

```ts
export interface InstantRange { start: Instant; endExclusive: Instant }
export type ManualDisambiguation = "reject" | "earlier" | "later";
export class NonexistentWallClockTimeError extends RangeError {}
export class AmbiguousWallClockTimeError extends RangeError {}

export function localDayRange(date: PlainDate, timezone: string): InstantRange;
export function localWeekRange(date: PlainDate, timezone: string, weekStartDay: "sunday" | "monday"): InstantRange;
export function localMonthRange(date: PlainDate, timezone: string): InstantRange;
export function resolveManualWallClock(input: {
	date: string;
	time: string;
	timezone: string;
	disambiguation: ManualDisambiguation;
}): ZonedDateTime;
export function resolveScheduledWallClock(input: {
	date: string;
	time: string;
	timezone: string;
}): ZonedDateTime;
```

Manual resolution compares `earlier` and `later` results with the requested `PlainDateTime`: reject gaps, require a choice for folds, and return the unique result otherwise. Scheduled resolution uses `{ disambiguation: "compatible" }`. All ranges end at the next local start, never `23:59:59.999`.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add apps/webapp/src/lib/timezone/{validation,validation.test,resolve-timezone,resolve-timezone.test}.ts apps/webapp/src/lib/datetime/temporal-boundaries{,.test}.ts
git commit -m "feat(datetime): add explicit timezone and DST rules"
```

### Task 4: Add Named Explicit-Zone Formatting

**Files:**
- Create: `apps/webapp/src/lib/datetime/temporal-format.ts`
- Create: `apps/webapp/src/lib/datetime/temporal-format.test.ts`

- [ ] **Step 1: Write failing Berlin, New York, and captured-offset tests**

Use `2026-07-10T12:30:00.000Z`. Assert Berlin 24-hour output contains `14:30`, New York 12-hour output contains `8:30 AM`, and captured offset `345` contains `18:15`. Run the same test under host `TZ=UTC` and `TZ=America/New_York`.

- [ ] **Step 2: Implement named presets**

```ts
export type DateTimeFormatPreset = "dateShort" | "dateMedium" | "dateTimeMedium" | "time" | "timeWithSeconds";
export interface DisplayContext {
	locale: string;
	timezone: string;
	timeFormat: "12h" | "24h";
}
export function formatInstant(instant: Instant, context: DisplayContext, preset: DateTimeFormatPreset): string;
export function formatCapturedOffsetInstant(instant: Instant, context: {
	locale: string;
	timeFormat: "12h" | "24h";
	offsetMinutes: number;
	preset?: DateTimeFormatPreset;
}): string;
```

Use the polyfill's `Intl.DateTimeFormat`, always set `timeZone`, and convert captured offsets to `+HH:mm`/`-HH:mm`. Do not expose arbitrary format tokens.

- [ ] **Step 3: Verify and commit**

```bash
TZ=UTC pnpm --filter webapp exec vitest run 'src/lib/datetime/temporal-format.test.ts'
TZ=America/New_York pnpm --filter webapp exec vitest run 'src/lib/datetime/temporal-format.test.ts'
git add apps/webapp/src/lib/datetime/temporal-format{,.test}.ts
git commit -m "feat(datetime): add explicit temporal display formats"
```

Expected: both test runs PASS.

### Task 5: Integrate Drizzle, Hash, Capture, And Effective-Timezone Internals

**Files:**
- Modify: `apps/webapp/src/lib/datetime/drizzle-adapter.ts`
- Create: `apps/webapp/src/lib/datetime/drizzle-adapter.temporal.test.ts`
- Modify: `apps/webapp/src/lib/time-tracking/blockchain.ts`
- Modify: `apps/webapp/src/lib/time-tracking/timezone-capture.ts`
- Modify: `apps/webapp/src/lib/time-tracking/timezone-capture.test.ts`
- Modify: `apps/webapp/src/lib/timezone/effective-timezone.ts`
- Create: `apps/webapp/src/lib/timezone/effective-timezone.test.ts`

- [ ] **Step 1: Write failing additive adapter and saved-UTC tests**

```ts
expect(instantFromDB(new Date("2026-07-10T12:30:00.123Z"))?.toString()).toBe("2026-07-10T12:30:00.123Z");
expect(instantToDB(parseInstant("2026-07-10T12:30:00.123Z"))?.toISOString()).toBe("2026-07-10T12:30:00.123Z");
expect(resolveEffectiveTimezone("UTC", "Europe/Berlin")).toBe("UTC");
```

Retain all seasonal capture tests and add Kathmandu offset `345`.

- [ ] **Step 2: Run and verify red**

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/datetime/drizzle-adapter.temporal.test.ts' \
  'src/lib/timezone/effective-timezone.test.ts' \
  'src/lib/time-tracking/timezone-capture.test.ts'
```

- [ ] **Step 3: Add adapters and migrate internals**

Add `instantFromDB`, `instantsFromDB`, and `instantToDB` without changing existing Luxon exports. In `blockchain.ts`, serialize via `serializeInstant()` and compare with `Temporal.Instant.compare`. In `timezone-capture.ts`, preserve signatures and derive offsets from `instantFromDate(timestamp).toZonedDateTimeISO(parseIanaTimeZone(timezone)).offsetNanoseconds`. Make `effective-timezone.ts` delegate to `resolvePersonalTimezone()` so saved `UTC` remains user-owned.

- [ ] **Step 4: Run all compatibility tests**

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/datetime/drizzle-adapter.temporal.test.ts' \
  'src/lib/timezone/effective-timezone.test.ts' \
  'src/lib/time-tracking/timezone-capture.test.ts' \
  'src/lib/time-tracking/__tests__/blockchain-hash-compatibility.test.ts'
```

Expected: PASS with unchanged hard-coded hashes.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/datetime/drizzle-adapter.ts apps/webapp/src/lib/datetime/drizzle-adapter.temporal.test.ts apps/webapp/src/lib/time-tracking/blockchain.ts apps/webapp/src/lib/time-tracking/timezone-capture{,.test}.ts apps/webapp/src/lib/timezone/effective-timezone{,.test}.ts
git commit -m "refactor(datetime): use temporal at persistence boundaries"
```

### Task 6: Reject Invalid Timezone Settings

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/telegram/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/telegram/actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/notification-channels/actions.ts`

- [ ] **Step 1: Add failing write-boundary tests**

For profile and organization actions, accept `UTC`, `Europe/Berlin`, `America/New_York`; reject empty, whitespace-padded, fixed-offset, and invalid values before DB writes. For Telegram, require exact `HH:mm`, a valid IANA zone, authorized admin/owner, and `organizationId` in the update predicate.

- [ ] **Step 2: Verify red**

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/settings/profile/actions.test.ts' \
  'src/app/[locale]/(app)/settings/organizations/actions.test.ts' \
  'src/app/[locale]/(app)/settings/telegram/actions.test.ts' \
  'src/app/[locale]/(app)/settings/notification-channels/actions.test.ts'
```

- [ ] **Step 3: Apply shared validators**

Use `isValidIanaTimeZone(timezone)` before mutation. Use `/^(?:[01]\d|2[0-3]):[0-5]\d$/` for digest time. Preserve existing action return types and organization permission checks.

- [ ] **Step 4: Verify and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings' apps/webapp/src/lib/timezone
git commit -m "fix(settings): validate persisted timezone preferences"
```

### Task 7: Pin PostgreSQL And Runtime Execution To UTC

**Files:**
- Create: `apps/webapp/src/db/postgres-utc.ts`
- Create: `apps/webapp/src/db/postgres-utc.test.ts`
- Modify: `apps/webapp/src/db/index.ts`
- Modify: `apps/webapp/scripts/migrate-with-lock.js`
- Modify: `apps/webapp/drizzle.config.ts`
- Modify: `apps/webapp/package.json`
- Modify: `docker/Dockerfile.webapp`
- Modify: `docker/Dockerfile.worker`
- Modify: `docker/Dockerfile.migration`
- Modify: `docker/Dockerfile.db-seed`
- Modify: `docker-compose.dev.yml`
- Modify: `deploy/compose/docker-compose.yml`
- Modify: `deploy/k8s/webapp.yaml`
- Modify: `deploy/k8s/worker.yaml`
- Modify: `deploy/k8s/migration.yaml`
- Modify: `deploy/k8s/db-seed.yaml`

- [ ] **Step 1: Write failing PostgreSQL UTC parser/config tests**

Assert timestamp-without-time-zone text `2026-07-10 12:30:00.123` parses to `2026-07-10T12:30:00.123Z`, pool config includes `options: "-c timezone=UTC"`, and `pg.defaults.parseInputDatesAsUTC` is enabled.

- [ ] **Step 2: Implement `postgres-utc.ts`**

```ts
import { defaults, types, type PoolConfig } from "pg";

export function configurePostgresUtcTypes(): void {
	defaults.parseInputDatesAsUTC = true;
	types.setTypeParser(1114, (value) => new Date(`${value.replace(" ", "T")}Z`));
}

export function withUtcPostgresSession<T extends PoolConfig>(config: T): T & { options: string } {
	return { ...config, options: "-c timezone=UTC" };
}
```

- [ ] **Step 3: Use one configured pool**

Call `configurePostgresUtcTypes()` before pool creation, wrap the pool config with `withUtcPostgresSession()`, and pass that same pool to Drizzle. Add `PGOPTIONS=-c timezone=UTC` and `TZ=UTC` to migrations and runtime/container configuration. Prefix the webapp `dev`, `dev:webpack`, `build`, `start`, `test`, `test:watch`, `test:coverage`, and `db:seed` scripts with `TZ=UTC` so non-container server and test processes follow the same contract.

- [ ] **Step 4: Verify under two host zones**

```bash
TZ=UTC pnpm --filter webapp exec vitest run 'src/db/postgres-utc.test.ts' 'src/lib/datetime/drizzle-adapter.temporal.test.ts'
TZ=America/New_York pnpm --filter webapp exec vitest run 'src/db/postgres-utc.test.ts' 'src/lib/datetime/drizzle-adapter.temporal.test.ts'
```

Expected: both PASS with identical UTC values.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/db apps/webapp/scripts/migrate-with-lock.js apps/webapp/drizzle.config.ts apps/webapp/package.json docker deploy docker-compose.dev.yml
git commit -m "fix(runtime): enforce utc database sessions"
```

### Task 8: Add Guardrails, Runtime Manifests, And Documentation

**Files:**
- Create: `apps/webapp/src/lib/datetime/temporal-source-guard.test.ts`
- Delete: `apps/webapp/src/components/temporal-polyfill-provider.tsx`
- Modify: `docker/scripts/prepare-target-runtime.test.mjs`
- Regenerate: `docker/targets/{worker,migration,db-seed}/package.json`
- Regenerate: matching target lockfiles and root `pnpm-lock.yaml`
- Modify: `docs/refs/dates.md`
- Modify: `docs/refs/project-conventions.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write source guards**

Reject `@js-temporal/polyfill`, reject `temporal-polyfill/global` outside explicit Schedule-X files, reject Luxon imports in the new foundation, and assert the unused global provider is absent. Do not create a repository-wide no-Luxon rule yet.

- [ ] **Step 2: Regenerate traced runtime manifests**

```bash
pnpm docker:sync:non-web-targets
pnpm node --test docker/scripts/prepare-target-runtime.test.mjs
```

Expected: affected targets include `temporal-polyfill@1.0.1`; no target includes `@js-temporal/polyfill`.

- [ ] **Step 3: Update project rules**

Document: Temporal for new/migrated business logic; `Instant` for actual events; `PlainDate`/`PlainTime` for calendar values; explicit zones; primitive serialization; `Date` only at boundaries; existing Luxon remains only for unmigrated modules.

- [ ] **Step 4: Run foundation and full verification**

```bash
pnpm --filter webapp exec vitest run 'src/lib/datetime' 'src/lib/timezone' 'src/lib/time-tracking/timezone-capture.test.ts' 'src/lib/time-tracking/__tests__/blockchain-hash-compatibility.test.ts' 'src/db/postgres-utc.test.ts'
pnpm test
CI=true pnpm build
```

Expected: all tests and production build PASS.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/refs apps/webapp/src/lib/datetime apps/webapp/src/components/temporal-polyfill-provider.tsx docker pnpm-lock.yaml
git commit -m "docs(datetime): enforce temporal migration boundaries"
```
