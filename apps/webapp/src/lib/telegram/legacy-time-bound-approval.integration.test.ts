/**
 * #432 runtime evidence: Telegram cards for legacy-authoritative manual time
 * submissions, policy clock-outs and time corrections (rollout `legacy`,
 * `shadow`, `ready`) decided through legacy reviewed bindings, and their
 * cycle-keyed legacy delivery.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Real callers run against that database: the time submission actions
 * (`clockIn`/`clockOut`, `createManualTimeEntry`, `requestTimeCorrection`,
 * `requestTimeEntryDeletion`), the web approvals actions, the requester's
 * correction cancellation, the real Telegram preparation/render (old path or
 * delivery owner), the real webhook update handler deciding through the shared
 * bot attempt and the legacy branches of the work-period and correction
 * decision owners, `processDueEscalations` (#439) and approval maintenance.
 * Only the request/session, billing, notification fan-out, the Next cache, the
 * bot token vault, the post-commit delivery fast path and the Telegram HTTP
 * transport (fetch) are replaced. Live clock-outs never route approval (#361),
 * so a policy clock-out is a historical one seeded through the real ordinary
 * submission. Every control row is inserted directly: production has no setter.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	kicks: [] as Array<{ organizationId: string; workflowId?: string | null }>,
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 12,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: {
								id: harness.userId,
								role: "user",
								name: harness.userId,
								email: `${harness.userId}@example.test`,
							},
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-helpers")>()),
	isOrgAdminCasl: async () => false,
	canApproveFor: async () => false,
	// React `cache` would pin the first actor for the whole test process.
	getAuthContext: async () => {
		if (!harness.userId || !harness.organizationId) return null;
		const { db } = await import("@/db");
		const { employee } = await import("@/db/schema");
		const { and, eq } = await import("drizzle-orm");
		const [row] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, harness.userId),
					eq(employee.organizationId, harness.organizationId),
				),
			)
			.limit(1);
		return {
			user: { id: harness.userId, name: harness.userId, email: `${harness.userId}@example.test` },
			session: { activeOrganizationId: harness.organizationId },
			employee: row
				? { id: row.id, organizationId: row.organizationId, role: row.role, teamId: row.teamId }
				: null,
		};
	},
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t432.example.test",
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/policy-helpers", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("@/app/[locale]/(app)/time-tracking/actions/policy-helpers")
		>();
	return {
		...original,
		getEditCapabilityForPeriod: async () => ({ type: "approval_required" as const }),
	};
});

vi.mock("@/app/[locale]/(app)/time-tracking/actions/shared", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/app/[locale]/(app)/time-tracking/actions/shared")>();
	return {
		...original,
		logger: {
			...original.logger,
			error: () => {},
			warn: () => {},
			info: () => {},
			debug: () => {},
		},
	};
});

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: async () => ({ success: true }),
}));

vi.mock("@/lib/work-balance/service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/work-balance/service")>()),
	markEmployeeWorkBalanceDirty: async () => undefined,
}));

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async () => "432432432:AAT432-legacy_time_card_test",
}));

// The post-commit fast path only runs the owner sooner; tests run it explicitly.
vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
		harness.kicks.push(input);
	},
}));

const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { requestTimeCorrection, requestTimeEntryDeletion } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/corrections"
);
const { approveTimeCorrection: approveOnWeb, rejectTimeCorrection: rejectOnWeb } = await import(
	"@/app/[locale]/(app)/approvals/actions"
);
const { cancelMyTimeCorrectionRequest } = await import("@/app/[locale]/(app)/my-requests/actions");
await import("@/lib/approvals/init");
const { processDueEscalations } = await import("@/lib/approvals/escalation/transfer");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { prepareApprovalPresentation } = await import("@/lib/approvals/presentation");
const { sendTelegramNotification } = await import("@/lib/notifications/telegram-channel");
const { assessApprovalPilotReadiness } = await import("@/lib/approvals/pilot/readiness");
const { submitHistoricalPolicyClockOut } = await import(
	"@/lib/time-tracking/__tests__/historical-policy-clock-out"
);
const { workPeriodReceiptKeyDigest } = await import(
	"@/lib/approvals/evidence/work-period-evidence"
);
const { timeCorrectionReceiptKeyDigest } = await import(
	"@/lib/approvals/evidence/time-correction-evidence"
);
const { db } = await import("@/db");
const { sendApprovalMessageToManager } = await import("./approval-handler");
const { handleTelegramUpdate } = await import("./bot-handler");

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`Legacy time bound approval PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const TIME_KINDS = ["manual_time_submission", "policy_clock_out", "time_correction"] as const;
type TimeKind = (typeof TIME_KINDS)[number];
const MODES = ["legacy", "shadow", "ready"] as const;
type Mode = (typeof MODES)[number];

const BOT_TOKEN = "432432432:AAT432-legacy_time_card_test";
const OTHER_BOT_TOKEN = "432432433:AAT432-other_org_bot";
const TELEGRAM = {
	manager: { user: 43_201, chat: 432_551 },
	backup: { user: 43_202, chat: 432_552 },
	third: { user: 43_203, chat: 432_553 },
	admin: { user: 43_204, chat: 432_554 },
} as const;
type Approver = keyof typeof TELEGRAM;

const ids = {
	organization: "t432-legacy-time-org",
	otherOrganization: "t432-other-org",
	requesterUser: "t432-requester-user",
	managerUser: "t432-manager-user",
	backupUser: "t432-backup-user",
	thirdUser: "t432-third-user",
	adminUser: "t432-admin-user",
	requester: "e4320000-0000-4000-8000-000000000001",
	manager: "e4320000-0000-4000-8000-000000000002",
	backup: "e4320000-0000-4000-8000-000000000003",
	third: "e4320000-0000-4000-8000-000000000004",
	admin: "e4320000-0000-4000-8000-000000000005",
	managerInOther: "e4320000-0000-4000-8000-000000000006",
	managerLink: "e4321000-0000-4000-8000-000000000001",
	backupLink: "e4321000-0000-4000-8000-000000000002",
	thirdLink: "e4321000-0000-4000-8000-000000000003",
	changePolicy: "e4322000-0000-4000-8000-000000000001",
	changePolicyAssignment: "e4322000-0000-4000-8000-000000000002",
	chainPolicy: "e4323000-0000-4000-8000-000000000001",
	chainFirstStage: "e4323000-0000-4000-8000-000000000002",
	chainSecondStage: "e4323000-0000-4000-8000-000000000003",
} as const;

const USERS: Record<Approver, string> = {
	manager: ids.managerUser,
	backup: ids.backupUser,
	third: ids.thirdUser,
	admin: ids.adminUser,
};
const EMPLOYEES: Record<Approver, string> = {
	manager: ids.manager,
	backup: ids.backup,
	third: ids.third,
	admin: ids.admin,
};

const TITLES: Record<TimeKind, string> = {
	manual_time_submission: "Manual time approval request",
	policy_clock_out: "Clock-out approval request",
	time_correction: "Time correction approval request",
};

const bot = (organizationId: string = ids.organization, botToken = BOT_TOKEN) => ({
	organizationId,
	botToken,
	botUsername: "t432_bot",
	webhookSecret: "t432-secret",
	setupStatus: "active",
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: false,
	enableEscalations: false,
	digestTime: "09:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
});

interface TelegramCall {
	method: string;
	body: Record<string, unknown>;
}

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

function bindingOf(callbackData: string | undefined): string {
	return (JSON.parse(callbackData ?? "{}") as { b: string }).b;
}

/** The nth test day; every submission gets its own day, so periods never overlap. */
function dayOf(index: number): string {
	return new Date(Date.UTC(2026, 6, 6 + index)).toISOString().slice(0, 10);
}

