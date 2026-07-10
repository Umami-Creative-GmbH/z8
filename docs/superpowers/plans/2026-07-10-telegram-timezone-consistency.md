# Telegram Timezone Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram and shared bot commands display and query time using explicit recipient, organization, and digest-schedule timezone ownership.

**Architecture:** Resolve one primitive temporal context when a linked bot user is authenticated, pass it through shared commands and formatters, and eliminate command-local settings/runtime-timezone lookups. Reuse transaction-safe clocking, use plain dates for absence/shift commands, and make digest dispatch DST-safe and idempotent.

**Tech Stack:** TypeScript 7, `temporal-polyfill`, Telegram Bot API, shared bot platform, Drizzle ORM, PostgreSQL, Vitest, pnpm.

**Prerequisite:** Complete the Temporal foundation and Core web plans dated 2026-07-10.

---

## File Map

- `lib/bot-platform/context.ts`: resolve recipient/org/digest schedule zones, locale, and time format.
- `lib/bot-platform/i18n.ts`: semantic instant/plain-date formatters.
- `lib/time-tracking/transactional-clocking.ts`: shared transaction-safe live clocking used by web/API/bot.
- Shared command files: consume explicit ownership fields.
- Telegram formatters/notifications: require explicit recipient display contexts.
- Digest scheduler: schedule zone only; organization zone for content.
- Digest dispatch ledger: one organization/date/type claim.
- All touched queries remain explicitly `organizationId` scoped.

### Task 1: Add Explicit Bot Temporal Context

**Files:**
- Create: `apps/webapp/src/lib/bot-platform/context.ts`
- Create: `apps/webapp/src/lib/bot-platform/context.test.ts`
- Modify: `apps/webapp/src/lib/bot-platform/types.ts`
- Modify: `apps/webapp/src/lib/bot-platform/i18n.ts`
- Create: `apps/webapp/src/lib/bot-platform/i18n.test.ts`
- Modify: `apps/webapp/src/lib/telegram/bot-config.ts`
- Modify: `apps/webapp/src/lib/telegram/bot-handler.ts`
- Modify: `apps/webapp/src/lib/teams/bot-handler.ts`
- Modify: `apps/webapp/src/lib/slack/bot-handler.ts`
- Modify: `apps/webapp/src/lib/discord/bot-handler.ts`

- [ ] **Step 1: Write failing precedence and tenant tests**

```ts
expect(await resolveBotTemporalContext(fixture({
	userTimezone: "UTC",
	organizationTimezone: "Europe/Berlin",
	digestTimezone: "Asia/Kathmandu",
}))).toMatchObject({
	recipientTimezone: "UTC",
	organizationTimezone: "Europe/Berlin",
	digestScheduleTimezone: "Asia/Kathmandu",
});
```

Also assert: no settings row falls back to organization; invalid user zone falls back to organization; invalid digest zone falls back to organization without changing recipient/org fields; 12h/24h preference is preserved; mismatched employee/user/organization is rejected.

- [ ] **Step 2: Verify red**

```bash
pnpm --filter webapp exec vitest run 'src/lib/bot-platform/context.test.ts' 'src/lib/bot-platform/i18n.test.ts'
```

Expected: FAIL because context has only locale and commands overload `digestTimezone`.

- [ ] **Step 3: Add context types**

```ts
export interface BotDisplayContext {
	timezone: string;
	locale: string;
	timeFormat: "12h" | "24h";
}

export interface BotTemporalContext {
	recipientTimezone: string;
	organizationTimezone: string;
	digestScheduleTimezone: string;
	locale: string;
	timeFormat: "12h" | "24h";
}

export interface BotCommandContext extends BotTemporalContext {
	platform: BotPlatform;
	organizationId: string;
	employeeId: string;
	userId: string;
	platformUserId: string;
	config: PlatformConfig;
	args: string[];
}
```

Rename the in-memory platform config field to `digestScheduleTimezone` while mapping it from the persisted `digestTimezone` column.

- [ ] **Step 4: Implement organization-scoped resolver**

Query active employee membership with employee ID, user ID, and organization ID; query user settings and organization timezone; then delegate to foundation resolvers. Return primitive strings only.

```ts
export async function resolveBotTemporalContext(input: {
	userId: string;
	employeeId: string;
	organizationId: string;
	digestScheduleTimezone: string;
}): Promise<BotTemporalContext>;
```

