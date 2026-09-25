/**
 * #326 / T61 runtime evidence: escalation transfers canonical manual time
 * submissions, policy clock-outs and time corrections through the real
 * scheduled processor and decides them through the real inbox routes and
 * bound cards; legacy time authority is held.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Real callers run against that database: the time submission actions
 * (`clockIn`/`clockOut`, `createManualTimeEntry`, `requestTimeCorrection`),
 * `processDueEscalations`, the escalation settings actions, the inbox list and
 * approve/reject routes with the real CASL abilities, the approval delivery
 * owner, escalation replacement delivery, the Telegram webhook handler and
 * approval maintenance. Only the request/session, billing, notification
 * fan-out, the Next cache, the bot token vault, the delivery fast path and the
 * Telegram HTTP transport (fetch) are replaced. Clock-out and manual approval
 * are forced as in the #325 suite. Every control row is inserted directly:
 * production has no setter.
 */

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
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
	forceClockOutApproval: false,
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
	getOrganizationBaseUrl: async () => "https://t326.example.test",
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
	sendClockOutApprovalNotifications: async () => undefined,
	sendClockOutApprovedNotification: async () => undefined,
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
		checkClockOutNeedsApproval: async (employeeId: string) =>
			harness.forceClockOutApproval || (await original.checkClockOutNeedsApproval(employeeId)),
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

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async () => "326326326:AAT326-escalated_time_kinds",
}));

// The best-effort fast path only runs the owner sooner; each test runs it explicitly.
vi.mock("@/lib/approvals/delivery/kick", () => ({ kickApprovalDelivery: () => undefined }));