describeIntegration(
	"Legacy time approval Telegram cards with reviewed bindings (PostgreSQL)",
	() => {
		vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });
		const admin = new Pool({ connectionString: databaseUrl, max: 6 });
		const calls: TelegramCall[] = [];
		let nextMessageId = 43_200;
		let nextUpdateId = 432_000;
		let day = 0;
		const originalFetch = globalThis.fetch;

		function actAs(userId: string | null) {
			harness.userId = userId;
			harness.organizationId = userId ? ids.organization : null;
		}

		/** The Telegram Bot API transport; everything above it is real. */
		function installTelegramTransport() {
			globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				const match = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
				if (!match) throw new Error(`Unexpected fetch in test: ${url}`);
				const method = match[1] ?? "";
				const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
				calls.push({ method, body });
				const result =
					method === "sendMessage"
						? {
								message_id: nextMessageId++,
								date: 1_790_000_000,
								chat: { id: Number(body.chat_id), type: "private" },
								text: body.text,
							}
						: true;
				return new Response(JSON.stringify({ ok: true, result }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}) as typeof fetch;
		}

		async function cleanup() {
			await admin.query("drop function if exists t432_fail_invocation() cascade");
			await admin.query("delete from organization where id = any($1::text[])", [
				[ids.organization, ids.otherOrganization],
			]);
			await admin.query('delete from "user" where id = any($1::text[])', [
				[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser],
			]);
		}

		async function setMode(mode: Mode | "canonical") {
			await admin.query(
				`update approval_workflow_rollout set lifecycle_mode = $2, side_effect_mode = $3
			 where organization_id = $1`,
				[ids.organization, mode, mode === "canonical" ? "canonical" : "legacy"],
			);
		}

		async function setPresentation(provider: string, mode: "actionable" | "review_only") {
			for (const kind of TIME_KINDS) {
				await admin.query(
					`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
				 values ($1, $2, $3, $4)
				 on conflict (organization_id, workflow_type, provider) do update set mode = excluded.mode`,
					[ids.organization, kind, provider, mode],
				);
			}
		}

		async function seed(
			options: {
				mode?: Mode | "canonical";
				capture?: boolean;
				presentation?: "actionable" | "review_only" | null;
				delivery?: boolean;
				twoStageChain?: boolean;
				escalation?: boolean;
			} = {},
		) {
			await cleanup();
			day = 0;
			const timestamp = new Date("2026-07-01T00:00:00Z");
			const mode = options.mode ?? "legacy";
			await admin.query(
				`insert into organization (id, name, slug, created_at) values
			 ($1, 'T432 legacy time', $1, $3), ($2, 'T432 other', $2, $3)`,
				[ids.organization, ids.otherOrganization, timestamp],
			);
			for (const kind of TIME_KINDS) {
				await admin.query(
					`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, $2, $3, $4, $5, $5)`,
					[ids.organization, kind, mode, mode === "canonical" ? "canonical" : "legacy", timestamp],
				);
				if (options.capture ?? true) {
					await admin.query(
						`insert into approval_evidence_control (organization_id, workflow_type, mode)
					 values ($1, $2, 'capture')`,
						[ids.organization, kind],
					);
				}
				if (options.delivery) {
					await admin.query(
						`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
					 values ($1, $2, 'telegram', $3)`,
						[ids.organization, kind, timestamp],
					);
				}
			}
			const presentation = options.presentation === undefined ? "actionable" : options.presentation;
			if (presentation) await setPresentation("telegram", presentation);
			if (options.escalation) {
				await admin.query(
					`insert into approval_escalation_control
				 (organization_id, owner, automation_paused, escalation_owned_since)
				 values ($1, 'escalation', false, $2)`,
					[ids.organization, timestamp],
				);
				await admin.query(
					`insert into approval_escalation_policy
				 (organization_id, enabled, response_window_hours, revision, migration_provenance)
				 values ($1, true, 1, 1, '{"source":"t432"}'::jsonb)`,
					[ids.organization],
				);
			}
			const users = [
				ids.requesterUser,
				ids.managerUser,
				ids.backupUser,
				ids.thirdUser,
				ids.adminUser,
			];
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't432-requester@example.test', $6, $6),
			 ($2, 'Morgan Manager', 't432-manager@example.test', $6, $6),
			 ($3, 'Blake Backup', 't432-backup@example.test', $6, $6),
			 ($4, 'Taylor Third', 't432-third@example.test', $6, $6),
			 ($5, 'Ada Admin', 't432-admin@example.test', $6, $6)`,
				[...users, timestamp],
			);
			await admin.query(
				`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'UTC', '24h', $2 from unnest($1::text[]) as user_id`,
				[users, timestamp],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't432-member-' || user_id, $1, user_id,
			   case when user_id = $4 then 'admin' else 'member' end, 'approved', $2
			 from unnest($3::text[]) as user_id`,
				[ids.organization, timestamp, users, ids.adminUser],
			);
			// The manager is also a member of another organization with its own bot.
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t432-member-other-manager', $1, $2, 'member', 'approved', $3)`,
				[ids.otherOrganization, ids.managerUser, timestamp],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'employee', $12), ($3, $4, $11, 'manager', $12),
			 ($5, $6, $11, 'manager', $12), ($7, $8, $11, 'manager', $12),
			 ($9, $10, $11, 'admin', $12), ($13, $4, $14, 'manager', $12)`,
				[
					ids.requester,
					ids.requesterUser,
					ids.manager,
					ids.managerUser,
					ids.backup,
					ids.backupUser,
					ids.third,
					ids.thirdUser,
					ids.admin,
					ids.adminUser,
					ids.organization,
					timestamp,
					ids.managerInOther,
					ids.otherOrganization,
				],
			);
			// All three are direct managers: the former holder stays eligible, the
			// backup is escalation's first candidate, and the third never holds anything.
			await admin.query(
				`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at) values
			 ($1, $4, $5, true, $8, $9, $9),
			 ($2, $4, $6, false, $8, $9, $9),
			 ($3, $4, $7, false, $8, $10, $10)`,
				[
					ids.managerLink,
					ids.backupLink,
					ids.thirdLink,
					ids.requester,
					ids.manager,
					ids.backup,
					ids.third,
					ids.managerUser,
					timestamp,
					new Date("2026-07-02T00:00:00Z"),
				],
			);
			await admin.query(
				`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
				[ids.organization],
			);
			// Manual entries and corrections of any past day need approval.
			await admin.query(
				`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T432 manual approval', 0, 3650, $3, $4)`,
				[ids.changePolicy, ids.organization, ids.managerUser, timestamp],
			);
			await admin.query(
				`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, $5)`,
				[
					ids.changePolicyAssignment,
					ids.changePolicy,
					ids.organization,
					ids.managerUser,
					timestamp,
				],
			);
			if (options.twoStageChain) {
				await admin.query(
					`insert into approval_policy
				 (id, organization_id, name, is_active, priority, created_by, updated_at)
				 values ($1, $2, 'T432 two stages', true, 1, $3, $4)`,
					[ids.chainPolicy, ids.organization, ids.managerUser, timestamp],
				);
				await admin.query(
					`insert into approval_policy_stage
				 (id, organization_id, policy_id, step_order, label, approver_type,
				  approver_employee_id, fallback_behavior, updated_at) values
				 ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', $6),
				 ($2, $3, $4, 2, 'Final', 'specific_employee', $5, 'fail', $6)`,
					[
						ids.chainFirstStage,
						ids.chainSecondStage,
						ids.organization,
						ids.chainPolicy,
						ids.admin,
						timestamp,
					],
				);
			}
			// Verified Telegram linkage and private chats (the bot resolves actors
			// from these, never from callback data).
			for (const approver of Object.keys(TELEGRAM) as Approver[]) {
				await admin.query(
					`insert into telegram_user_mapping
				 (user_id, organization_id, telegram_user_id, is_active, updated_at)
				 values ($1, $2, $3, true, $4)`,
					[USERS[approver], ids.organization, String(TELEGRAM[approver].user), timestamp],
				);
				await admin.query(
					`insert into telegram_conversation
				 (organization_id, user_id, chat_id, chat_type, is_active, updated_at)
				 values ($1, $2, $3, 'private', true, $4)`,
					[ids.organization, USERS[approver], String(TELEGRAM[approver].chat), timestamp],
				);
			}
			await admin.query(
				`insert into telegram_user_mapping
			 (user_id, organization_id, telegram_user_id, is_active, updated_at)
			 values ($1, $2, $3, true, $4)`,
				[ids.managerUser, ids.otherOrganization, String(TELEGRAM.manager.user), timestamp],
			);
			// The delivery owner's adapter needs the organization's active bot.
			await admin.query(
				`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't432_bot', 't432-secret', 'active', true, false, $2)`,
				[ids.organization, timestamp],
			);
		}

		/** Real clock-in and clock-out; with approval, a historical policy clock-out. */
		async function recordWork(start: Instant, end: Instant, options: { approval: boolean }) {
			actAs(ids.requesterUser);
			await expect(
				clockIn("office", { instant: start, browserTimezone: "UTC" }),
			).resolves.toMatchObject({ success: true });
			await expect(
				clockOut(undefined, undefined, {
					submissionId: randomUUID(),
					instant: end,
					browserTimezone: "UTC",
				}),
			).resolves.toMatchObject({ success: true });
			actAs(null);
			const { rows } = await admin.query<{ id: string }>(
				`select id from work_period
			 where employee_id = $1 and start_time = $2 and deleted_at is null`,
				[ids.requester, new Date(start.epochMilliseconds)],
			);
			const workPeriodId = only(rows).id;
			if (options.approval) {
				await submitHistoricalPolicyClockOut({
					organizationId: ids.organization,
					employeeId: ids.requester,
					userId: ids.requesterUser,
					workPeriodId,
				});
			}
			return workPeriodId;
		}

		async function submitManual(date: string): Promise<string> {
			actAs(ids.requesterUser);
			const result = await createManualTimeEntry({
				version: 2,
				submissionId: randomUUID(),
				targetEmployeeId: ids.requester,
				date,
				clockIn: { time: "09:00", occurrence: null, displayedOffsetMinutes: 120 },
				clockOut: { time: "17:30", occurrence: null, displayedOffsetMinutes: 120 },
				zone: { basis: "browser", timezone: "Europe/Berlin" },
				browserTimezone: "Europe/Berlin",
				reason: "Forgot to clock",
				projectId: null,
				workCategoryId: null,
			});
			actAs(null);
			expect(result).toMatchObject({ success: true, data: { requiresApproval: true } });
			const { rows } = await admin.query<{ id: string }>(
				`select id from work_period
			 where employee_id = $1 and start_time::date = $2::date and deleted_at is null`,
				[ids.requester, date],
			);
			return only(rows).id;
		}

		async function requestEdit(
			workPeriodId: string,
			date: string,
			variant: "edit" | "metadata" | "delete" = "edit",
		) {
			actAs(ids.requesterUser);
			const result =
				variant === "delete"
					? await requestTimeEntryDeletion({
							workPeriodId,
							submissionId: randomUUID(),
							reason: "Recorded by mistake",
						})
					: await requestTimeCorrection({
							workPeriodId,
							submissionId: randomUUID(),
							newClockInDate: date,
							newClockInTime: variant === "edit" ? "07:30" : "08:00",
							newClockOutDate: date,
							newClockOutTime: variant === "edit" ? "15:00" : "16:00",
							reason: "Started earlier",
							workLocationType: variant === "edit" ? "office" : "home",
							workCategoryId: null,
						});
			actAs(null);
			expect(result).toMatchObject({ success: true });
		}

		/**
		 * Submits one kind through the real actions on its own day and returns the
		 * work period with its pending legacy request.
		 */
		async function submit(
			kind: TimeKind,
			variant: "edit" | "metadata" | "delete" = "edit",
		): Promise<{ workPeriodId: string; requestId: string }> {
			const date = dayOf(day++);
			let workPeriodId: string;
			switch (kind) {
				case "manual_time_submission":
					workPeriodId = await submitManual(date);
					break;
				case "policy_clock_out":
					workPeriodId = await recordWork(
						parseInstant(`${date}T08:00:00Z`),
						parseInstant(`${date}T12:00:00Z`),
						{ approval: true },
					);
					break;
				case "time_correction":
					workPeriodId = await recordWork(
						parseInstant(`${date}T08:00:00Z`),
						parseInstant(`${date}T16:00:00Z`),
						{ approval: false },
					);
					await requestEdit(workPeriodId, date, variant);
					break;
			}
			return { workPeriodId, requestId: (await pendingRequest(workPeriodId)).id };
		}

		async function pendingRequest(workPeriodId: string) {
			const { rows } = await admin.query<{ id: string; created_at: Date; approver_id: string }>(
				`select id, created_at, approver_id from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2
			   and status = 'pending'`,
				[ids.organization, workPeriodId],
			);
			return only(rows);
		}

		function parseSent(message: TelegramCall) {
			const markup = message.body.reply_markup as
				| { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }
				| undefined;
			const buttons = markup?.inline_keyboard.flat() ?? [];
			return {
				text: String(message.body.text),
				buttons,
				callbackData: buttons
					.map((button) => button.callback_data)
					.filter((data): data is string => typeof data === "string"),
				chatId: Number(message.body.chat_id),
			};
		}

		/**
		 * Sends the real initial card through the old path and returns what reached
		 * Telegram. The old path tracks one message per request, so a later card for
		 * the same request replaces the earlier card's tracking.
		 */
		async function sendCard(requestId: string, approver: Approver = "manager") {
			await admin.query("delete from telegram_approval_message where approval_request_id = $1", [
				requestId,
			]);
			const before = calls.length;
			await sendApprovalMessageToManager(
				requestId,
				EMPLOYEES[approver],
				ids.organization,
				BOT_TOKEN,
			);
			const sent = calls.slice(before).filter((call) => call.method === "sendMessage");
			const { rows } = await admin.query<{ message_id: string }>(
				`select message_id from telegram_approval_message
			 where organization_id = $1 and approval_request_id = $2 and recipient_user_id = $3
			 order by created_at desc limit 1`,
				[ids.organization, requestId, USERS[approver]],
			);
			return { ...parseSent(only(sent)), messageId: Number(only(rows).message_id), approver };
		}

		async function press(
			card: { callbackData: string[]; messageId: number; approver: Approver },
			options: {
				action?: "approve" | "reject";
				queryId?: string;
				updateId?: number;
				as?: Approver;
				botConfig?: ReturnType<typeof bot>;
			} = {},
		) {
			const as = options.as ?? card.approver;
			const before = calls.length;
			await handleTelegramUpdate(
				{
					update_id: options.updateId ?? nextUpdateId++,
					callback_query: {
						id: options.queryId ?? randomUUID(),
						from: { id: TELEGRAM[as].user, is_bot: false, first_name: as },
						message: {
							message_id: card.messageId,
							date: 1_790_000_000,
							chat: { id: TELEGRAM[as].chat, type: "private" as const },
						},
						data: card.callbackData[options.action === "reject" ? 1 : 0] ?? "",
					},
				},
				options.botConfig ?? bot(),
			);
			const after = calls.slice(before);
			return {
				edits: after.filter((call) => call.method === "editMessageText"),
				answers: after.filter((call) => call.method === "answerCallbackQuery"),
			};
		}

		/** Every lifecycle row a legacy decision could write, for "nothing changed" checks. */
		async function state(workPeriodId: string) {
			const { rows } = await admin.query<Record<string, string>>(
				`select
			   (select approval_status::text from work_period where id = $1) as period,
			   (select string_agg(status::text, ',' order by created_at, id) from approval_request
			     where entity_id = $1) as requests,
			   (select count(*) from approval_decision_evidence d
			     join approval_submitted_revision r on r.id = d.submitted_revision_id
			     where r.source_id = $1 and d.operation_kind = 'command') as decisions,
			   (select count(*) from approval_invocation i
			     join approval_decision_evidence d on d.id = i.decision_evidence_id
			     join approval_submitted_revision r on r.id = d.submitted_revision_id
			     where r.source_id = $1) as invocations`,
				[workPeriodId],
			);
			return only(rows);
		}

		async function bindingCount() {
			const { rows } = await admin.query<{ count: number }>(
				"select count(*)::int as count from approval_review_binding where organization_id = $1",
				[ids.organization],
			);
			return only(rows).count;
		}

		/** One delivery owner pass; returns what reached Telegram. */
		async function runOwner() {
			const before = calls.length;
			const summary = await processApprovalDeliveries({ organizationId: ids.organization });
			const after = calls.slice(before);
			return {
				summary,
				sent: after.filter((call) => call.method === "sendMessage").map(parseSent),
				edits: after.filter((call) => call.method === "editMessageText"),
			};
		}

		async function messages(workPeriodId: string) {
			const { rows } = await admin.query<{
				id: string;
				remote_message_id: string;
				recipient_employee_id: string;
				legacy_approval_request_id: string;
				legacy_cycle_id: string;
				workflow_type: string;
				binding_id: string | null;
				controls: string;
				state: string;
				status_version: number;
			}>(
				`select id, remote_message_id, recipient_employee_id, legacy_approval_request_id,
			        legacy_cycle_id, workflow_type, binding_id, controls, state, status_version
			 from approval_delivery_message
			 where legacy_source_id = $1 and lifecycle = 'legacy'
			 order by created_at, id`,
				[workPeriodId],
			);
			return rows;
		}

		/** An owner-delivered card as a pressable card of its recipient. */
		async function deliveredCard(
			sent: ReturnType<typeof parseSent>,
			approver: Approver = "manager",
		): Promise<{ callbackData: string[]; messageId: number; approver: Approver }> {
			const { rows } = await admin.query<{ remote_message_id: string }>(
				"select remote_message_id from approval_delivery_message where binding_id = $1",
				[bindingOf(sent.callbackData[0])],
			);
			return {
				callbackData: sent.callbackData,
				messageId: Number(only(rows).remote_message_id),
				approver,
			};
		}

		/** The pending-approval notification the existing path sends to the manager. */
		async function oldPathNotification(
			entityType: "work_period" | "approval_request",
			entityId: string,
		) {
			const before = calls.length;
			await sendTelegramNotification({
				userId: ids.managerUser,
				organizationId: ids.organization,
				type: "approval_request_submitted",
				title: "Time approval",
				message: "Avery Requester submitted time",
				entityType,
				entityId,
			});
			return calls.slice(before).filter((call) => call.method === "sendMessage");
		}

		async function intents() {
			const { rows } = await admin.query<{
				event: string;
				workflow_type: string;
				source_id: string;
				legacy_approval_request_id: string;
				legacy_cycle_id: string | null;
			}>(
				`select event, workflow_type, source_id, legacy_approval_request_id, legacy_cycle_id
			 from approval_delivery_intent where organization_id = $1 order by created_at, id`,
				[ids.organization],
			);
			return rows;
		}

		beforeAll(async () => {
			const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
				databaseUrl,
				required: integrationRequired,
				sentinel: testSentinel,
				currentDatabase: async () => {
					const result = await admin.query<{ database_name: string }>(
						"select current_database() as database_name",
					);
					return result.rows[0]?.database_name ?? "";
				},
			});
			if (enabled.status !== "enabled") {
				throw new Error("Legacy time bound approval PostgreSQL is disabled");
			}
		});

		beforeEach(() => {
			actAs(null);
			harness.kicks.length = 0;
			calls.length = 0;
			installTelegramTransport();
		});

		afterEach(() => {
			globalThis.fetch = originalFetch;
		});

		afterAll(async () => {
			await cleanup();
			await admin.end();
			const { pool } = (await import("@/db")) as unknown as { pool: Pool };
			await pool.end();
		});

		describe.each(MODES)("under %s authority", (mode) => {
			it.each(TIME_KINDS)(
				"binds a %s card to the exact legacy request and revision and decides it once",
				async (kind) => {
					await seed({ mode });
					const { workPeriodId, requestId } = await submit(kind);
					const card = await sendCard(requestId);

					expect(card.chatId).toBe(TELEGRAM.manager.chat);
					expect(card.text).toContain(TITLES[kind]);
					expect(card.text).toContain("Employee: Avery Requester");
					expect(card.text).not.toContain("Started earlier");
					expect(card.buttons.map((button) => button.text)).toEqual([
						"Approve",
						"Reject",
						"Review in Z8",
					]);
					expect(card.buttons[2]?.url).toBe(
						`https://t432.example.test/approvals/review/${ids.organization}/compatibility/${requestId}`,
					);
					const bindingId = bindingOf(card.callbackData[0]);
					const { rows } = await admin.query(
						`select b.authority, b.recipient_employee_id, b.workflow_id, b.assignment_id,
					        b.legacy_approval_request_id, r.authority as revision_authority,
					        r.workflow_type, r.source_id, r.legacy_approval_request_id as revision_request
					 from approval_review_binding b
					 join approval_submitted_revision r on r.id = b.submitted_revision_id
					 where b.id = $1`,
						[bindingId],
					);
					expect(only(rows)).toEqual({
						authority: "legacy",
						recipient_employee_id: ids.manager,
						workflow_id: null,
						assignment_id: null,
						legacy_approval_request_id: requestId,
						revision_authority: "legacy",
						workflow_type: kind,
						source_id: workPeriodId,
						revision_request: requestId,
					});

					const queryId = `t432-${mode}-${kind}`;
					const decided = await press(card, { queryId });
					expect(only(decided.answers).body).toMatchObject({ text: "Request approved" });
					expect(await state(workPeriodId)).toMatchObject({
						period: "approved",
						decisions: "1",
						invocations: "1",
					});
					expect((await state(workPeriodId)).requests.split(",").at(-1)).toBe("approved");
					const { rows: associations } = await admin.query(
						`select i.authority, i.workflow_id, i.legacy_approval_request_id, i.invocation_id,
					        i.actor_employee_id, i.reviewed_binding_id, i.action, i.receipt_idempotency_key,
					        d.authority as evidence_authority, d.receipt_idempotency_key as evidence_key,
					        d.reviewed_binding_id as evidence_binding, d.workflow_id as evidence_workflow,
					        d.legacy_approval_request_id as evidence_request, d.assignment_outcome,
					        d.request_outcome, d.actor_employee_id as evidence_actor,
					        d.observed_workflow_id is not null as observed
					 from approval_invocation i
					 join approval_decision_evidence d on d.id = i.decision_evidence_id
					 where i.organization_id = $1`,
						[ids.organization],
					);
					const association = only(associations);
					expect(association).toMatchObject({
						authority: "legacy",
						workflow_id: null,
						legacy_approval_request_id: requestId,
						invocation_id: queryId,
						actor_employee_id: ids.manager,
						reviewed_binding_id: bindingId,
						action: "approve",
						evidence_authority: "legacy",
						evidence_binding: bindingId,
						evidence_workflow: null,
						evidence_request: requestId,
						assignment_outcome: "approved",
						request_outcome: "approved",
						evidence_actor: ids.manager,
						// A shadow/ready observation is recorded as observed, never as authority.
						observed: mode !== "legacy",
					});
					// #290's invocation receipt identity; time evidence keeps its digest (#325).
					expect(association.receipt_idempotency_key).toBe(
						`approval-invocation:v1:telegram_callback_query:22:telegram-bot:432432432:${queryId.length}:${queryId}`,
					);
					const digest =
						kind === "time_correction"
							? timeCorrectionReceiptKeyDigest
							: workPeriodReceiptKeyDigest;
					expect(association.evidence_key).toBe(digest(association.receipt_idempotency_key));
				},
			);
		});

		it("binds and decides metadata-only and deletion correction cards", async () => {
			await seed();
			const metadata = await submit("time_correction", "metadata");
			const deletion = await submit("time_correction", "delete");
			const metadataCard = await sendCard(metadata.requestId);
			const deletionCard = await sendCard(deletion.requestId);
			expect(metadataCard.text).toContain("Request: Change work details");
			expect(deletionCard.text).toContain("Request: Delete this entry");
			expect(metadataCard.callbackData).toHaveLength(2);
			expect(deletionCard.callbackData).toHaveLength(2);

			await press(metadataCard);
			await press(deletionCard, { action: "reject" });

			expect(await state(metadata.workPeriodId)).toMatchObject({
				decisions: "1",
				invocations: "1",
			});
			expect((await state(metadata.workPeriodId)).requests).toBe("approved");
			expect(await state(deletion.workPeriodId)).toMatchObject({
				decisions: "1",
				invocations: "1",
			});
			expect((await state(deletion.workPeriodId)).requests).toBe("rejected");
			const { rows } = await admin.query<{ work_location_type: string; deleted: boolean }>(
				"select work_location_type, deleted_at is not null as deleted from work_period where id = $1",
				[metadata.workPeriodId],
			);
			expect(only(rows)).toEqual({ work_location_type: "home", deleted: false });
		});

		it("sends the unchanged review-only notice and binds nothing when any gate is missing", async () => {
			const gates: Array<{ name: string; options: Parameters<typeof seed>[0] }> = [
				{ name: "no presentation control", options: { presentation: null } },
				{ name: "review_only", options: { presentation: "review_only" } },
				{ name: "capture inactive", options: { capture: false } },
			];
			for (const gate of gates) {
				await seed(gate.options);
				const { requestId } = await submit("manual_time_submission");
				const card = await sendCard(requestId);
				expect(card.text, gate.name).toContain("Review required");
				expect(card.callbackData, gate.name).toEqual([]);
				expect(await bindingCount(), gate.name).toBe(0);
			}

			// A material change after submission: the revision no longer matches.
			await seed();
			const changed = await submit("manual_time_submission");
			await admin.query(
				"update work_period set end_time = end_time + interval '1 minute' where id = $1",
				[changed.workPeriodId],
			);
			const stale = await sendCard(changed.requestId);
			expect(stale.text).toContain("Review required");
			expect(stale.callbackData).toEqual([]);

			// Teams and Discord share the bound path but are not admitted for legacy
			// time cards, even with an actionable control; Slack never decides.
			await setPresentation("teams", "actionable");
			await setPresentation("discord", "actionable");
			const pending = await submit("time_correction");
			for (const provider of ["teams", "discord", "slack"] as const) {
				const presented = await prepareApprovalPresentation({
					approvalId: pending.requestId,
					recipientEmployeeId: ids.manager,
					organizationId: ids.organization,
					provider,
					summary: { fits: () => true },
				});
				expect(presented.status, provider).toBe("review_required");
			}
			expect(await bindingCount()).toBe(0);
		});

		it("commits one legacy decision per callback query and replays it exactly on redelivery", async () => {
			await seed();
			const { workPeriodId, requestId } = await submit("manual_time_submission");
			const card = await sendCard(requestId);
			const first = { queryId: "t432-query-1", updateId: 1001 };

			const fresh = await press(card, first);
			const decided = await state(workPeriodId);
			expect(decided).toMatchObject({ period: "approved", requests: "approved", invocations: "1" });
			expect(only(fresh.edits).body.text).toContain("Request approved");
			expect(JSON.stringify(only(fresh.edits).body.reply_markup)).not.toContain("callback_data");

			// Transport redelivery and a new update carrying the same query replay.
			for (const updateId of [1001, 1002]) {
				const replay = await press(card, { ...first, updateId });
				expect(await state(workPeriodId)).toEqual(decided);
				expect(only(replay.edits).body.text).toContain("original result");
			}
			// The same query with a different command conflicts; nothing changes.
			const conflict = await press(card, { ...first, updateId: 1003, action: "reject" });
			expect(await state(workPeriodId)).toEqual(decided);
			expect(only(conflict.edits).body.text).toContain("different action");
			// A fresh query gets fresh checks and never falls back to the old receipt.
			const again = await press(card, { queryId: "t432-query-2" });
			expect(await state(workPeriodId)).toEqual(decided);
			expect(only(again.answers).body).toMatchObject({ text: "Review required" });

			// A semantic web retry never matches the invocation's receipt.
			actAs(ids.managerUser);
			const web = await approveOnWeb(requestId);
			actAs(null);
			expect(web.success).toBe(false);
			expect(await state(workPeriodId)).toEqual(decided);
		});

		it("rejects through the same path with the persisted rejection", async () => {
			await seed({ mode: "shadow" });
			const { workPeriodId, requestId } = await submit("policy_clock_out");
			const card = await sendCard(requestId);

			const rejected = await press(card, { action: "reject" });

			expect(only(rejected.edits).body.text).toContain("Request rejected");
			expect(await state(workPeriodId)).toMatchObject({
				period: "rejected",
				requests: "rejected",
				decisions: "1",
				invocations: "1",
			});
			const { rows } = await admin.query(
				`select d.assignment_outcome, d.request_outcome, d.workflow_id,
			        d.observed_workflow_id is not null as observed, r.rejection_reason
			 from approval_decision_evidence d join approval_request r on r.id = d.legacy_approval_request_id
			 where r.id = $1`,
				[requestId],
			);
			expect(only(rows)).toEqual({
				assignment_outcome: "rejected",
				request_outcome: "rejected",
				workflow_id: null,
				observed: true,
				rejection_reason: "Rejected via Telegram",
			});
		});

		it.each(["manual_time_submission", "time_correction"] as const)(
			"records a %s chain stage as an intermediate step and decides the next stage's own card",
			async (kind) => {
				await seed({ twoStageChain: true });
				const { workPeriodId, requestId } = await submit(kind);
				const card = await sendCard(requestId);

				const first = await press(card);
				expect(only(first.edits).body.text).toContain("Approval recorded");
				const afterStageOne = await state(workPeriodId);
				expect(afterStageOne).toMatchObject({ decisions: "1", invocations: "1" });
				expect(afterStageOne.requests.split(",").slice(-2)).toEqual(["approved", "pending"]);
				const second = await pendingRequest(workPeriodId);
				expect(second.approver_id).toBe(ids.admin);

				// The stage-one card cannot decide the next stage.
				const reused = await press(card);
				expect(only(reused.answers).body).toMatchObject({ text: "Review required" });
				expect(await state(workPeriodId)).toEqual(afterStageOne);

				const finalCard = await sendCard(second.id, "admin");
				const { rows: binding } = await admin.query(
					"select legacy_approval_request_id from approval_review_binding where id = $1",
					[bindingOf(finalCard.callbackData[0])],
				);
				expect(only(binding)).toEqual({ legacy_approval_request_id: second.id });
				await press(finalCard);
				const final = await state(workPeriodId);
				expect(final).toMatchObject({ period: "approved", decisions: "2", invocations: "2" });
				const { rows: outcomes } = await admin.query(
					`select d.request_outcome, d.legacy_chain_stage_id is not null as chain_stage
				 from approval_decision_evidence d
				 join approval_submitted_revision r on r.id = d.submitted_revision_id
				 where r.source_id = $1 and d.operation_kind = 'command' order by d.decided_at`,
					[workPeriodId],
				);
				expect(outcomes).toEqual([
					{ request_outcome: "pending", chain_stage: true },
					{ request_outcome: "approved", chain_stage: true },
				]);
			},
		);

		it.each(["shadow", "ready"] as const)(
			"walks a %s-mode chain stage by stage under legacy authority",
			async (mode) => {
				await seed({ mode, twoStageChain: true });
				const { workPeriodId, requestId } = await submit("time_correction");
				const first = await press(await sendCard(requestId));
				expect(only(first.edits).body.text).toContain("Approval recorded");
				const second = await pendingRequest(workPeriodId);
				expect(second.approver_id).toBe(ids.admin);
				await press(await sendCard(second.id, "admin"));
				expect(await state(workPeriodId)).toMatchObject({
					period: "approved",
					decisions: "2",
					invocations: "2",
				});
			},
		);

		it("reports legacy time readiness through the legacy card's own gates", async () => {
			await seed({ capture: false });
			// Submitted before capture: no legacy revision, held once capture is on.
			await submit("manual_time_submission");
			await admin.query(
				`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 select $1, kind, 'capture' from unnest($2::approval_workflow_type[]) as kind`,
				[ids.organization, TIME_KINDS],
			);
			await submit("manual_time_submission");
			const changed = await submit("policy_clock_out");
			await admin.query(
				"update work_period set end_time = end_time + interval '1 minute' where id = $1",
				[changed.workPeriodId],
			);
			await submit("time_correction");
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider)
			 values ($1, 'manual_time_submission', 'telegram')`,
				[ids.organization],
			);
			// After activation: its intent makes the owner card it.
			await submit("manual_time_submission");

			const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

			const kind = (workflowType: TimeKind) =>
				report.kinds.find((entry) => entry.workflowType === workflowType);
			const combination = (workflowType: TimeKind, provider: string) =>
				report.combinations.find(
					(entry) => entry.workflowType === workflowType && entry.provider === provider,
				);
			expect(kind("manual_time_submission")).toMatchObject({
				authority: "legacy",
				pending: { total: 3, current: 2, notCaptured: 1 },
			});
			expect(kind("policy_clock_out")).toMatchObject({
				pending: { total: 1, materialChange: 1 },
			});
			expect(kind("time_correction")).toMatchObject({ pending: { total: 1, current: 1 } });
			// The captured cycle submitted before activation gets no card; the
			// uncaptured one is held as evidence instead.
			expect(combination("manual_time_submission", "telegram")?.findings).toEqual([
				{ code: "evidence_held", severity: "hold", count: 1 },
				{ code: "in_flight_before_activation", severity: "hold", count: 1 },
			]);
			expect(combination("time_correction", "telegram")?.findings).toEqual([
				{ code: "in_flight_before_activation", severity: "hold", count: 1 },
			]);
			expect(combination("time_correction", "teams")?.findings).toEqual([
				{ code: "combination_unverified", severity: "blocker" },
				{ code: "provider_not_configured", severity: "blocker" },
			]);

			// Legacy transfers get no replacement card (#408).
			await admin.query(
				`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, now())`,
				[ids.organization],
			);
			await admin.query(
				`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t432"}'::jsonb)`,
				[ids.organization],
			);
			const escalated = await assessApprovalPilotReadiness({ organizationId: ids.organization });
			expect(
				escalated.combinations.find(
					(entry) => entry.workflowType === "time_correction" && entry.provider === "telegram",
				)?.findings,
			).toContainEqual({ code: "escalation_replacement_unsupported", severity: "hold" });
		});

		it("decides nothing for stale, changed, foreign, reassigned or paused presses", async () => {
			await seed();

			// A web decision between rendering and the press.
			const raced = await submit("manual_time_submission");
			const racedCard = await sendCard(raced.requestId);
			actAs(ids.managerUser);
			expect((await approveOnWeb(raced.requestId)).success).toBe(true);
			actAs(null);
			const afterWeb = await state(raced.workPeriodId);
			const racedPress = await press(racedCard);
			expect(await state(raced.workPeriodId)).toEqual(afterWeb);
			expect(only(racedPress.answers).body).toMatchObject({ text: "Review required" });

			// An in-place material change after rendering keeps the evidence hold.
			const changed = await submit("policy_clock_out");
			const changedCard = await sendCard(changed.requestId);
			await admin.query(
				"update work_period set end_time = end_time + interval '1 minute' where id = $1",
				[changed.workPeriodId],
			);
			const beforeChange = await state(changed.workPeriodId);
			await press(changedCard);
			expect(await state(changed.workPeriodId)).toEqual(beforeChange);

			// Another recipient pressing the manager's card, and the manager through
			// another organization's bot, decide nothing.
			const foreign = await submit("time_correction");
			const foreignCard = await sendCard(foreign.requestId);
			const pending = await state(foreign.workPeriodId);
			await press(foreignCard, { as: "backup" });
			await press(foreignCard, { botConfig: bot(ids.otherOrganization, OTHER_BOT_TOKEN) });
			expect(await state(foreign.workPeriodId)).toEqual(pending);

			// Reassigned: the former holder stays an eligible manager of the
			// requester, and organization management could decide on the web, but a
			// card reaches neither authority.
			await admin.query("update approval_request set approver_id = $2 where id = $1", [
				foreign.requestId,
				ids.backup,
			]);
			await press(foreignCard);
			expect(await state(foreign.workPeriodId)).toEqual(pending);
			await admin.query("update approval_request set approver_id = $2 where id = $1", [
				foreign.requestId,
				ids.manager,
			]);
			const managed = await submit("manual_time_submission");
			await admin.query("update approval_request set approver_id = $2 where id = $1", [
				managed.requestId,
				ids.admin,
			]);
			const adminCard = await sendCard(managed.requestId, "admin");
			await admin.query("update approval_request set approver_id = $2 where id = $1", [
				managed.requestId,
				ids.third,
			]);
			const managedPending = await state(managed.workPeriodId);
			await press(adminCard);
			expect(await state(managed.workPeriodId)).toEqual(managedPending);

			// Pausing the provider stops fresh presses on sent cards; a committed
			// press still replays.
			const committed = await submit("manual_time_submission");
			const committedCard = await sendCard(committed.requestId);
			await press(committedCard, { queryId: "t432-before-pause" });
			const committedState = await state(committed.workPeriodId);
			expect(committedState).toMatchObject({ period: "approved", invocations: "1" });
			await setPresentation("telegram", "review_only");
			const paused = await press(foreignCard);
			expect(await state(foreign.workPeriodId)).toEqual(pending);
			expect(only(paused.edits).body.text).toContain("No decision was made");
			const replay = await press(committedCard, { queryId: "t432-before-pause" });
			expect(await state(committed.workPeriodId)).toEqual(committedState);
			expect(only(replay.edits).body.text).toContain("original result");

			// The same card decides once the provider is admitted again.
			await setPresentation("telegram", "actionable");
			await press(foreignCard);
			expect(await state(foreign.workPeriodId)).toMatchObject({ invocations: "1" });
			expect((await state(foreign.workPeriodId)).requests).toBe("approved");
		});

		it("never decides under the other authority after a cutover between render and press", async () => {
			// legacy → canonical
			await seed();
			const legacy = await submit("time_correction");
			const legacyCard = await sendCard(legacy.requestId);
			const before = await state(legacy.workPeriodId);
			await setMode("canonical");
			const toCanonical = await press(legacyCard);
			expect(await state(legacy.workPeriodId)).toEqual(before);
			expect(only(toCanonical.answers).body).toMatchObject({ text: "Review required" });

			// canonical → legacy: a canonical binding decides nothing under legacy authority.
			await seed({ mode: "canonical" });
			const canonical = await submit("manual_time_submission");
			const canonicalCard = await sendCard(canonical.requestId);
			const { rows } = await admin.query(
				"select authority from approval_review_binding where id = $1",
				[bindingOf(canonicalCard.callbackData[0])],
			);
			expect(only(rows)).toEqual({ authority: "canonical" });
			const pendingCanonical = await state(canonical.workPeriodId);
			await setMode("legacy");
			await press(canonicalCard);
			expect(await state(canonical.workPeriodId)).toEqual(pendingCanonical);
		});

		it("rolls back the whole decision when the invocation cannot be written, and serializes concurrent deliveries", async () => {
			await seed();
			const { workPeriodId, requestId } = await submit("time_correction");
			const card = await sendCard(requestId);
			const before = await state(workPeriodId);
			await admin.query(`
			create or replace function t432_fail_invocation() returns trigger language plpgsql as $$
			begin
				if new.invocation_id = 't432-fail' then
					raise exception 't432 injected invocation failure';
				end if;
				return new;
			end;
			$$;
			create trigger t432_fail_invocation before insert on approval_invocation
			for each row execute function t432_fail_invocation();
		`);
			const update = { queryId: "t432-fail", updateId: 7001 };
			try {
				const failed = await press(card, update);
				// Legacy request, correction, evidence and invocation roll back together.
				expect(await state(workPeriodId)).toEqual(before);
				expect(failed.edits).toEqual([]);
			} finally {
				await admin.query("drop function if exists t432_fail_invocation() cascade");
			}
			// Nothing committed: three concurrent redeliveries decide exactly once.
			const start = calls.length;
			await Promise.all([press(card, update), press(card, update), press(card, update)]);
			expect(await state(workPeriodId)).toMatchObject({
				requests: "approved",
				decisions: "1",
				invocations: "1",
			});
			const texts = calls
				.slice(start)
				.filter((call) => call.method === "editMessageText")
				.map((call) => String(call.body.text));
			expect(texts).toHaveLength(3);
			expect(texts.filter((text) => text.includes("original result"))).toHaveLength(2);
		});

		describe("with escalation (#439)", () => {
			function escalateAt(from: Date, plusMinutes: number) {
				return processDueEscalations({
					organizationId: ids.organization,
					now: parseInstant(new Date(from.getTime() + plusMinutes * 60_000).toISOString()),
				});
			}

			it.each(TIME_KINDS)(
				"refuses the former holder's %s card after a transfer; only the new holder's card decides",
				async (kind) => {
					await seed({ escalation: true });
					const { workPeriodId, requestId } = await submit(kind);
					const formerCard = await sendCard(requestId);
					const request = await pendingRequest(workPeriodId);
					expect(await escalateAt(request.created_at, 60)).toMatchObject({ transferred: 1 });
					expect((await pendingRequest(workPeriodId)).approver_id).toBe(ids.backup);
					const transferred = await state(workPeriodId);

					// The former holder is still an eligible manager of the requester.
					const former = await press(formerCard);
					expect(only(former.answers).body).toMatchObject({ text: "Review required" });
					// An eligible non-holder pressing that card decides nothing either.
					await press(formerCard, { as: "third" });
					expect(await state(workPeriodId)).toEqual(transferred);

					const replacement = await sendCard(requestId, "backup");
					const decided = await press(replacement);
					expect(only(decided.answers).body).toMatchObject({ text: "Request approved" });
					expect(await state(workPeriodId)).toMatchObject({
						period: "approved",
						decisions: "1",
						invocations: "1",
					});
					const { rows } = await admin.query(
						"select actor_employee_id from approval_invocation where legacy_approval_request_id = $1",
						[requestId],
					);
					expect(only(rows)).toEqual({ actor_employee_id: ids.backup });
				},
			);

			it("serializes a card press behind an in-flight transfer and then refuses it", async () => {
				await seed({ escalation: true });
				const { workPeriodId, requestId } = await submit("manual_time_submission");
				const card = await sendCard(requestId);

				// Play the transfer's transaction by hand and keep its row lock open.
				const transferring = await admin.connect();
				let pressSettled = false;
				try {
					await transferring.query("begin");
					await transferring.query("select id from approval_request where id = $1 for update", [
						requestId,
					]);
					await transferring.query("update approval_request set approver_id = $2 where id = $1", [
						requestId,
						ids.backup,
					]);
					await transferring.query(
						`insert into approval_escalation_transfer
					 (organization_id, operation_key, initiator, authority_mode, workflow_type,
					  legacy_approval_request_id, legacy_source_sequence,
					  source_approver_employee_id, replacement_approver_employee_id, requester_employee_id,
					  receipt_idempotency_key, receipt_actor_fingerprint, receipt_command_fingerprint,
					  request_fingerprint, actor_kind, actor_user_id, actor_employee_id, transferred_at)
					 values ($1, 't432-in-flight', 'human', 'legacy', 'manual_time_submission', $2, 0,
					  $3, $4, $5, 't432-in-flight', 'v1', 'v1', 'v1', 'user', $6, $7, now())`,
						[
							ids.organization,
							requestId,
							ids.manager,
							ids.backup,
							ids.requester,
							ids.adminUser,
							ids.admin,
						],
					);

					const pressing = press(card).finally(() => {
						pressSettled = true;
					});
					await new Promise((resolve) => setTimeout(resolve, 300));
					// The press waits on the transfer instead of deciding around it.
					expect(pressSettled).toBe(false);

					await transferring.query("commit");
					const refused = await pressing;
					expect(only(refused.answers).body).toMatchObject({ text: "Review required" });
				} finally {
					await transferring.query("rollback").catch(() => undefined);
					transferring.release();
				}
				expect(await state(workPeriodId)).toMatchObject({ requests: "pending", invocations: "0" });
				expect((await pendingRequest(workPeriodId)).approver_id).toBe(ids.backup);
			});
		});

		describe("cycle-keyed legacy delivery", () => {
			it("records nothing without a delivery control and keeps the existing path", async () => {
				await seed();
				const { workPeriodId, requestId } = await submit("manual_time_submission");
				expect(await intents()).toEqual([]);
				expect(await oldPathNotification("work_period", workPeriodId)).toHaveLength(1);
				expect(await oldPathNotification("approval_request", requestId)).toHaveLength(1);
			});

			it.each(TIME_KINDS)(
				"delivers a %s cycle's card through the owner, silences the old path and refreshes after a press",
				async (kind) => {
					await seed({ delivery: true });
					const { workPeriodId, requestId } = await submit(kind);
					expect(await intents()).toEqual([
						{
							event: "submitted",
							workflow_type: kind,
							source_id: workPeriodId,
							legacy_approval_request_id: requestId,
							legacy_cycle_id: requestId,
						},
					]);
					// The owner delivers this cycle: the old path sends neither card nor message.
					expect(await oldPathNotification("work_period", workPeriodId)).toEqual([]);
					expect(await oldPathNotification("approval_request", requestId)).toEqual([]);

					const initial = await runOwner();
					const sent = only(initial.sent);
					expect(sent.chatId).toBe(TELEGRAM.manager.chat);
					expect(sent.text).toContain(TITLES[kind]);
					expect(sent.buttons.map((button) => button.text)).toEqual([
						"Approve",
						"Reject",
						"Review in Z8",
					]);
					expect(only(await messages(workPeriodId))).toMatchObject({
						recipient_employee_id: ids.manager,
						legacy_approval_request_id: requestId,
						legacy_cycle_id: requestId,
						workflow_type: kind,
						binding_id: bindingOf(sent.callbackData[0]),
						controls: "actionable",
						state: "current",
						status_version: 1,
					});
					// A second pass sends nothing new.
					expect((await runOwner()).sent).toEqual([]);

					harness.kicks.length = 0;
					const pressed = await press(await deliveredCard(sent));
					// The webhook acknowledges; the decided card has one writer, the owner.
					expect(pressed.edits).toEqual([]);
					expect(only(pressed.answers).body).toMatchObject({ text: "Request approved" });
					expect(harness.kicks).toContainEqual(
						expect.objectContaining({ organizationId: ids.organization }),
					);
					expect((await intents()).map((row) => row.event)).toEqual(["submitted", "decided"]);
					const refreshed = await runOwner();
					const edit = only(refreshed.edits);
					expect(edit.body.text).toContain("Request approved");
					expect(JSON.stringify(edit.body.reply_markup ?? {})).not.toContain("callback_data");
					expect(await messages(workPeriodId)).toMatchObject([
						{ controls: "none", state: "retired", status_version: 2 },
					]);
					expect((await runOwner()).edits).toEqual([]);
				},
			);

			it.each(["shadow", "ready"] as const)(
				"delivers, decides and refreshes a %s-mode card under legacy authority",
				async (mode) => {
					await seed({ mode, delivery: true });
					const { workPeriodId, requestId } = await submit("time_correction");
					const sent = only((await runOwner()).sent);
					expect(only(await messages(workPeriodId))).toMatchObject({
						legacy_cycle_id: requestId,
						binding_id: bindingOf(sent.callbackData[0]),
					});
					const pressed = await press(await deliveredCard(sent), { action: "reject" });
					expect(only(pressed.answers).body).toMatchObject({ text: "Request rejected" });
					expect(await state(workPeriodId)).toMatchObject({ decisions: "1", invocations: "1" });
					const refreshed = await runOwner();
					expect(only(refreshed.edits).body.text).toContain("Request rejected");
					expect(await messages(workPeriodId)).toMatchObject([
						{ controls: "none", state: "retired", status_version: 2 },
					]);
				},
			);

			it("refreshes owner-delivered cards after web decisions and walks a chain stage by stage", async () => {
				await seed({ delivery: true, twoStageChain: true });
				const { workPeriodId, requestId } = await submit("manual_time_submission");
				const first = only((await runOwner()).sent);
				expect(first.chatId).toBe(TELEGRAM.manager.chat);

				// Stage one on the web: the stage-one card refreshes and the final
				// approver gets the next stage's own card, in the same cycle.
				actAs(ids.managerUser);
				expect((await approveOnWeb(requestId)).success).toBe(true);
				actAs(null);
				const afterStageOne = await runOwner();
				expect(only(afterStageOne.edits).body.text).toContain("Approval recorded");
				const second = only(afterStageOne.sent);
				expect(second.chatId).toBe(TELEGRAM.admin.chat);
				const { rows: chains } = await admin.query<{ id: string }>(
					"select id from approval_chain_instance where entity_id = $1",
					[workPeriodId],
				);
				const chainId = only(chains).id;
				expect((await messages(workPeriodId)).map((row) => row.legacy_cycle_id)).toEqual([
					chainId,
					chainId,
				]);

				// Stage two rejected on the web: both cards reach the final status.
				const stage = await pendingRequest(workPeriodId);
				actAs(ids.adminUser);
				expect((await rejectOnWeb(stage.id, "Not this week")).success).toBe(true);
				actAs(null);
				const final = await runOwner();
				const texts = Object.fromEntries(
					final.edits.map((call) => [String(call.body.chat_id), String(call.body.text)]),
				);
				expect(Object.keys(texts).sort()).toEqual(
					[String(TELEGRAM.manager.chat), String(TELEGRAM.admin.chat)].sort(),
				);
				expect(texts[String(TELEGRAM.manager.chat)]).toContain("Approval recorded");
				expect(texts[String(TELEGRAM.admin.chat)]).toContain("Request rejected");
				expect((await messages(workPeriodId)).map((row) => row.status_version)).toEqual([3, 3]);
			});

			it("delivers, versions and refreshes two cycles on one work period independently", async () => {
				await seed({ delivery: true });
				// Cycle one: the manual submission, approved by card.
				const date = dayOf(day);
				const manual = await submit("manual_time_submission");
				const submitted = only((await runOwner()).sent);
				await press(await deliveredCard(submitted));
				expect(only((await runOwner()).edits).body.text).toContain("Request approved");

				// Cycle two: a correction of the same period, with its own cycle.
				await requestEdit(manual.workPeriodId, date);
				const correction = await pendingRequest(manual.workPeriodId);
				const correctionRun = await runOwner();
				const correctionCard = only(correctionRun.sent);
				expect(correctionCard.text).toContain(TITLES.time_correction);
				// The first cycle's retired card is untouched.
				expect(correctionRun.edits).toEqual([]);
				expect((await intents()).map((row) => [row.event, row.legacy_cycle_id])).toEqual([
					["submitted", manual.requestId],
					["decided", manual.requestId],
					["submitted", correction.id],
				]);

				// Deciding the second cycle refreshes only its card.
				await press(await deliveredCard(correctionCard), { action: "reject" });
				const refreshed = await runOwner();
				expect(only(refreshed.edits).body.text).toContain("Request rejected");
				const versions = Object.fromEntries(
					(await messages(manual.workPeriodId)).map((row) => [
						row.legacy_cycle_id,
						row.status_version,
					]),
				);
				expect(versions).toEqual({ [manual.requestId]: 2, [correction.id]: 2 });
				expect((await runOwner()).edits).toEqual([]);

				// Privileged cleanup purges exactly the correction cycle.
				const deleted = await deleteApproval(db as never, ids.organization, correction.id);
				expect(deleted.legacyRequests).toEqual([correction.id]);
				expect(deleted.delivery.messages).toHaveLength(1);
				expect(deleted.delivery.intents).toHaveLength(2);
				expect((await messages(manual.workPeriodId)).map((row) => row.legacy_cycle_id)).toEqual([
					manual.requestId,
				]);
				expect((await intents()).map((row) => row.legacy_cycle_id)).toEqual([
					manual.requestId,
					manual.requestId,
				]);
			});

			// Shadow and ready cancellation works since #463.
			it.each(MODES)("withdraws a cancelled correction cycle's cards in %s mode and keeps its history until privileged cleanup", async (mode) => {
				await seed({ mode, delivery: true });
				const { workPeriodId, requestId } = await submit("time_correction");
				const sent = only((await runOwner()).sent);
				const card = await deliveredCard(sent);
				const { rows: revisions } = await admin.query<{ id: string }>(
					"select id from approval_submitted_revision where legacy_approval_request_id = $1",
					[requestId],
				);
				const revisionId = only(revisions).id;

				actAs(ids.requesterUser);
				expect(await cancelMyTimeCorrectionRequest(workPeriodId)).toEqual({ success: true });
				actAs(null);
				expect((await intents()).map((row) => [row.event, row.legacy_cycle_id])).toEqual([
					["submitted", requestId],
					["withdrawn", requestId],
				]);
				const withdrawn = await runOwner();
				expect(only(withdrawn.edits).body.text).toContain("Request withdrawn");
				// Binding, delivery work, message and intents survive ordinary cancellation.
				const survivors = async () => {
					const { rows } = await admin.query<Record<string, number>>(
						`select
					   (select count(*)::int from approval_review_binding where submitted_revision_id = $1) as bindings,
					   (select count(*)::int from approval_delivery_work where legacy_cycle_id = $2) as work,
					   (select count(*)::int from approval_delivery_message where legacy_cycle_id = $2) as messages,
					   (select count(*)::int from approval_delivery_intent where legacy_cycle_id = $2) as intents`,
						[revisionId, requestId],
					);
					return only(rows);
				};
				expect(await survivors()).toEqual({ bindings: 1, work: 2, messages: 1, intents: 2 });
				// A press on the withdrawn card decides nothing.
				const before = await state(workPeriodId);
				const late = await press(card, { queryId: "t432-withdrawn", updateId: 6101 });
				expect(only(late.answers).body).toMatchObject({ text: "Review required" });
				expect(await state(workPeriodId)).toEqual(before);

				const deleted = await deleteApproval(db as never, ids.organization, requestId);
				expect(deleted.evidence.submittedRevisions).toEqual([revisionId]);
				expect(deleted.evidence.reviewBindings).toHaveLength(1);
				expect(deleted.delivery.work).toHaveLength(2);
				expect(deleted.delivery.messages).toHaveLength(1);
				expect(deleted.delivery.intents).toHaveLength(2);
				expect(await survivors()).toEqual({ bindings: 0, work: 0, messages: 0, intents: 0 });
				// A redelivered press after the purge recreates nothing.
				await press(card, { queryId: "t432-withdrawn", updateId: 6102 });
				expect(await survivors()).toEqual({ bindings: 0, work: 0, messages: 0, intents: 0 });
				const { rows: invocations } = await admin.query(
					"select count(*)::int as count from approval_invocation where organization_id = $1",
					[ids.organization],
				);
				expect(only(invocations)).toEqual({ count: 0 });
			});

			it("purges exactly a decided cycle's bindings, invocations and delivery rows and reports them", async () => {
				await seed({ delivery: true });
				const kept = await submit("policy_clock_out");
				const { workPeriodId, requestId } = await submit("policy_clock_out");
				const sent = (await runOwner()).sent;
				expect(sent).toHaveLength(2);
				const [message] = await messages(workPeriodId);
				const card = sent.find(
					(candidate) => bindingOf(candidate.callbackData[0]) === message?.binding_id,
				);
				if (!card) throw new Error("card not sent");
				const update = { queryId: "t432-purge", updateId: 6201 };
				await press(await deliveredCard(card), update);
				await runOwner();
				const { rows: invocations } = await admin.query<{ id: string }>(
					"select id from approval_invocation where legacy_approval_request_id = $1",
					[requestId],
				);
				const deleted = await deleteApproval(db as never, ids.organization, requestId);
				expect(deleted.legacyRequests).toEqual([requestId]);
				expect(deleted.evidence.invocations).toEqual([only(invocations).id]);
				expect(deleted.evidence.reviewBindings).toEqual([message?.binding_id]);
				expect(deleted.delivery.messages).toEqual([message?.id]);
				expect(deleted.delivery.intents).toHaveLength(2);
				expect(await messages(workPeriodId)).toEqual([]);
				// The other cycle and the business record are preserved.
				expect(await messages(kept.workPeriodId)).toHaveLength(1);
				expect((await state(workPeriodId)).period).toBe("approved");
				// A late redelivery of the purged press recreates nothing.
				await press({ callbackData: card.callbackData, messageId: 1, approver: "manager" }, update);
				const { rows: after } = await admin.query(
					"select count(*)::int as count from approval_invocation where legacy_approval_request_id = $1",
					[requestId],
				);
				expect(only(after)).toEqual({ count: 0 });
			});
		});
	},
);