- [ ] **Step 5: Replace bot formatting signatures**

```ts
export function fmtBotInstant(
	instantIso: string,
	context: BotDisplayContext,
	preset: "time" | "dateTimeMedium",
): string;

export function fmtBotPlainDate(
	dateIso: string,
	locale: string,
	preset: "dateShort" | "dateMedium",
): string;
```

Each platform handler resolves context once and passes it to commands. No Temporal object enters the command transport response.

- [ ] **Step 6: Verify and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add apps/webapp/src/lib/bot-platform apps/webapp/src/lib/{telegram,teams,slack,discord}/bot-handler.ts apps/webapp/src/lib/telegram/bot-config.ts
git commit -m "feat(bot): add explicit timezone display contexts"
```

### Task 2: Share Transaction-Safe Live Clocking

**Files:**
- Create: `apps/webapp/src/lib/time-tracking/time-entry-writer.ts`
- Create: `apps/webapp/src/lib/time-tracking/transactional-clocking.ts`
- Create: `apps/webapp/src/lib/time-tracking/transactional-clocking.test.ts`
- Modify: `apps/webapp/src/app/api/time-entries/route.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/lib/teams/commands/clock-in.ts`
- Modify: `apps/webapp/src/lib/teams/commands/clock-out.ts`
- Modify: `apps/webapp/src/lib/teams/commands/clock-out.test.ts`

- [ ] **Step 1: Add failing atomicity and bot-capture tests**

Assert advisory lock occurs before active-period lookup; employee/period queries contain `organizationId`; clock-in entry and period share one transaction; clock-out entry, canonical record, period close, and pending approval share one transaction; bot capture uses recipient profile zone and `user_setting`; simultaneous clock-ins produce one success.

- [ ] **Step 2: Verify red**

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/time-tracking/transactional-clocking.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.atomicity.test.ts' \
  'src/app/api/time-entries/route.test.ts' \
  'src/lib/teams/commands/clock-out.test.ts'
```

Expected: FAIL because bot clocking duplicates and partially bypasses canonical logic.

- [ ] **Step 3: Implement shared service contracts**

```ts
export interface LiveClockActor {
	userId: string;
	employeeId: string;
	organizationId: string;
}

export async function clockInEmployee(input: {
	actor: LiveClockActor;
	at: Instant;
	capture: TimeEntryTimezoneCapture;
	workLocationType: WorkLocationType;
	transport: { ipAddress: string | null; deviceInfo: string };
}): Promise<ClockInResult>;

export async function clockOutEmployee(input: {
	actor: LiveClockActor;
	at: Instant;
	capture: TimeEntryTimezoneCapture;
	projectId?: string;
	workCategoryId?: string;
	transport: { ipAddress: string | null; deviceInfo: string };
}): Promise<ClockOutResult>;
```

Within one transaction, acquire an organization/employee advisory lock, re-check active state, insert the timezone-complete entry via `time-entry-writer`, and create/close the work period. Preserve current canonical-record, approval, surcharge, compliance, balance-dirty, and post-transaction notification behavior.

- [ ] **Step 4: Route web/API/bot callers through the service**

Bot calls `systemClock.nowInstant()`, resolves offset from `ctx.recipientTimezone`, and never sends browser evidence. Remove direct bot inserts. Preserve hash serialization through `serializeInstant()`.

- [ ] **Step 5: Verify and commit**

Run the Step 2 command plus the hash compatibility test. Expected: PASS.

```bash
git add apps/webapp/src/lib/time-tracking/time-entry-writer.ts apps/webapp/src/lib/time-tracking/transactional-clocking* apps/webapp/src/lib/teams/commands/clock-{in,out}* apps/webapp/src/app/api/time-entries/route.ts 'apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts'
git commit -m "refactor(time-tracking): share transactional live clocking"
```

### Task 3: Apply Personal And Organization Command Ownership

**Files:**
- Create: `apps/webapp/src/lib/teams/commands/timezone-ownership.test.ts`
- Modify: `apps/webapp/src/lib/teams/commands/status.ts`
- Modify: `apps/webapp/src/lib/teams/commands/clock-in.ts`
- Modify: `apps/webapp/src/lib/teams/commands/clock-out.ts`
- Modify: `apps/webapp/src/lib/teams/commands/clockedin.ts`
- Modify: `apps/webapp/src/lib/teams/commands/pending.ts`
- Modify: `apps/webapp/src/lib/teams/commands/coverage.ts`
- Modify: `apps/webapp/src/lib/teams/commands/compliance.ts`

