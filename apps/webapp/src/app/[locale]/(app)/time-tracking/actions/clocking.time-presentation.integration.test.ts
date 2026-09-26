/**
 * #325 / T60 runtime evidence: canonical manual time submissions, policy
 * clock-outs and time corrections are presented from their immutable submitted
 * revision, decided through reviewed bindings, and reviewed with their exact
 * committed results.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real submission actions (`clockIn`/`clockOut`, `createManualTimeEntry`,
 * `requestTimeCorrection`, `requestTimeEntryDeletion`) run against that
 * database. The real approval delivery owner prepares and sends the card, the
 * real Telegram webhook handler decides it through the shared bot attempt and
 * the existing work-period and correction decision owners, the owner refreshes
 * the delivered card, and the real inbox detail renders the review. Only the
 * request/session, billing, notification fan-out, the Next cache, the bot
 * token vault, the delivery fast path and the Telegram HTTP transport (fetch)
 * are replaced. Live clock-outs never route approval (#361), so a policy
 * clock-out is a historical one seeded through the real ordinary submission.
 * Manual and correction approval depend on the change policy, so those
 * decisions are forced as in the #302 and #301 suites. Every control row is
 * inserted directly: production has no setter.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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
							session: { activeOrganizationId: harness.organizationId },
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
	getOrganizationBaseUrl: async () => "https://t325.example.test",
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

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

vi.mock("./policy-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("./policy-helpers")>();
	return {
		...original,
		getEditCapabilityForPeriod: async () => ({ type: "approval_required" as const }),
	};
});

vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
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

const BOT_TOKEN = "325325325:AAT325-time_presentation_test";

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async () => "325325325:AAT325-time_presentation_test",
}));

// The best-effort fast path only runs the owner sooner; each test runs it explicitly.
vi.mock("@/lib/approvals/delivery/kick", () => ({ kickApprovalDelivery: () => undefined }));

const { clockIn, clockOut } = await import("./clocking");
const { createManualTimeEntry } = await import("../actions");
const { requestTimeCorrection, requestTimeEntryDeletion } = await import("./corrections");
await import("@/lib/approvals/init");
const { approveApprovalInboxItem } = await import("@/lib/approvals/inbox/decision-service");
const { getApprovalInboxDetail } = await import("@/lib/approvals/inbox/read-service");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { prepareApprovalPresentation } = await import("@/lib/approvals/presentation");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { sendTelegramNotification } = await import("@/lib/notifications/telegram-channel");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { submitHistoricalPolicyClockOut } = await import(
	"@/lib/time-tracking/__tests__/historical-policy-clock-out"
);
const { workPeriodReceiptKeyDigest } = await import(
	"@/lib/approvals/evidence/work-period-evidence"
);
const { db } = await import("@/db");

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
	describe.skip(`time approval presentation PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const TIME_KINDS = ["policy_clock_out", "manual_time_submission", "time_correction"] as const;
const MANAGER_TELEGRAM_ID = 32_501;
const MANAGER_CHAT_ID = 325_555;
// Pinned pass time. New work becomes due at the database's now(), so the
// pinned clock must lie after the real time the test runs at.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t325-time-presentation-org",
	requesterUser: "t325-requester-user",
	managerUser: "t325-manager-user",
	finalUser: "t325-final-user",
	requester: "e3250000-0000-4000-8000-000000000001",
	manager: "e3250000-0000-4000-8000-000000000002",
	finalApprover: "e3250000-0000-4000-8000-000000000003",
	approvalPolicy: "e3254000-0000-4000-8000-000000000001",
	firstStage: "e3254000-0000-4000-8000-000000000002",
	secondStage: "e3254000-0000-4000-8000-000000000003",
	managerLink: "e3251000-0000-4000-8000-000000000001",
	policy: "e3252000-0000-4000-8000-000000000001",
	regulation: "e3252000-0000-4000-8000-000000000002",
	breakRule: "e3252000-0000-4000-8000-000000000003",
	policyAssignment: "e3252000-0000-4000-8000-000000000004",
	changePolicy: "e3252000-0000-4000-8000-000000000005",
	changePolicyAssignment: "e3252000-0000-4000-8000-000000000006",
	category: "e3253000-0000-4000-8000-000000000001",
} as const;

interface TelegramCall {
	method: string;
	body: Record<string, unknown>;
	/** The message ID Telegram "assigned" to a sent message. */
	messageId?: number;
}

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("time approval presentation, bound decisions and review (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 32_500;
	const originalFetch = globalThis.fetch;

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	/** The Telegram Bot API transport; everything above it is real. */
	function installTelegramTransport() {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const match = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
			if (!match) throw new Error(`Unexpected fetch in test: ${url}`);
			const method = match[1] ?? "";
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
			const messageId = method === "sendMessage" ? nextMessageId++ : undefined;
			calls.push({ method, body, ...(messageId === undefined ? {} : { messageId }) });
			const result =
				method === "sendMessage"
					? {
							message_id: messageId,
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

	const sends = () => calls.filter((call) => call.method === "sendMessage");
	const edits = () => calls.filter((call) => call.method === "editMessageText");
	const answers = () => calls.filter((call) => call.method === "answerCallbackQuery");
	const buttonsOf = (call: TelegramCall) =>
		(
			call.body.reply_markup as {
				inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
			}
		).inline_keyboard.flat();
	const actionData = (call: TelegramCall, action: "ba" | "br") =>
		buttonsOf(call).find((button) => button.callback_data?.includes(`"${action}"`))
			?.callback_data ?? "";
	const bindingOf = (call: TelegramCall) =>
		(JSON.parse(actionData(call, "ba") || "{}") as { b?: string }).b ?? null;

	function botConfig() {
		return {
			organizationId: ids.organization,
			botToken: BOT_TOKEN,
			botUsername: "t325_bot",
			webhookSecret: "t325-secret",
			setupStatus: "active",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: false,
			enableEscalations: false,
			digestTime: "09:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		};
	}

	let nextUpdateId = 325_000;
	async function press(card: TelegramCall, action: "ba" | "br", queryId: string) {
		const before = calls.length;
		const messageId = card.messageId;
		if (messageId === undefined) throw new Error("not a sent card");
		await handleTelegramUpdate(
			{
				update_id: nextUpdateId++,
				callback_query: {
					id: queryId,
					from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Morgan" },
					message: {
						message_id: messageId,
						date: 1_790_000_000,
						chat: { id: MANAGER_CHAT_ID, type: "private" as const },
					},
					data: actionData(card, action),
				},
			},
			botConfig(),
		);
		// Concurrent presses share the call log; each press is acknowledged once.
		const after = calls.slice(before);
		const answer = after.find((call) => call.method === "answerCallbackQuery");
		if (!answer) throw new Error("press was not acknowledged");
		return { answer, edits: after.filter((call) => call.method === "editMessageText") };
	}

	let passMinutes = 0;
	function deliver() {
		passMinutes += 1;
		return processApprovalDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: passMinutes }),
		});
	}

	async function cleanup() {
		await admin.query("drop function if exists t325_fail() cascade");
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.finalUser],
		]);
	}

	async function seed(
		options: {
			rollout?: "canonical" | "legacy";
			capture?: boolean;
			presentation?: "actionable" | "review_only" | null;
		} = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T325 time', $1, $2)`,
			[ids.organization, timestamp],
		);
		for (const kind of TIME_KINDS) {
			const rollout = options.rollout ?? "canonical";
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, $2, $3, $4, $5, $5)`,
				[ids.organization, kind, rollout, rollout, timestamp],
			);
			if (options.capture ?? true) {
				await admin.query(
					`insert into approval_evidence_control (organization_id, workflow_type, mode)
					 values ($1, $2, 'capture')`,
					[ids.organization, kind],
				);
			}
			const presentation = options.presentation === undefined ? "actionable" : options.presentation;
			if (presentation) {
				await admin.query(
					`insert into approval_presentation_control
					 (organization_id, workflow_type, provider, mode) values ($1, $2, 'telegram', $3)`,
					[ids.organization, kind, presentation],
				);
			}
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, $2, 'telegram', $3)`,
				[ids.organization, kind, timestamp],
			);
		}
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't325-requester@example.test', $3, $3),
			 ($2, 'Morgan Manager', 't325-manager@example.test', $3, $3)`,
			[ids.requesterUser, ids.managerUser, timestamp],
		);
		// The requester works in UTC; the recipient reads in English, Berlin, 24h.
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at) values
			 ($1, 'en', 'UTC', '24h', $3), ($2, 'en', 'Europe/Berlin', '24h', $3)`,
			[ids.requesterUser, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't325-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.requesterUser, ids.managerUser]],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'manager', $6)`,
			[ids.requester, ids.requesterUser, ids.manager, ids.managerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[ids.managerLink, ids.requester, ids.manager, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
			[ids.organization],
		);
		// Manual entries of any past day need approval, through the real change policy.
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T325 manual approval', 0, 3650, $3, $4)`,
			[ids.changePolicy, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, $5)`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't325_bot', 't325-secret', 'active', true, false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into telegram_user_mapping
			 (user_id, organization_id, telegram_user_id, is_active, updated_at)
			 values ($1, $2, $3, true, $4)`,
			[ids.managerUser, ids.organization, String(MANAGER_TELEGRAM_ID), timestamp],
		);
		await admin.query(
			`insert into telegram_conversation
			 (organization_id, user_id, chat_id, chat_type, is_active, updated_at)
			 values ($1, $2, $3, 'private', true, $4)`,
			[ids.organization, ids.managerUser, String(MANAGER_CHAT_ID), timestamp],
		);
	}

	/** Direct manager, then a named final approver (who decides on the web). */
	async function seedTwoStages() {
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Frankie Final', 't325-final@example.test', $2, $2)`,
			[ids.finalUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t325-member-final', $1, $2, 'admin', 'approved', $3)`,
			[ids.organization, ids.finalUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, 'admin', $4)`,
			[ids.finalApprover, ids.finalUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, $2, 'T325 two stages', true, 1, $3, $4)`,
			[ids.approvalPolicy, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into approval_policy_stage
			 (id, organization_id, policy_id, step_order, label, approver_type,
			  approver_employee_id, fallback_behavior, updated_at) values
			 ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', $6),
			 ($2, $3, $4, 2, 'Final', 'specific_employee', $5, 'fail', $6)`,
			[
				ids.firstStage,
				ids.secondStage,
				ids.organization,
				ids.approvalPolicy,
				ids.finalApprover,
				timestamp,
			],
		);
	}

	async function seedBreakPolicy() {
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled, is_active, created_by, updated_at)
			 values ($1, $2, 'T325 break', false, true, true, $3, $4)`,
			[ids.policy, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into work_policy_regulation (id, policy_id, max_uninterrupted_minutes, updated_at)
			 values ($1, $2, 360, $3)`,
			[ids.regulation, ids.policy, timestamp],
		);
		await admin.query(
			`insert into work_policy_break_rule
			 (id, regulation_id, working_minutes_threshold, required_break_minutes, updated_at)
			 values ($1, $2, 360, 30, $3)`,
			[ids.breakRule, ids.regulation, timestamp],
		);
		await admin.query(
			`insert into work_policy_assignment
			 (id, policy_id, organization_id, assignment_type, employee_id, priority, is_active, created_by, updated_at)
			 values ($1, $2, $3, 'employee', $4, 2, true, $5, $6)`,
			[
				ids.policyAssignment,
				ids.policy,
				ids.organization,
				ids.requester,
				ids.managerUser,
				timestamp,
			],
		);
	}

	/**
	 * Real clock-in and clock-out; with approval it is then submitted as a historical
	 * policy clock-out. A break policy takes effect only after the clock-out, so its
	 * break is still owed at approval.
	 */
	async function recordWork(
		start: Instant,
		end: Instant,
		options: { approval: boolean; breakPolicy?: boolean },
	) {
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
		harness.userId = null;
		const { rows } = await admin.query<{ id: string; clock_in_id: string; clock_out_id: string }>(
			`select id, clock_in_id, clock_out_id from work_period
			 where employee_id = $1 and start_time = $2 and deleted_at is null`,
			[ids.requester, new Date(start.epochMilliseconds)],
		);
		const work = only(rows);
		if (options.breakPolicy) await seedBreakPolicy();
		if (options.approval) {
			await submitHistoricalPolicyClockOut({
				organizationId: ids.organization,
				employeeId: ids.requester,
				userId: ids.requesterUser,
				workPeriodId: work.id,
			});
		}
		return work;
	}

	/** The pending compatibility request and canonical workflow of a period's cycle. */
	async function pendingCycle(workPeriodId: string, kind: (typeof TIME_KINDS)[number]) {
		const { rows } = await admin.query<{ request_id: string; workflow_id: string }>(
			`select r.id as request_id, s.workflow_id
			 from approval_request r
			 join approval_workflow_stage s on s.legacy_approval_request_id = r.id
			 join approval_workflow w on w.id = s.workflow_id
			 where r.organization_id = $1 and r.entity_type = 'time_entry' and r.entity_id = $2
			   and r.status = 'pending' and w.workflow_type = $3`,
			[ids.organization, workPeriodId, kind],
		);
		return only(rows);
	}

	/** A manual entry of 09:00-17:30 in the Berlin browser zone (continued once). */
	async function submitManual(date = "2026-07-20", submissionId = randomUUID()) {
		actAs(ids.requesterUser);
		const result = await createManualTimeEntry({
			version: 2,
			submissionId,
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
		harness.userId = null;
		expect(result).toMatchObject({ success: true, data: { requiresApproval: true } });
		return submissionId;
	}

	function requestEdit(
		workPeriodId: string,
		values: { clockIn: string; clockOut: string; workLocationType?: string },
	) {
		actAs(ids.requesterUser);
		return requestTimeCorrection({
			workPeriodId,
			submissionId: randomUUID(),
			newClockInDate: "2026-07-22",
			newClockInTime: values.clockIn,
			newClockOutDate: "2026-07-22",
			newClockOutTime: values.clockOut,
			reason: "Private explanation that stays in review",
			workLocationType: values.workLocationType ?? "office",
			workCategoryId: null,
		});
	}

	async function counts(workflowId: string) {
		const { rows } = await admin.query<Record<string, string>>(
			`select
			   (select count(*) from approval_decision_evidence where workflow_id = $1) as decisions,
			   (select count(*) from approval_invocation where workflow_id = $1) as invocations,
			   (select count(*) from approval_workflow_command where workflow_id = $1) as receipts,
			   (select version from approval_workflow where id = $1) as version,
			   (select status from approval_workflow where id = $1) as status`,
			[workflowId],
		);
		return only(rows);
	}

	async function reviewSections(requestId: string) {
		const detail = await getApprovalInboxDetail({
			approvalId: requestId,
			organizationId: ids.organization,
			approverId: ids.manager,
		});
		return detail;
	}

	function keyValue(
		sections: Awaited<ReturnType<typeof reviewSections>>["sections"],
		title: string,
	): Array<[string, unknown]> {
		const section = sections.find(
			(candidate) =>
				candidate.type === "key_value" &&
				(typeof candidate.title === "string" ? candidate.title : candidate.title.fallback) ===
					title,
		);
		if (section?.type !== "key_value") throw new Error(`missing section ${title}`);
		return section.rows.map((row) => [
			typeof row.label === "string" ? row.label : row.label.fallback,
			typeof row.value === "string"
				? row.value
				: "fallback" in row.value
					? row.value.fallback
					: row.value,
		]);
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
			throw new Error("Time approval presentation PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
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

	it("delivers a bound policy clock-out card, decides it by one press and reviews every resulting segment", async () => {
		await seed();
		const start = parseInstant("2026-07-22T08:00:00Z");
		// 7h 0m 40s without a break: approval inserts 30 minutes at 6h.
		const work = await recordWork(start, start.add({ hours: 7, seconds: 40 }), {
			approval: true,
			breakPolicy: true,
		});
		const cycle = await pendingCycle(work.id, "policy_clock_out");

		expect((await deliver()).outcomes).toEqual({ delivered: 1 });
		const card = only(sends());
		const text = String(card.body.text);
		expect(text).toContain("Clock-out approval request");
		expect(text).toContain("Employee: Avery Requester");
		// Each endpoint in its own captured offset; the recipient's zone is not applied.
		expect(text).toContain("Clock in: Jul 22, 2026, 08:00 (UTC+00:00)");
		expect(text).toContain("Clock out: Jul 22, 2026, 15:00 (UTC+00:00)");
		// Stored minutes (421, half up) and UTC elapsed time stay apart.
		expect(text).toContain("Submitted duration: 7 h 1 min");
		expect(text).toContain("Elapsed time: 7 h 0 min 40 s");
		expect(text).toContain("Break adjustment: May apply when approved");
		expect(text).toMatch(/Submitted: .+ \(Europe\/Berlin\)/);
		const bindingId = bindingOf(card);
		const { rows: bindings } = await admin.query(
			`select b.recipient_employee_id, b.workflow_id, a.approver_employee_id, a.status,
			        r.workflow_type, r.source_id
			 from approval_review_binding b
			 join approval_stage_assignment a on a.id = b.assignment_id
			 join approval_submitted_revision r on r.id = b.submitted_revision_id
			 where b.id = $1`,
			[bindingId],
		);
		expect(only(bindings)).toEqual({
			recipient_employee_id: ids.manager,
			workflow_id: cycle.workflow_id,
			approver_employee_id: ids.manager,
			status: "pending",
			workflow_type: "policy_clock_out",
			source_id: work.id,
		});

		const pressed = await press(card, "ba", "t325-policy-1");
		expect(pressed.answer.body).toMatchObject({ text: "Request approved" });
		const decided = await counts(cycle.workflow_id);
		expect(decided).toMatchObject({ decisions: "1", invocations: "1", status: "approved" });
		const { rows: associations } = await admin.query(
			`select i.receipt_idempotency_key, i.reviewed_binding_id, i.action,
			        d.receipt_idempotency_key as evidence_key, d.reviewed_binding_id as evidence_binding,
			        d.assignment_outcome, d.request_outcome, d.actor_employee_id, d.result,
			        c.state as receipt_state
			 from approval_invocation i
			 join approval_decision_evidence d on d.id = i.decision_evidence_id
			 join approval_workflow_command c
			   on c.workflow_id = i.workflow_id and c.idempotency_key = i.receipt_idempotency_key
			 where i.workflow_id = $1`,
			[cycle.workflow_id],
		);
		const association = only(associations);
		expect(association).toMatchObject({
			receipt_idempotency_key:
				"approval-invocation:v1:telegram_callback_query:22:telegram-bot:325325325:13:t325-policy-1",
			reviewed_binding_id: bindingId,
			action: "approve",
			evidence_binding: bindingId,
			assignment_outcome: "approved",
			request_outcome: "approved",
			actor_employee_id: ids.manager,
			receipt_state: "completed",
		});
		// Time-kind evidence keeps only a digest of the receipt key.
		expect(association.evidence_key).toBe(
			workPeriodReceiptKeyDigest(association.receipt_idempotency_key),
		);
		expect(association.result.terminal).toMatchObject({
			adjustment: { kind: "break_enforced", breakMinutes: 30 },
			segments: [{ storedDurationMinutes: 360 }, { storedDurationMinutes: 31 }],
		});

		// The owner retires the card into the committed outcome.
		await deliver();
		const refreshed = only(edits());
		expect(String(refreshed.body.text)).toContain("Request approved");
		expect(String(refreshed.body.text)).toContain("Approved by Morgan Manager");
		expect(buttonsOf(refreshed).every((button) => !button.callback_data)).toBe(true);

		// Authenticated review keeps the submission apart from its results.
		const review = await reviewSections(cycle.request_id);
		expect(keyValue(review.sections, "Submitted times")).toEqual([
			["Employee", "Avery Requester"],
			["Clock in", "2026-07-22 08:00 (UTC+00:00)"],
			["Clock out", "2026-07-22 15:00 (UTC+00:00)"],
			["Submitted duration", "7 h 1 min"],
			["Elapsed time", "7 h 0 min 40 s"],
			["Break adjustment", "May apply when approved; the result is recorded separately"],
		]);
		expect(keyValue(review.sections, "Result")).toEqual([
			["Outcome", "Approved"],
			["Break inserted", "30 min"],
			["Segment 1", "2026-07-22 08:00 (UTC+00:00) – 2026-07-22 14:00 (UTC+00:00) · 6 h 0 min"],
			["Segment 2", "2026-07-22 14:30 (UTC+00:00) – 2026-07-22 15:00 (UTC+00:00) · 0 h 31 min"],
		]);

		// Redelivery of the same query replays the original result, writing nothing.
		const replay = await press(card, "ba", "t325-policy-1");
		expect(replay.answer.body).toMatchObject({ text: "Request approved" });
		expect(await counts(cycle.workflow_id)).toEqual(decided);
		// The same query with another command conflicts; a new query decides nothing.
		await press(card, "br", "t325-policy-1");
		await press(card, "ba", "t325-policy-2");
		expect(await counts(cycle.workflow_id)).toEqual(decided);
	});

	it("rejects a manual submission by one press; the card never invents a before state", async () => {
		await seed();
		const manualId = await submitManual();
		const cycle = await pendingCycle(manualId, "manual_time_submission");

		await deliver();
		const card = only(sends());
		const text = String(card.body.text);
		expect(text).toContain("Manual time approval request");
		// Berlin summer time as entered, each endpoint with its own capture.
		expect(text).toContain("Clock in: Jul 20, 2026, 09:00 (UTC+02:00)");
		expect(text).toContain("Clock out: Jul 20, 2026, 17:30 (UTC+02:00)");
		expect(text).toContain("Submitted duration: 8 h 30 min");
		expect(text).not.toContain("Break adjustment");
		expect(text).not.toContain("Forgot to clock");
		expect(text).not.toMatch(/before/i);

		const pressed = await press(card, "br", "t325-manual-1");
		expect(pressed.answer.body).toMatchObject({ text: "Request rejected" });
		expect(await counts(cycle.workflow_id)).toMatchObject({
			decisions: "1",
			invocations: "1",
			status: "rejected",
		});
		const { rows: periods } = await admin.query<{ approval_status: string }>(
			"select approval_status from work_period where id = $1",
			[manualId],
		);
		expect(only(periods).approval_status).toBe("rejected");
		// The platform reason never enters the evidence.
		const { rows: evidence } = await admin.query(
			"select * from approval_decision_evidence where workflow_id = $1",
			[cycle.workflow_id],
		);
		expect(JSON.stringify(evidence)).not.toContain("Rejected via");

		await deliver();
		expect(String(only(edits()).body.text)).toContain("Request rejected");
		const review = await reviewSections(cycle.request_id);
		expect(keyValue(review.sections, "Submitted times")[1]).toEqual([
			"Clock in",
			"2026-07-20 09:00 (UTC+02:00)",
		]);
		expect(keyValue(review.sections, "Result")).toEqual([
			["Outcome", "Rejected"],
			["Segment 1", "2026-07-20 09:00 (UTC+02:00) – 2026-07-20 17:30 (UTC+02:00) · 8 h 30 min"],
		]);
	});

	it("approves a correction edit by one press and reviews before, requested and result", async () => {
		await seed();
		const work = await recordWork(
			parseInstant("2026-07-22T08:00:00Z"),
			parseInstant("2026-07-22T10:00:00Z"),
			{ approval: false },
		);
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00", workLocationType: "home" }),
		).resolves.toMatchObject({ success: true });
		const cycle = await pendingCycle(work.id, "time_correction");

		await deliver();
		const card = only(sends());
		const text = String(card.body.text);
		expect(text).toContain("Time correction approval request");
		expect(text).toContain("Request: Change times");
		expect(text).toContain(
			"Entry: Jul 22, 2026, 08:00 (UTC+00:00) – Jul 22, 2026, 10:00 (UTC+00:00)",
		);
		expect(text).toContain("Duration before: 2 h 0 min");
		expect(text).toContain(
			"Clock in: Jul 22, 2026, 08:00 (UTC+00:00) → Jul 22, 2026, 08:30 (UTC+00:00)",
		);
		expect(text).not.toContain("Clock out:");
		expect(text).toContain("Work location: Office → Home");
		expect(text).not.toContain("Private explanation");

		const pressed = await press(card, "ba", "t325-correction-1");
		expect(pressed.answer.body).toMatchObject({ text: "Request approved" });
		expect(await counts(cycle.workflow_id)).toMatchObject({
			decisions: "1",
			invocations: "1",
			status: "approved",
		});
		const { rows: periods } = await admin.query<{
			start_time: Date;
			duration_minutes: number;
			work_location_type: string;
		}>("select start_time, duration_minutes, work_location_type from work_period where id = $1", [
			work.id,
		]);
		expect(only(periods)).toMatchObject({ duration_minutes: 90, work_location_type: "home" });

		const review = await reviewSections(cycle.request_id);
		expect(keyValue(review.sections, "Requested correction")).toEqual([
			["Employee", "Avery Requester"],
			["Request", "Change times"],
			["Entry", "2026-07-22 08:00 (UTC+00:00) – 2026-07-22 10:00 (UTC+00:00)"],
			["Duration before", "2 h 0 min"],
			["Clock in", "2026-07-22 08:00 (UTC+00:00) → 2026-07-22 08:30 (UTC+00:00)"],
			[
				"Work location",
				{
					kind: "change",
					original: { kind: "work_location", value: "office" },
					requested: { kind: "work_location", value: "home" },
				},
			],
		]);
		expect(keyValue(review.sections, "Result")).toEqual([
			["Outcome", "Approved"],
			["Entry", "2026-07-22 08:30 (UTC+00:00) – 2026-07-22 10:00 (UTC+00:00)"],
			["Resulting duration", "1 h 30 min"],
		]);
		// The live (UTC clock-time) reconstruction is replaced by the evidence.
		expect(
			review.sections.some(
				(section) =>
					section.type === "key_value" &&
					typeof section.title !== "string" &&
					section.title.key === "approvals:approvals.requestedCorrection",
			),
		).toBe(false);
	});

	it("presents a deletion request and a metadata-only change without inventing working times", async () => {
		await seed();
		const deleted = await recordWork(
			parseInstant("2026-07-22T08:00:00Z"),
			parseInstant("2026-07-22T10:00:00Z"),
			{ approval: false },
		);
		actAs(ids.requesterUser);
		await expect(
			requestTimeEntryDeletion({
				workPeriodId: deleted.id,
				submissionId: randomUUID(),
				reason: "Recorded by mistake",
			}),
		).resolves.toMatchObject({ success: true });
		const deletion = await pendingCycle(deleted.id, "time_correction");
		const metadata = await recordWork(
			parseInstant("2026-07-23T08:00:00Z"),
			parseInstant("2026-07-23T10:00:00Z"),
			{ approval: false },
		);
		actAs(ids.requesterUser);
		await expect(
			requestTimeCorrection({
				workPeriodId: metadata.id,
				submissionId: randomUUID(),
				newClockInDate: "2026-07-23",
				newClockInTime: "08:00",
				newClockOutDate: "2026-07-23",
				newClockOutTime: "10:00",
				reason: "Worked from home",
				workLocationType: "home",
				workCategoryId: null,
			}),
		).resolves.toMatchObject({ success: true });
		const metadataOnly = await pendingCycle(metadata.id, "time_correction");

		await deliver();
		const cardFor = (request: string) =>
			sends().find((call) => String(call.body.text).includes(request));
		const deletionCard = cardFor("Request: Delete this entry");
		const metadataCard = cardFor("Request: Change work details");
		expect(sends()).toHaveLength(2);
		const deletionText = String(deletionCard?.body.text);
		expect(deletionText).toContain("Request: Delete this entry");
		expect(deletionText).toContain(
			"Entry: Jul 22, 2026, 08:00 (UTC+00:00) – Jul 22, 2026, 10:00 (UTC+00:00)",
		);
		// Deletion markers are never shown as proposed working times.
		expect(deletionText).not.toContain("Clock in:");
		expect(deletionText).not.toContain("Clock out:");
		const metadataText = String(metadataCard?.body.text);
		expect(metadataText).toContain("Request: Change work details");
		expect(metadataText).toContain("Work location: Office → Home");
		expect(metadataText).not.toContain("Clock in:");

		if (!deletionCard) throw new Error("missing deletion card");
		await press(deletionCard, "ba", "t325-deletion-1");
		expect(await counts(deletion.workflow_id)).toMatchObject({
			decisions: "1",
			status: "approved",
		});
		const { rows } = await admin.query<{ deleted_at: Date | null }>(
			"select deleted_at from work_period where id = $1",
			[deleted.id],
		);
		expect(only(rows).deleted_at).not.toBeNull();
		const review = await reviewSections(deletion.request_id);
		expect(keyValue(review.sections, "Requested correction").slice(1)).toEqual([
			["Request", "Delete this entry"],
			["Entry", "2026-07-22 08:00 (UTC+00:00) – 2026-07-22 10:00 (UTC+00:00)"],
			["Duration before", "2 h 0 min"],
		]);
		expect(keyValue(review.sections, "Result")).toEqual([
			["Outcome", "Approved"],
			["Entry", "Deleted"],
		]);
		expect(
			keyValue((await reviewSections(metadataOnly.request_id)).sections, "Requested correction")[1],
		).toEqual(["Request", "Change work details"]);
	});

	it("decides nothing when the entry changed after the card was sent, and holds it in review", async () => {
		await seed();
		const work = await recordWork(
			parseInstant("2026-07-22T08:00:00Z"),
			parseInstant("2026-07-22T10:00:00Z"),
			{ approval: false },
		);
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		const cycle = await pendingCycle(work.id, "time_correction");
		await deliver();
		const card = only(sends());
		await admin.query("update work_period set work_location_type = 'home' where id = $1", [
			work.id,
		]);
		const before = await counts(cycle.workflow_id);

		const pressed = await press(card, "ba", "t325-changed-1");
		expect(pressed.answer.body).toMatchObject({ text: "Review required" });
		expect(await counts(cycle.workflow_id)).toEqual(before);
		// The still-pending card becomes a review notice without controls.
		const notice = only(pressed.edits);
		expect(String(notice.body.text)).toContain("No decision was made");
		expect(buttonsOf(notice).every((button) => !button.callback_data)).toBe(true);

		const review = await reviewSections(cycle.request_id);
		expect(
			review.sections.some((section) => section.type === "callout" && section.tone === "danger"),
		).toBe(true);
		expect(review.actions).toMatchObject({ canApprove: false, canReject: false });
		// A fresh card is not bound to the changed entry either.
		const fresh = await prepareApprovalPresentation({
			approvalId: cycle.request_id,
			recipientEmployeeId: ids.manager,
			organizationId: ids.organization,
			provider: "telegram",
		});
		expect(fresh.status).toBe("review_required");
	});

	it("keeps cards review-only unless every gate holds; Slack gets the facts without controls", async () => {
		const bindings = async () =>
			Number(
				only(
					(
						await admin.query<{ count: string }>(
							"select count(*) from approval_review_binding where organization_id = $1",
							[ids.organization],
						)
					).rows,
				).count,
			);
		for (const gate of [
			{ presentation: "review_only" as const },
			{ presentation: null },
			{ capture: false },
		]) {
			await seed(gate);
			const manualId = await submitManual();
			const cycle = await pendingCycle(manualId, "manual_time_submission");
			const card = await prepareApprovalPresentation({
				approvalId: cycle.request_id,
				recipientEmployeeId: ids.manager,
				organizationId: ids.organization,
				provider: "telegram",
			});
			expect(card.status).toBe("review_required");
			expect(await bindings()).toBe(0);
		}

		await seed();
		const manualId = await submitManual();
		const cycle = await pendingCycle(manualId, "manual_time_submission");
		const slack = await prepareApprovalPresentation({
			approvalId: cycle.request_id,
			recipientEmployeeId: ids.manager,
			organizationId: ids.organization,
			provider: "slack",
			summary: { fits: () => true },
		});
		expect(slack).toMatchObject({
			status: "review_summary",
			title: "Manual time approval request",
			reviewUrl: `https://t325.example.test/approvals/review/${ids.organization}/compatibility/${cycle.request_id}`,
		});
		expect(slack.status === "review_summary" && slack.facts).toContainEqual({
			label: "Clock in",
			value: "Jul 20, 2026, 09:00 (UTC+02:00)",
		});
		expect(slack).not.toHaveProperty("bindingId");
		expect(await bindings()).toBe(0);
		// A card too large for the provider is review-only and binds nothing.
		const oversized = await prepareApprovalPresentation({
			approvalId: cycle.request_id,
			recipientEmployeeId: ids.manager,
			organizationId: ids.organization,
			provider: "telegram",
			fits: () => false,
		});
		expect(oversized.status).toBe("review_required");
		expect(await bindings()).toBe(0);
	});

	it("keeps legacy-authority time cards review-only while their review shows the evidence", async () => {
		await seed({ rollout: "legacy" });
		const manualId = await submitManual();
		const { rows } = await admin.query<{ id: string }>(
			"select id from approval_request where entity_id = $1 and status = 'pending'",
			[manualId],
		);
		const requestId = only(rows).id;

		const card = await prepareApprovalPresentation({
			approvalId: requestId,
			recipientEmployeeId: ids.manager,
			organizationId: ids.organization,
			provider: "telegram",
		});
		expect(card.status).toBe("review_required");
		// No legacy delivery intents exist for time kinds: the owner sends nothing.
		await deliver();
		expect(sends()).toHaveLength(0);

		const review = await reviewSections(requestId);
		expect(keyValue(review.sections, "Submitted times").slice(0, 3)).toEqual([
			["Employee", "Avery Requester"],
			["Clock in", "2026-07-20 09:00 (UTC+02:00)"],
			["Clock out", "2026-07-20 17:30 (UTC+02:00)"],
		]);
		actAs(ids.managerUser);
		await expect(
			approveApprovalInboxItem({
				approvalId: requestId,
				actorEmployeeId: ids.manager,
				organizationId: ids.organization,
			}),
		).resolves.toMatchObject({ status: "approved" });
		harness.userId = null;
		const history = (await reviewSections(requestId)).sections.find(
			(section) => section.type === "timeline" && section.title === "Evidence history",
		);
		expect(
			history?.type === "timeline" && history.events.map((event) => [event.label, event.actorName]),
		).toEqual([
			["Submitted", "Avery Requester"],
			["Request approved", "Morgan Manager"],
		]);
	});

	it("reports an intermediate step apart from the final outcome across a two-stage chain", async () => {
		await seed();
		await seedTwoStages();
		const manualId = await submitManual();
		const cycle = await pendingCycle(manualId, "manual_time_submission");
		await deliver();
		const stageOne = only(sends());

		const pressed = await press(stageOne, "ba", "t325-stage-1");
		expect(pressed.answer.body).toMatchObject({ text: "Approval recorded" });
		expect(await counts(cycle.workflow_id)).toMatchObject({ decisions: "1", status: "pending" });
		const { rows: stepEvidence } = await admin.query(
			`select assignment_outcome, request_outcome, result from approval_decision_evidence
			 where workflow_id = $1`,
			[cycle.workflow_id],
		);
		// An intermediate approval is not final: no terminal result exists yet.
		expect(only(stepEvidence)).toMatchObject({
			assignment_outcome: "approved",
			request_outcome: "pending",
			result: { workPeriodStatus: "pending", terminal: null },
		});

		// Stage one's card reports its own step; the final approver approves on the web.
		await deliver();
		expect(String(only(edits()).body.text)).toContain("Approval recorded");
		const { rows: finalRequests } = await admin.query<{ id: string }>(
			`select r.id from approval_request r where r.entity_id = $1 and r.status = 'pending'`,
			[manualId],
		);
		actAs(ids.finalUser);
		await expect(
			approveApprovalInboxItem({
				approvalId: only(finalRequests).id,
				actorEmployeeId: ids.finalApprover,
				organizationId: ids.organization,
			}),
		).resolves.toMatchObject({ status: "approved" });
		harness.userId = null;
		const history = (await reviewSections(cycle.request_id)).sections.find(
			(section) => section.type === "timeline" && section.title === "Evidence history",
		);
		expect(history?.type === "timeline" && history.events.map((event) => event.label)).toEqual([
			"Submitted",
			"Approval recorded — awaiting further approval",
			"Request approved",
		]);
	});

	it("stops sent cards when the provider is paused, while committed presses keep replaying", async () => {
		await seed();
		const first = await submitManual("2026-07-20");
		const second = await submitManual("2026-07-21");
		const committedCycle = await pendingCycle(first, "manual_time_submission");
		const pausedCycle = await pendingCycle(second, "manual_time_submission");
		await deliver();
		expect(sends()).toHaveLength(2);
		const bindingWorkflow = async (call: TelegramCall) =>
			only(
				(
					await admin.query<{ workflow_id: string }>(
						"select workflow_id from approval_review_binding where id = $1",
						[bindingOf(call)],
					)
				).rows,
			).workflow_id;
		const cards = sends();
		const committedCard =
			(await bindingWorkflow(cards[0] as TelegramCall)) === committedCycle.workflow_id
				? (cards[0] as TelegramCall)
				: (cards[1] as TelegramCall);
		const pausedCard =
			committedCard === cards[0] ? (cards[1] as TelegramCall) : (cards[0] as TelegramCall);
		await press(committedCard, "ba", "t325-paused-committed");
		const committed = await counts(committedCycle.workflow_id);

		await admin.query(
			`update approval_presentation_control set mode = 'review_only' where organization_id = $1`,
			[ids.organization],
		);
		const paused = await press(pausedCard, "ba", "t325-paused-fresh");
		expect(paused.answer.body).toMatchObject({ text: "Review required" });
		expect(await counts(pausedCycle.workflow_id)).toMatchObject({
			decisions: "0",
			status: "pending",
		});
		const replay = await press(committedCard, "ba", "t325-paused-committed");
		expect(replay.answer.body).toMatchObject({ text: "Request approved" });
		expect(await counts(committedCycle.workflow_id)).toEqual(committed);
	});

	it("commits one decision for concurrent deliveries and rolls back a failed invocation write", async () => {
		await seed();
		const work = await recordWork(
			parseInstant("2026-07-22T08:00:00Z"),
			parseInstant("2026-07-22T10:00:00Z"),
			{ approval: false },
		);
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		const cycle = await pendingCycle(work.id, "time_correction");
		await deliver();
		const card = only(sends());
		const before = await counts(cycle.workflow_id);
		const { rows: periodBefore } = await admin.query("select * from work_period where id = $1", [
			work.id,
		]);

		expect(
			(
				await admin.query(
					"select id, controls, state, origin_work_id from approval_delivery_message where workflow_id = $1",
					[cycle.workflow_id],
				)
			).rows,
		).toHaveLength(1);
		// An injected invocation failure rolls the whole decision back.
		await admin.query(
			`create function t325_fail() returns trigger language plpgsql as $$
			 begin raise exception 't325 injected invocation failure'; end $$`,
		);
		await admin.query(
			"create trigger t325_fail before insert on approval_invocation for each row execute function t325_fail()",
		);
		const failed = await press(card, "ba", "t325-concurrent");
		expect(failed.answer.body).not.toHaveProperty("text");
		await admin.query("drop function t325_fail() cascade");
		expect(await counts(cycle.workflow_id)).toEqual(before);
		const { rows: periodAfter } = await admin.query("select * from work_period where id = $1", [
			work.id,
		]);
		expect(periodAfter).toEqual(periodBefore);

		// The same query then decides freshly, once, however often it arrives.
		await Promise.all([
			press(card, "ba", "t325-concurrent"),
			press(card, "ba", "t325-concurrent"),
			press(card, "ba", "t325-concurrent"),
		]);
		expect(await counts(cycle.workflow_id)).toMatchObject({
			decisions: "1",
			invocations: "1",
			status: "approved",
		});
		expect(
			answers()
				.slice(-3)
				.map((answer) => answer.body.text),
		).toEqual(["Request approved", "Request approved", "Request approved"]);
	});

	it("purges one lifecycle's bindings, invocations and delivery rows; a late press recreates nothing", async () => {
		await seed();
		const purgedId = await submitManual("2026-07-20");
		const keptId = await submitManual("2026-07-21");
		const purged = await pendingCycle(purgedId, "manual_time_submission");
		const kept = await pendingCycle(keptId, "manual_time_submission");
		await deliver();
		const purgedCard = (
			await Promise.all(
				sends().map(async (call) => ({
					call,
					workflowId: only(
						(
							await admin.query<{ workflow_id: string }>(
								"select workflow_id from approval_review_binding where id = $1",
								[bindingOf(call)],
							)
						).rows,
					).workflow_id,
				})),
			)
		).find((entry) => entry.workflowId === purged.workflow_id)?.call;
		if (!purgedCard) throw new Error("missing card");
		await press(purgedCard, "ba", "t325-purge-1");

		const deleted = await deleteApproval(db as never, ids.organization, purged.workflow_id);
		expect(deleted.evidence.invocations).toHaveLength(1);
		expect(deleted.evidence.reviewBindings).toHaveLength(1);
		expect(deleted.delivery.messages).toHaveLength(1);
		const remaining = async (workflowId: string) =>
			only(
				(
					await admin.query<Record<string, string>>(
						`select
						   (select count(*) from approval_review_binding where workflow_id = $1) as bindings,
						   (select count(*) from approval_invocation where workflow_id = $1) as invocations,
						   (select count(*) from approval_delivery_message where workflow_id = $1) as messages,
						   (select count(*) from approval_submitted_revision where workflow_id = $1) as revisions`,
						[workflowId],
					)
				).rows,
			);
		expect(await remaining(purged.workflow_id)).toEqual({
			bindings: "0",
			invocations: "0",
			messages: "0",
			revisions: "0",
		});
		expect(await remaining(kept.workflow_id)).toMatchObject({ bindings: "1", revisions: "1" });

		// A late redelivery of the purged press finds nothing and writes nothing.
		const late = await press(purgedCard, "ba", "t325-purge-1").catch(() => null);
		expect(late?.answer.body ?? {}).not.toMatchObject({ text: "Request approved" });
		expect(await remaining(purged.workflow_id)).toMatchObject({ invocations: "0" });
	});

	it("silences the existing time notification path only for the cycle the owner delivers", async () => {
		await seed();
		const manualId = await submitManual();
		const cycle = await pendingCycle(manualId, "manual_time_submission");
		const notice = (entityType: string, entityId: string) => ({
			userId: ids.managerUser,
			organizationId: ids.organization,
			type: "approval_request_submitted" as const,
			title: "Manual time entry approval required",
			message: "Avery Requester submitted a manual time entry.",
			entityType,
			entityId,
		});
		await sendTelegramNotification(notice("work_period", manualId));
		await sendTelegramNotification(notice("approval_request", cycle.request_id));
		expect(sends()).toHaveLength(0);

		// Once that cycle is decided, the period no longer names an owned pending
		// cycle, and the existing path keeps its message.
		actAs(ids.managerUser);
		await expect(
			approveApprovalInboxItem({
				approvalId: cycle.request_id,
				actorEmployeeId: ids.manager,
				organizationId: ids.organization,
			}),
		).resolves.toMatchObject({ status: "approved" });
		harness.userId = null;
		await sendTelegramNotification(notice("work_period", manualId));
		expect(sends()).toHaveLength(1);

		// Without a delivery control for the kind, the path speaks as before.
		const next = await submitManual("2026-07-21");
		await admin.query(
			`delete from approval_delivery_control
			 where organization_id = $1 and workflow_type = 'manual_time_submission'`,
			[ids.organization],
		);
		await sendTelegramNotification(notice("work_period", next));
		expect(sends()).toHaveLength(2);
	});
});