const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { requestTimeCorrection } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/corrections"
);
await import("@/lib/approvals/init");
const { GET: listInbox } = await import("@/app/api/approvals/inbox/route");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/approvals/inbox/[id]/reject/route");
const { listApprovalEscalationCandidates, transferApprovalEscalationAssignment } = await import(
	"@/app/[locale]/(app)/settings/approval-escalation/actions"
);
const { processDueEscalations } = await import("./transfer");
const { processEscalationReplacementDeliveries } = await import("./replacement-delivery");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
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
	describe.skip(`escalated time kinds PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const TIME_KINDS = ["policy_clock_out", "manual_time_submission", "time_correction"] as const;
type TimeKind = (typeof TIME_KINDS)[number];
const BOT_TOKEN = "326326326:AAT326-escalated_time_kinds";
const MANAGER_TELEGRAM_ID = 32_601;
const MANAGER_CHAT_ID = 326_555;
const BACKUP_TELEGRAM_ID = 32_602;
const BACKUP_CHAT_ID = 326_666;
// Pinned delivery pass time; it must lie after the real time the test runs at.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t326-time-kinds-org",
	requesterUser: "t326-requester-user",
	managerUser: "t326-manager-user",
	backupUser: "t326-backup-user",
	thirdUser: "t326-third-user",
	adminUser: "t326-admin-user",
	requester: "e3260000-0000-4000-8000-000000000001",
	manager: "e3260000-0000-4000-8000-000000000002",
	backup: "e3260000-0000-4000-8000-000000000003",
	third: "e3260000-0000-4000-8000-000000000004",
	admin: "e3260000-0000-4000-8000-000000000005",
	managerLink: "e3261000-0000-4000-8000-000000000001",
	backupLink: "e3261000-0000-4000-8000-000000000002",
	thirdLink: "e3261000-0000-4000-8000-000000000003",
	changePolicy: "e3262000-0000-4000-8000-000000000001",
	changePolicyAssignment: "e3262000-0000-4000-8000-000000000002",
} as const;

interface TelegramCall {
	method: string;
	body: Record<string, unknown>;
	messageId?: number;
}

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("escalated canonical time approvals (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 32_600;
	const originalFetch = globalThis.fetch;

	function actAs(userId: string | null) {
		harness.userId = userId;
		harness.organizationId = userId ? ids.organization : null;
	}

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

	const sendsTo = (chatId: number) =>
		calls.filter((call) => call.method === "sendMessage" && call.body.chat_id === String(chatId));
	const edits = () => calls.filter((call) => call.method === "editMessageText");
	const actionData = (call: TelegramCall, action: "ba" | "br") =>
		(
			call.body.reply_markup as {
				inline_keyboard: Array<Array<{ text: string; callback_data?: string }>>;
			}
		).inline_keyboard
			.flat()
			.find((button) => button.callback_data?.includes(`"${action}"`))?.callback_data ?? "";

	function botConfig() {
		return {
			organizationId: ids.organization,
			botToken: BOT_TOKEN,
			botUsername: "t326_bot",
			webhookSecret: "t326-secret",
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

	let nextUpdateId = 326_000;
	async function press(
		from: { telegramId: number; chatId: number },
		card: TelegramCall,
		action: "ba" | "br",
		queryId: string,
	) {
		const before = calls.length;
		if (card.messageId === undefined) throw new Error("not a sent card");
		await handleTelegramUpdate(
			{
				update_id: nextUpdateId++,
				callback_query: {
					id: queryId,
					from: { id: from.telegramId, is_bot: false, first_name: "Tester" },
					message: {
						message_id: card.messageId,
						date: 1_790_000_000,
						chat: { id: from.chatId, type: "private" as const },
					},
					data: actionData(card, action),
				},
			},
			botConfig(),
		);
		const answer = calls.slice(before).find((call) => call.method === "answerCallbackQuery");
		if (!answer) throw new Error("press was not acknowledged");
		return answer;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser],
		]);
	}

	async function seed(options: { rollout?: "canonical" | "legacy" } = {}) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const rollout = options.rollout ?? "canonical";
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T326 time', $1, $2)`,
			[ids.organization, timestamp],
		);
		for (const kind of TIME_KINDS) {
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, $2, $3, $4, $5, $5)`,
				[ids.organization, kind, rollout, rollout, timestamp],
			);
			await admin.query(
				`insert into approval_evidence_control (organization_id, workflow_type, mode)
				 values ($1, $2, 'capture')`,
				[ids.organization, kind],
			);
			await admin.query(
				`insert into approval_presentation_control
				 (organization_id, workflow_type, provider, mode) values ($1, $2, 'telegram', 'actionable')`,
				[ids.organization, kind],
			);
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, $2, 'telegram', $3)`,
				[ids.organization, kind, timestamp],
			);
		}
		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t326"}'::jsonb)`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't326-requester@example.test', $6, $6),
			 ($2, 'Morgan Manager', 't326-manager@example.test', $6, $6),
			 ($3, 'Blake Backup', 't326-backup@example.test', $6, $6),
			 ($4, 'Taylor Third', 't326-third@example.test', $6, $6),
			 ($5, 'Ada Admin', 't326-admin@example.test', $6, $6)`,
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'UTC', '24h', $2 from unnest($1::text[]) as user_id`,
			[
				[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser],
				timestamp,
			],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't326-member-' || user_id, $1, user_id,
			   case when user_id = $4 then 'admin' else 'member' end, 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[
				ids.organization,
				timestamp,
				[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser],
				ids.adminUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'employee', $12), ($3, $4, $11, 'manager', $12),
			 ($5, $6, $11, 'manager', $12), ($7, $8, $11, 'manager', $12),
			 ($9, $10, $11, 'admin', $12)`,
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
			],
		);
		// All three are direct managers: the former holder stays eligible, the
		// backup is the first candidate, and the third never holds anything.
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
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T326 manual approval', 0, 3650, $3, $4)`,
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
			 values ($1, 'vault:managed', 't326_bot', 't326-secret', 'active', true, true, $2)`,
			[ids.organization, timestamp],
		);
		for (const [userId, telegramId, chatId] of [
			[ids.managerUser, MANAGER_TELEGRAM_ID, MANAGER_CHAT_ID],
			[ids.backupUser, BACKUP_TELEGRAM_ID, BACKUP_CHAT_ID],
		] as const) {
			await admin.query(
				`insert into telegram_user_mapping
				 (user_id, organization_id, telegram_user_id, is_active, updated_at)
				 values ($1, $2, $3, true, $4)`,
				[userId, ids.organization, String(telegramId), timestamp],
			);
			await admin.query(
				`insert into telegram_conversation
				 (organization_id, user_id, chat_id, chat_type, is_active, updated_at)
				 values ($1, $2, $3, 'private', true, $4)`,
				[ids.organization, userId, String(chatId), timestamp],
			);
		}
	}

	async function recordWork(start: Instant, end: Instant, options: { approval: boolean }) {
		harness.forceClockOutApproval = options.approval;
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
		harness.forceClockOutApproval = false;
		actAs(null);
		const { rows } = await admin.query<{ id: string }>(
			`select id from work_period
			 where employee_id = $1 and start_time = $2 and deleted_at is null`,
			[ids.requester, new Date(start.epochMilliseconds)],
		);
		return only(rows).id;
	}

	async function submitManual(date = "2026-07-20") {
		const submissionId = randomUUID();
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
		actAs(null);
		expect(result).toMatchObject({ success: true, data: { requiresApproval: true } });
		return submissionId;
	}

	async function requestEdit(workPeriodId: string) {
		actAs(ids.requesterUser);
		const result = await requestTimeCorrection({
			workPeriodId,
			submissionId: randomUUID(),
			newClockInDate: "2026-07-22",
			newClockInTime: "07:30",
			newClockOutDate: "2026-07-22",
			newClockOutTime: "15:00",
			reason: "Started earlier",
			workLocationType: "office",
			workCategoryId: null,
		});
		actAs(null);
		expect(result).toMatchObject({ success: true });
	}

	/** Submissions of each kind through the real actions. */
	async function submit(kind: TimeKind): Promise<string> {
		switch (kind) {
			case "manual_time_submission":
				return submitManual();
			case "policy_clock_out":
				return recordWork(
					parseInstant("2026-07-21T08:00:00Z"),
					parseInstant("2026-07-21T12:00:00Z"),
					{ approval: true },
				);
			case "time_correction": {
				const workPeriodId = await recordWork(
					parseInstant("2026-07-22T08:00:00Z"),
					parseInstant("2026-07-22T16:00:00Z"),
					{ approval: false },
				);
				await requestEdit(workPeriodId);
				return workPeriodId;
			}
		}
	}

	/** The pending compatibility request, workflow and assignment of a period's cycle. */
	async function pendingCycle(workPeriodId: string, kind: TimeKind) {
		const { rows } = await admin.query<{
			request_id: string;
			workflow_id: string;
			assignment_id: string;
			approver_id: string;
			assigned_at: Date;
		}>(
			`select r.id as request_id, s.workflow_id, a.id as assignment_id,
			   a.approver_employee_id as approver_id, a.assigned_at
			 from approval_request r
			 join approval_workflow_stage s on s.legacy_approval_request_id = r.id
			 join approval_workflow w on w.id = s.workflow_id
			 join approval_stage_assignment a on a.stage_id = s.id and a.status = 'pending'
			 where r.organization_id = $1 and r.entity_type = 'time_entry' and r.entity_id = $2
			   and r.status = 'pending' and w.workflow_type = $3`,
			[ids.organization, workPeriodId, kind],
		);
		return only(rows);
	}

	function escalateAt(from: Date, plusMinutes: number) {
		return processDueEscalations({
			organizationId: ids.organization,
			now: parseInstant(new Date(from.getTime() + plusMinutes * 60_000).toISOString()),
		});
	}

	async function journal() {
		const { rows } = await admin.query(
			`select * from approval_escalation_transfer
			 where organization_id = $1 order by created_at, id`,
			[ids.organization],
		);
		return rows;
	}

	async function openAttention() {
		const { rows } = await admin.query(
			`select reason, approval_type, evidence from approval_escalation_attention
			 where organization_id = $1 and status = 'open' order by first_raised_at, id`,
			[ids.organization],
		);
		return rows;
	}

	async function requestRow(requestId: string) {
		const { rows } = await admin.query<{ approver_id: string; status: string }>(
			"select approver_id, status from approval_request where id = $1",
			[requestId],
		);
		return only(rows);
	}

	async function workflowStatus(workflowId: string) {
		const { rows } = await admin.query<{ status: string }>(
			"select status from approval_workflow where id = $1",
			[workflowId],
		);
		return only(rows).status;
	}

	async function inboxIds(userId: string): Promise<string[]> {
		actAs(userId);
		const response = await listInbox(
			new NextRequest("http://t326.example.test/api/approvals/inbox?status=pending&limit=100"),
		);
		actAs(null);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { items: Array<{ id: string }> };
		return body.items.map((item) => item.id);
	}

	async function decideAs(userId: string, approvalId: string, action: "approve" | "reject") {
		actAs(userId);
		const url = `http://t326.example.test/api/approvals/inbox/${approvalId}/${action}`;
		const context = { params: Promise.resolve({ id: approvalId }) };
		const response =
			action === "approve"
				? await approveRoute(new NextRequest(url, { method: "POST" }), context)
				: await rejectRoute(
						new NextRequest(url, {
							method: "POST",
							body: JSON.stringify({ reason: "Not this week" }),
							headers: { "content-type": "application/json" },
						}),
						context,
					);
		actAs(null);
		return { status: response.status, body: (await response.json()) as Record<string, unknown> };
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
			throw new Error("Escalated time kinds PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		actAs(null);
		harness.forceClockOutApproval = false;
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

	it.each(TIME_KINDS)(
		"transfers a due canonical %s at its exact deadline; only the replacement decides it from the inbox",
		async (kind) => {
			await seed();
			const workPeriodId = await submit(kind);
			const cycle = await pendingCycle(workPeriodId, kind);
			expect(cycle.approver_id).toBe(ids.manager);

			// Not even discovered one minute before the deadline.
			const early = await escalateAt(cycle.assigned_at, 59);
			expect(early).toMatchObject({ examined: 0, transferred: 0 });
			expect(early.authorities).toMatchObject({ [kind]: "canonical" });
			expect(await journal()).toEqual([]);

			const due = await escalateAt(cycle.assigned_at, 60);
			expect(due).toMatchObject({ status: "processed", transferred: 1, failed: 0 });
			const transfer = only(await journal());
			expect(transfer).toMatchObject({
				authority_mode: "canonical",
				initiator: "scheduled",
				workflow_type: kind,
				workflow_id: cycle.workflow_id,
				source_assignment_id: cycle.assignment_id,
				lineage_root_assignment_id: cycle.assignment_id,
				source_approver_employee_id: ids.manager,
				replacement_approver_employee_id: ids.backup,
				requester_employee_id: ids.requester,
				actionable_evidence: "assignment_assigned_at",
				policy_revision: 1,
				actor_kind: "system",
				actor_system_id: "approval-escalation",
				actor_user_id: null,
				receipt_actor_fingerprint: 'v2:["system","approval-escalation",1]',
			});
			expect(transfer.deadline_at.getTime()).toBe(cycle.assigned_at.getTime() + 3_600_000);
			// The compatibility representative follows the replacement; the
			// approval stays pending and its submitted cycle is unchanged.
			expect(await requestRow(cycle.request_id)).toEqual({
				approver_id: ids.backup,
				status: "pending",
			});
			const replacement = await pendingCycle(workPeriodId, kind);
			expect(replacement).toMatchObject({
				request_id: cycle.request_id,
				workflow_id: cycle.workflow_id,
				assignment_id: transfer.replacement_assignment_id,
				approver_id: ids.backup,
			});

			// The former holder is still an eligible manager of the requester, but
			// eligibility never bypasses the replacement.
			const stale = await decideAs(ids.managerUser, cycle.request_id, "approve");
			expect(stale.status).toBe(409);
			expect(String(stale.body.error)).toContain("reassigned");
			// So is another eligible manager who never held it.
			const other = await decideAs(ids.thirdUser, cycle.request_id, "approve");
			expect(other.status).toBe(409);
			expect(String(other.body.error)).toContain("reassigned");
			expect(await workflowStatus(cycle.workflow_id)).toBe("pending");

			// The replacement finds it in the inbox and decides it.
			const listed = await inboxIds(ids.backupUser);
			const item = listed.find(
				(id) => id === cycle.request_id || id === transfer.replacement_assignment_id,
			);
			expect(item).toBeDefined();
			const decided = await decideAs(ids.backupUser, item ?? "", "approve");
			expect(decided).toMatchObject({ status: 200, body: { success: true } });
			expect(await workflowStatus(cycle.workflow_id)).toBe("approved");
			const { rows: periods } = await admin.query<{ approval_status: string | null }>(
				"select approval_status from work_period where id = $1",
				[workPeriodId],
			);
			expect(only(periods).approval_status).toBe("approved");
		},
	);

	it("lets the replacement reject, and never transfers a lineage twice automatically", async () => {
		await seed();
		const workPeriodId = await submit("policy_clock_out");
		const cycle = await pendingCycle(workPeriodId, "policy_clock_out");
		await escalateAt(cycle.assigned_at, 60);
		const transfer = only(await journal());

		const rerun = await escalateAt(transfer.transferred_at, 61);
		expect(rerun).toMatchObject({ transferred: 0, held: { replacement_overdue: 1 } });
		expect(await journal()).toHaveLength(1);
		expect(only(await openAttention())).toMatchObject({
			reason: "replacement_overdue",
			approval_type: "policy_clock_out",
		});

		const rejected = await decideAs(ids.backupUser, cycle.request_id, "reject");
		expect(rejected).toMatchObject({ status: 200 });
		expect(await workflowStatus(cycle.workflow_id)).toBe("rejected");
	});

	it("lets explicit organization management decide a transferred approval", async () => {
		await seed();
		const workPeriodId = await submit("time_correction");
		const cycle = await pendingCycle(workPeriodId, "time_correction");
		await escalateAt(cycle.assigned_at, 60);

		const managed = await decideAs(ids.adminUser, cycle.request_id, "approve");
		expect(managed).toMatchObject({ status: 200, body: { success: true } });
		expect(await workflowStatus(cycle.workflow_id)).toBe("approved");
	});

	it("serializes simultaneous scheduled attempts into one committed transfer", async () => {
		await seed();
		const workPeriodId = await submit("manual_time_submission");
		const cycle = await pendingCycle(workPeriodId, "manual_time_submission");

		const results = await Promise.all([
			escalateAt(cycle.assigned_at, 60),
			escalateAt(cycle.assigned_at, 60),
		]);

		expect(results.reduce((total, result) => total + result.transferred, 0)).toBe(1);
		expect(results.every((result) => result.failed === 0)).toBe(true);
		expect(await journal()).toHaveLength(1);
		expect((await requestRow(cycle.request_id)).approver_id).toBe(ids.backup);
	});

	it("lets exactly one of a transfer and a concurrent decision by the current holder win", async () => {
		await seed();
		const workPeriodId = await submit("manual_time_submission");
		const cycle = await pendingCycle(workPeriodId, "manual_time_submission");

		const [processed, decision] = await Promise.all([
			escalateAt(cycle.assigned_at, 60),
			decideAs(ids.managerUser, cycle.request_id, "approve"),
		]);

		const transfers = await journal();
		if (decision.status === 200) {
			expect(await workflowStatus(cycle.workflow_id)).toBe("approved");
			expect(transfers).toEqual([]);
		} else {
			expect(await workflowStatus(cycle.workflow_id)).toBe("pending");
			expect(transfers).toHaveLength(1);
			expect(processed.transferred).toBe(1);
		}
		expect(processed.failed).toBe(0);
	});

	it("transfers through the management action with audit and exact replay; the allowance stays unused", async () => {
		await seed();
		const workPeriodId = await submit("manual_time_submission");
		const cycle = await pendingCycle(workPeriodId, "manual_time_submission");

		actAs(ids.adminUser);
		const candidates = await listApprovalEscalationCandidates({
			assignmentId: cycle.assignment_id,
		});
		expect(candidates).toMatchObject({
			success: true,
			data: {
				currentApprover: { employeeId: ids.manager, name: "Morgan Manager" },
				candidates: [
					{ employeeId: ids.backup, recommended: true },
					{ employeeId: ids.third, recommended: false },
				],
			},
		});
		const request = {
			assignmentId: cycle.assignment_id,
			recipientEmployeeId: ids.third,
			idempotencyKey: "e3264000-0000-4000-8000-000000000001",
			reason: "Morgan is on leave",
		};
		expect(await transferApprovalEscalationAssignment(request)).toEqual({
			success: true,
			data: { replayed: false },
		});
		expect(await transferApprovalEscalationAssignment(request)).toEqual({
			success: true,
			data: { replayed: true },
		});
		actAs(null);

		const transfer = only(await journal());
		expect(transfer).toMatchObject({
			initiator: "human",
			authority_mode: "canonical",
			workflow_type: "manual_time_submission",
			actor_kind: "user",
			actor_user_id: ids.adminUser,
			actor_employee_id: ids.admin,
			replacement_approver_employee_id: ids.third,
			actionable_at: null,
			deadline_at: null,
		});
		const { rows: audits } = await admin.query(
			"select action from audit_log where organization_id = $1 and entity_id = $2",
			[ids.organization, transfer.id],
		);
		expect(only(audits)).toMatchObject({ action: "approval_escalation.transferred" });

		// A human transfer does not consume the automatic allowance: the
		// requester's primary manager is the first eligible candidate again.
		const later = await escalateAt(transfer.transferred_at, 60);
		expect(later).toMatchObject({ transferred: 1 });
		const automatic = (await journal()).find((row) => row.initiator === "scheduled");
		expect(automatic).toMatchObject({
			source_approver_employee_id: ids.third,
			replacement_approver_employee_id: ids.manager,
			lineage_root_assignment_id: cycle.assignment_id,
		});
	});

	it("delivers the replacement card, retires the former card, and only the replacement's press decides", async () => {
		await seed();
		const workPeriodId = await submit("policy_clock_out");
		const cycle = await pendingCycle(workPeriodId, "policy_clock_out");
		await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });
		const managerCard = only(sendsTo(MANAGER_CHAT_ID));

		expect((await escalateAt(cycle.assigned_at, 60)).transferred).toBe(1);
		const replaced = await processEscalationReplacementDeliveries({
			organizationId: ids.organization,
			now: T0.add({ minutes: 1 }),
		});
		expect(replaced).toMatchObject({ expanded: 1, outcomes: { delivered: 2 } });
		const replacementCard = only(sendsTo(BACKUP_CHAT_ID));
		expect(String(replacementCard.body.text)).toContain("approval request");
		const retirement = only(edits());
		expect(retirement.body.message_id).toBe(managerCard.messageId);
		expect(String(retirement.body.text)).toContain("Reassigned");

		// The former card decides nothing.
		await press(
			{ telegramId: MANAGER_TELEGRAM_ID, chatId: MANAGER_CHAT_ID },
			managerCard,
			"ba",
			"t326-q-former",
		);
		expect(await workflowStatus(cycle.workflow_id)).toBe("pending");

		const answer = await press(
			{ telegramId: BACKUP_TELEGRAM_ID, chatId: BACKUP_CHAT_ID },
			replacementCard,
			"ba",
			"t326-q-replacement",
		);
		expect(answer.body).toMatchObject({ text: "Request approved" });
		expect(await workflowStatus(cycle.workflow_id)).toBe("approved");
	});

	it("holds legacy-authority time requests once due instead of transferring them", async () => {
		await seed({ rollout: "legacy" });
		const workPeriodId = await submit("manual_time_submission");
		const { rows } = await admin.query<{ id: string; created_at: Date }>(
			`select id, created_at at time zone 'UTC' as created_at from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2
			   and status = 'pending'`,
			[ids.organization, workPeriodId],
		);
		const request = only(rows);

		const early = await escalateAt(request.created_at, 59);
		expect(early).toMatchObject({ transferred: 0, held: {} });
		expect(early.authorities).toMatchObject({ manual_time_submission: "legacy" });
		const due = await escalateAt(request.created_at, 60);
		expect(due).toMatchObject({ transferred: 0, held: { unsupported_route: 1 } });
		expect(await journal()).toEqual([]);
		expect((await requestRow(request.id)).approver_id).toBe(ids.manager);
		expect(only(await openAttention())).toMatchObject({
			reason: "unsupported_route",
			approval_type: "manual_time_submission",
			evidence: expect.objectContaining({ route: "legacy_time_authority" }),
		});

		actAs(ids.adminUser);
		const refused = await transferApprovalEscalationAssignment({
			approvalRequestId: request.id,
			recipientEmployeeId: ids.backup,
			idempotencyKey: "e3264000-0000-4000-8000-000000000002",
		});
		actAs(null);
		expect(refused).toMatchObject({ success: false });
		expect(await journal()).toEqual([]);
	});

	it("removes a time kind's canonical journal through approval maintenance", async () => {
		await seed();
		const workPeriodId = await submit("time_correction");
		const cycle = await pendingCycle(workPeriodId, "time_correction");
		await escalateAt(cycle.assigned_at, 60);
		const transfer = only(await journal());

		const deleted = await deleteApproval(db as never, ids.organization, cycle.request_id);

		expect(deleted.escalationTransfers).toEqual([transfer.id]);
		expect(await journal()).toEqual([]);
	});
});