- [ ] **Step 1: Write one three-zone ownership matrix**

Use recipient New York, organization Berlin, and digest schedule Kathmandu. Assert `/status`, `/clockin`, `/clockout` use New York; `/clockedin`, `/pending`, `/coverage`, `/compliance` use Berlin; changing only Kathmandu changes no command output; time-format preference affects presentation but not duration.

- [ ] **Step 2: Verify red**

```bash
pnpm --filter webapp exec vitest run 'src/lib/teams/commands/timezone-ownership.test.ts'
```

- [ ] **Step 3: Replace command-local timezone lookup**

Personal commands format with `{ timezone: ctx.recipientTimezone, locale: ctx.locale, timeFormat: ctx.timeFormat }`. Organization commands use `ctx.organizationTimezone`. Remove command references to `ctx.config.digestTimezone`, `digestScheduleTimezone`, and direct user-settings queries.

Add explicit `organizationId` to requester, absence, employee, period, coverage, and compliance lookups touched by these commands.

- [ ] **Step 4: Verify and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add apps/webapp/src/lib/teams/commands
git commit -m "fix(bot): apply personal and organization timezone ownership"
```

### Task 4: Use Plain Dates In `/whosout` And `/openshifts`

**Files:**
- Create: `apps/webapp/src/lib/teams/commands/whos-out.test.ts`
- Create: `apps/webapp/src/lib/teams/commands/open-shifts.test.ts`
- Modify: `apps/webapp/src/lib/teams/commands/whos-out.ts`
- Modify: `apps/webapp/src/lib/teams/commands/open-shifts.ts`
- Modify: `apps/webapp/src/lib/effect/services/open-shifts.service.ts`
- Create: `apps/webapp/src/lib/effect/services/open-shifts.service.test.ts`

- [ ] **Step 1: Write failing western/eastern logical-date tests**

At `2026-07-10T01:00Z`, assert organization New York and Berlin produce different `today` date keys. Assert absence return date is `PlainDate(endDate).add({ days: 1 })`, not a zoned midnight conversion. Assert open-shift week is seven logical dates and invalid `2026-02-30` is rejected before query.

- [ ] **Step 2: Implement plain-date ranges**

```ts
export interface LogicalDateRange {
	startDate: string;
	endDateExclusive: string;
}

export function parseOpenShiftDateRange(
	argument: string | undefined,
	today: PlainDate,
): LogicalDateRange;
```

Compute `today` from `systemClock.nowInstant().toZonedDateTimeISO(ctx.organizationTimezone).toPlainDate()`. Compare absence date strings directly. Change open-shifts service to accept date strings and query `>= startDate`, `< endDateExclusive`, and `organizationId`.

- [ ] **Step 3: Verify and commit**

```bash
pnpm --filter webapp exec vitest run 'src/lib/teams/commands/whos-out.test.ts' 'src/lib/teams/commands/open-shifts.test.ts' 'src/lib/effect/services/open-shifts.service.test.ts'
git add apps/webapp/src/lib/teams/commands/{whos-out,open-shifts}* apps/webapp/src/lib/effect/services/open-shifts.service*
git commit -m "fix(bot): use organization logical dates"
```

Expected: PASS.

### Task 5: Require Recipient Context In Telegram Approvals And Notifications

**Files:**
- Create: `apps/webapp/src/lib/telegram/formatters.test.ts`
- Create: `apps/webapp/src/lib/telegram/approval-handler.test.ts`
- Modify: `apps/webapp/src/lib/telegram/formatters.ts`
- Modify: `apps/webapp/src/lib/telegram/approval-handler.ts`
- Create: `apps/webapp/src/lib/notifications/recipient-display-context.ts`
- Create: `apps/webapp/src/lib/notifications/recipient-display-context.test.ts`
- Modify: `apps/webapp/src/lib/notifications/telegram-channel.ts`
- Modify: `apps/webapp/src/lib/notifications/telegram-channel.test.ts`
- Modify: `apps/webapp/src/lib/notifications/triggers.ts`
- Modify: `apps/webapp/src/lib/notifications/compliance-triggers.ts`

- [ ] **Step 1: Write failing explicit-recipient tests**

Assert one approval instant renders differently for Berlin and New York recipients, honors 12h/24h, is identical under two host `TZ` values, and date-only absence values do not shift. Assert an approval from another organization causes no lookup/update/send.

- [ ] **Step 2: Require context in formatter signatures**

```ts
export function buildApprovalMessage(
	data: ApprovalCardData,
	t: BotTranslateFn,
	display: { timezone: string; locale: string; timeFormat: "12h" | "24h" },
): { text: string; keyboard: TelegramInlineKeyboardMarkup };

export function buildResolvedApprovalMessage(
	data: ApprovalCardData,
	resolved: ApprovalResolvedData,
	t: BotTranslateFn,
	display: BotDisplayContext,
): string;
```

Use fixed UTC ISO strings in shared records and call `fmtBotInstant`. Add `organizationId` to approval request, approver, requester, absence, and Telegram message predicates.

- [ ] **Step 3: Resolve generic notification recipient context**

```ts
export async function resolveRecipientDisplayContext(input: {
	userId: string;
	organizationId: string;
}): Promise<{ timezone: string; locale: string; timeFormat: "12h" | "24h" }>;
```

Verify active employee membership in the organization before reading global user settings. Replace native/unzoned formatting in touched clock-out and compliance notifications.

- [ ] **Step 4: Verify host independence and commit**

```bash
TZ=UTC pnpm --filter webapp exec vitest run 'src/lib/telegram/formatters.test.ts' 'src/lib/telegram/approval-handler.test.ts' 'src/lib/notifications/telegram-channel.test.ts'
TZ=Pacific/Honolulu pnpm --filter webapp exec vitest run 'src/lib/telegram/formatters.test.ts' 'src/lib/telegram/approval-handler.test.ts' 'src/lib/notifications/telegram-channel.test.ts'
git add apps/webapp/src/lib/telegram apps/webapp/src/lib/notifications
git commit -m "fix(telegram): format notifications for recipients"
```

Expected: both runs PASS.

### Task 6: Separate Digest Schedule Zone From Content Zone

**Files:**
- Create: `apps/webapp/src/lib/bot-platform/digest-settings.ts`
- Create: `apps/webapp/src/lib/bot-platform/digest-settings.test.ts`
- Create: `apps/webapp/src/lib/telegram/jobs/digest-schedule.ts`
- Create: `apps/webapp/src/lib/telegram/jobs/digest-schedule.test.ts`
- Modify: `apps/webapp/src/lib/telegram/jobs/daily-digest.ts`
- Create: `apps/webapp/src/lib/telegram/jobs/daily-digest.test.ts`
- Modify: `apps/webapp/src/lib/teams/jobs/daily-digest.ts`
- Modify: `apps/webapp/src/lib/telegram/formatters.ts`

- [ ] **Step 1: Write failing validation and DST schedule tests**

Accept `00:00`, `23:59`, UTC/Berlin/Kathmandu; reject `9:30`, `24:00`, seconds, and invalid zones. Assert Berlin spring gap `02:30` materializes at `03:30`, fall fold chooses the earlier occurrence, and changing schedule timezone changes dispatch instant but not organization content date/query predicates.

- [ ] **Step 2: Implement schedule evaluator**

```ts
export function evaluateDigestOccurrence(input: {
	now: Instant;
	time: PlainTime;
	timezone: string;
	windowMinutes: number;
}): {
	logicalDate: string;
	scheduledInstant: string;
	due: boolean;
};
```

Resolve scheduled wall clock with `compatible`, compare instants explicitly, and return primitives.

- [ ] **Step 3: Restrict digest data builder inputs**

```ts
export async function buildDigestDataForManager(input: {
	managerId: string;
	organizationId: string;
	logicalDate: string;
	organizationTimezone: string;
	display: { locale: string; timeFormat: "12h" | "24h" };
	now: string;
}): Promise<DailyDigestData>;
```

Do not accept schedule timezone. Use organization timezone for dates and embedded times. Add explicit organization predicates to approvals, employees, absences, shifts, periods, compliance, and location lookups.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter webapp exec vitest run 'src/lib/bot-platform/digest-settings.test.ts' 'src/lib/telegram/jobs/digest-schedule.test.ts' 'src/lib/telegram/jobs/daily-digest.test.ts'
git add apps/webapp/src/lib/bot-platform/digest-settings* apps/webapp/src/lib/telegram/jobs apps/webapp/src/lib/teams/jobs/daily-digest.ts apps/webapp/src/lib/telegram/formatters.ts
git commit -m "fix(bot): separate digest schedule and content zones"
```

Expected: PASS.

### Task 7: Add Durable Digest Idempotency

**Files:**
- Modify: `apps/webapp/src/db/schema/telegram-integration.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Create: `apps/webapp/src/lib/telegram/jobs/digest-dispatch.ts`
- Create: `apps/webapp/src/lib/telegram/jobs/digest-dispatch.test.ts`
- Modify: `apps/webapp/src/lib/telegram/jobs/daily-digest.ts`
- Generate: next Drizzle SQL migration, snapshot, and journal entry after re-reading the current journal
- Modify: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`

- [ ] **Step 1: Write failing claim tests**

Assert first organization/date/type claim succeeds, duplicate fails, another organization succeeds, next date succeeds, concurrent claims have one winner, and completion update contains organization ID.

- [ ] **Step 2: Add dispatch schema**

```ts
export const telegramDigestDispatch = pgTable("telegram_digest_dispatch", {
	id: uuid("id").defaultRandom().primaryKey(),
	organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
	digestType: text("digest_type").default("daily").notNull(),
	logicalDate: date("logical_date", { mode: "string" }).notNull(),
	scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	status: text("status").default("claimed").notNull(),
}, (table) => [
	uniqueIndex("telegramDigestDispatch_org_type_date_unique_idx").on(
		table.organizationId,
		table.digestType,
		table.logicalDate,
	),
]);
```

- [ ] **Step 3: Generate the migration safely**

Re-read `apps/webapp/drizzle/meta/_journal.json`, then run the repository's pnpm Drizzle generation command so the migration receives a timestamp greater than every concurrent entry. Inspect generated SQL for only the new table/index/FK. Never edit `auth-schema.ts`.

- [ ] **Step 4: Claim before sending**

Use `insert(...).onConflictDoNothing(...).returning({ id })`. If no row returns, send nothing. Update completion by both dispatch ID and organization ID. Document at-most-once delivery: a crash after claim can skip a digest, while retrying uncertain Telegram sends could duplicate it.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter webapp exec vitest run 'src/lib/telegram/jobs/digest-dispatch.test.ts' 'src/lib/telegram/jobs/daily-digest.test.ts' 'src/db/__tests__/drizzle-migrations.test.ts'
git add apps/webapp/src/db/schema/telegram-integration.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/lib/telegram/jobs apps/webapp/drizzle
git commit -m "feat(telegram): make daily digests idempotent"
```

Expected: PASS.

### Task 8: Add Bot Guardrails And Verify

**Files:**
- Create: `apps/webapp/src/lib/bot-platform/temporal-guardrails.test.ts`

- [ ] **Step 1: Guard migrated bot files**

Reject direct Luxon imports, `ctx.config.digestTimezone`, unzoned native formatting, date-only strings passed to `new Date`, command-side direct inserts into time-entry/work-period, optional formatter timezone arguments, and Temporal objects in transport/digest records.

- [ ] **Step 2: Run the bot zone matrix**

```bash
TZ=UTC pnpm --filter webapp exec vitest run 'src/lib/teams/commands/timezone-ownership.test.ts' 'src/lib/telegram/formatters.test.ts' 'src/lib/telegram/jobs/digest-schedule.test.ts'
TZ=America/Los_Angeles pnpm --filter webapp exec vitest run 'src/lib/teams/commands/timezone-ownership.test.ts' 'src/lib/telegram/formatters.test.ts' 'src/lib/telegram/jobs/digest-schedule.test.ts'
```

Expected: both PASS with identical explicit-zone assertions.

- [ ] **Step 3: Run full verification**

```bash
pnpm --filter webapp exec vitest run 'src/lib/bot-platform' 'src/lib/teams/commands' 'src/lib/telegram' 'src/lib/notifications'
pnpm test
CI=true pnpm build
```

Expected: all tests and production build PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/lib/bot-platform/temporal-guardrails.test.ts
git commit -m "test(bot): enforce explicit temporal ownership"
```
