/**
 * #306 / T42 runtime evidence: privileged and tenant cleanup across every adopted
 * lifecycle of one organization.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Two organizations are populated through the real callers: adopted demo work
 * and demo corrections (append positions, completed-work receipts, correction
 * approvals), canonical absences submitted, delivered to Telegram (cards,
 * bindings, delivery work, destination attention) and decided from a card
 * (invocation, decision evidence), plus a legacy expense lifecycle with its
 * delivery intent and a staged receipt upload, written the way their owners
 * write them. Cleanup then runs through its real callers: the platform-admin
 * force-delete action, the organization cleanup job and the demo settings
 * actions. Only the request/session, billing guard, e-mail and notification
 * fan-out, calendar queue, work-balance marking, the vault, the post-commit
 * delivery kick and the Telegram HTTP transport (fetch) are replaced.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	role: "user" as "user" | "admin",
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
								role: harness.role,
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

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t306.example.test",
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: async () => ({ success: true }),
}));

vi.mock("@/lib/email/render", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/email/render")>();
	return {
		...original,
		renderAbsenceRequestSubmitted: async () => "<p>submitted</p>",
		renderAbsenceRequestPendingApproval: async () => "<p>pending</p>",
		renderAbsenceRequestApproved: async () => "<p>approved</p>",
		renderAbsenceRequestRejected: async () => "<p>rejected</p>",
	};
});

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("@/lib/queue", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/queue")>()),
	addCalendarSyncJob: async () => undefined,
}));

vi.mock("@/lib/work-balance/service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/work-balance/service")>()),
	markEmployeeWorkBalanceDirty: async () => undefined,
}));

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async () => "306306306:AAT306-lifecycle_cleanup_test",
}));

vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: () => undefined,
}));

const BOT_TOKEN = "306306306:AAT306-lifecycle_cleanup_test";

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const {
	deleteNonAdminDataAction,
	generatePendingTimeCorrectionApprovalsStepAction,
	generateTimeEntriesStepAction,
} = await import("@/app/[locale]/(app)/settings/demo/actions");
const { forceDeleteApprovalAction } = await import(
	"@/app/[locale]/(admin)/platform-admin/settings/approval-maintenance-actions"
);
const { runOrganizationCleanup } = await import("@/lib/jobs/organization-cleanup");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { recheckEscalationAttention } = await import("@/lib/approvals/escalation/attention-store");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { runTravelExpenseReceiptCleanup, stageTravelExpenseReceiptUpload } = await import(
	"@/lib/travel-expenses/receipt-upload"
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
	describe.skip(`lifecycle cleanup PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

// Pinned delivery pass time. New work becomes due at the database's now(), so it
// must lie after the real time the test runs at.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");
// Demo generation covers the 30 days before this fixed "now".
const DEMO_NOW = new Date("2026-07-24T12:00:00Z");
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");
const PLATFORM_ADMIN_USER = "t306-platform-admin";

type Tenant = ReturnType<typeof tenant>;

function tenant(key: "target" | "survivor", index: number) {
	const hex = (n: number) => `e306${index}000-0000-4000-8000-00000000000${n}`;
	return {
		key,
		organization: `t306-${key}-org`,
		adminUser: `t306-${key}-admin-user`,
		requesterUser: `t306-${key}-requester-user`,
		managerUser: `t306-${key}-manager-user`,
		admin: hex(1),
		requester: hex(2),
		manager: hex(3),
		managerLink: hex(4),
		category: hex(5),
		telegramUserId: 30_600 + index,
		chatId: 306_500 + index,
	};
}

const target = tenant("target", 1);
const survivor = tenant("survivor", 2);

interface TelegramCall {
	method: string;
	body: Record<string, unknown>;
}

interface Population {
	/** The decided absence's card, to press again after a purge. */
	card: { messageId: number; data: string };
	/** Absence whose card could not be delivered: open destination attention. */
	held: { absenceId: string; workflowId: string; assignmentId: string };
	/** Absence decided from its Telegram card: invocation and decision evidence. */
	decided: { absenceId: string; workflowId: string; assignmentId: string };
	expense: { claimId: string; requestId: string };
	stagedUpload: string;
}

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("lifecycle cleanup across adopted lifecycles (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });
	const calls: TelegramCall[] = [];
	/** Sent card bodies by remote message ID. */
	const sent = new Map<number, Record<string, unknown>>();
	let nextMessageId = 30_600;
	const originalFetch = globalThis.fetch;
	/** Scripted sendMessage failures; anything unscripted succeeds. */
	const failNextSends: number[] = [];

	function installTelegramTransport() {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const match = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
			if (!match) throw new Error(`Unexpected fetch in test: ${url}`);
			const method = match[1] ?? "";
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
			calls.push({ method, body });
			if (method === "sendMessage" && failNextSends.length > 0) {
				const status = failNextSends.shift() ?? 403;
				return new Response(
					JSON.stringify({
						ok: false,
						error_code: status,
						description: "Forbidden: bot was blocked by the user",
					}),
					{ status, headers: { "content-type": "application/json" } },
				);
			}
			if (method === "sendMessage") sent.set(nextMessageId, body);
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

	function actAs(userId: string, organizationId: string | null) {
		harness.userId = userId;
		harness.organizationId = organizationId;
		harness.role = "user";
	}

	function actAsPlatformAdmin() {
		harness.userId = PLATFORM_ADMIN_USER;
		harness.organizationId = null;
		harness.role = "admin";
	}

	async function cleanup() {
		await admin.query("drop function if exists t306_fail() cascade");
		await admin.query("delete from travel_expense_receipt_upload where organization_id = any($1)", [
			[target.organization, survivor.organization],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[target.organization, survivor.organization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[
				PLATFORM_ADMIN_USER,
				...[target, survivor].flatMap((t) => [t.adminUser, t.requesterUser, t.managerUser]),
			],
		]);
	}

	async function seedTenant(t: Tenant) {
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, $1, $1, $2)`,
			[t.organization, SEEDED_AT],
		);
		const people = [
			[t.adminUser, t.admin, "admin", "admin"],
			[t.requesterUser, t.requester, "member", "employee"],
			[t.managerUser, t.manager, "member", "manager"],
		] as const;
		for (const [userId, employeeId, memberRole, employeeRole] of people) {
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, $3, $3)`,
				[userId, `${userId}@example.test`, SEEDED_AT],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`member-${userId}`, t.organization, userId, memberRole, SEEDED_AT],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, updated_at)
				 values ($1, $2, $3, $4, $5)`,
				[employeeId, userId, t.organization, employeeRole, SEEDED_AT],
			);
			await admin.query(
				`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
				 values ($1, 'en', 'UTC', '24h', $2)`,
				[userId, SEEDED_AT],
			);
		}
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[t.managerLink, t.requester, t.manager, t.adminUser, SEEDED_AT],
		);
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, counts_against_vacation,
			  is_active, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', true, true, true, $3)`,
			[t.category, t.organization, SEEDED_AT],
		);
		// Adoption and capture controls, as the documented operator SQL writes them.
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
			[t.organization],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', 'canonical', 'canonical', $2, $2)`,
			[t.organization, SEEDED_AT],
		);
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 select $1, workflow_type::approval_workflow_type, 'capture'
			 from unnest(array['absence', 'time_correction', 'travel_expense']) as workflow_type`,
			[t.organization],
		);
		await admin.query(
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 values ($1, 'absence', 'telegram', 'actionable')`,
			[t.organization],
		);
		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ($1, 'absence', 'telegram', $2), ($1, 'travel_expense', 'telegram', $2)`,
			[t.organization, SEEDED_AT],
		);
		await admin.query(
			`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't306_bot', $2, 'active', true, false, $3)`,
			[t.organization, `t306-${t.key}-secret`, SEEDED_AT],
		);
		await admin.query(
			`insert into telegram_user_mapping
			 (user_id, organization_id, telegram_user_id, is_active, updated_at)
			 values ($1, $2, $3, true, $4)`,
			[t.managerUser, t.organization, String(t.telegramUserId), SEEDED_AT],
		);
		await admin.query(
			`insert into telegram_conversation
			 (organization_id, user_id, chat_id, chat_type, is_active, updated_at)
			 values ($1, $2, $3, 'private', true, $4)`,
			[t.organization, t.managerUser, String(t.chatId), SEEDED_AT],
		);
		// Rows outside the organization cascade: a session with the tenant active
		// and a push subscription of one of its users.
		await admin.query(
			`insert into session (id, expires_at, token, updated_at, user_id, active_organization_id)
			 values ($1, '2031-01-01', $1, $2, $3, $4)`,
			[`t306-${t.key}-session`, SEEDED_AT, t.managerUser, t.organization],
		);
		await admin.query(
			`insert into push_subscription (user_id, endpoint, p256dh, auth, updated_at)
			 values ($1, $2, 'p256dh', 'auth', $3)`,
			[t.managerUser, `https://push.example.test/${t.key}`, SEEDED_AT],
		);
	}

	/** Session and push rows of a tenant user, which live outside the cascade. */
	async function userRows(t: Tenant) {
		const { rows } = await admin.query(
			`select
			   (select active_organization_id from session where id = $1) as active_organization,
			   (select count(*)::int from push_subscription where user_id = $2) as push_subscriptions`,
			[`t306-${t.key}-session`, t.managerUser],
		);
		return only(rows);
	}

	function botConfig(t: Tenant) {
		return {
			organizationId: t.organization,
			botToken: BOT_TOKEN,
			botUsername: "t306_bot",
			webhookSecret: `t306-${t.key}-secret`,
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

	/** Reruns the demo correction step, which replays committed corrections first. */
	async function generateDemoCorrections(t: Tenant) {
		vi.useFakeTimers({ toFake: ["Date"], now: DEMO_NOW });
		const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
		try {
			actAs(t.adminUser, null);
			const result = await generatePendingTimeCorrectionApprovalsStepAction({
				organizationId: t.organization,
				dateRangeType: "last30",
				employeeIds: [t.requester],
			});
			if (!result.success) throw new Error(`Demo corrections failed: ${result.error}`);
		} finally {
			random.mockRestore();
			vi.useRealTimers();
			harness.userId = null;
		}
	}

	/** Adopted demo work for the admin and the requester, then demo corrections. */
	async function generateDemoWork(t: Tenant) {
		vi.useFakeTimers({ toFake: ["Date"], now: DEMO_NOW });
		const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
		try {
			actAs(t.adminUser, null);
			const input = (employeeIds: string[]) => ({
				organizationId: t.organization,
				dateRangeType: "last30" as const,
				employeeIds,
			});
			const work = await generateTimeEntriesStepAction(input([t.admin, t.requester]));
			if (!work.success) throw new Error(`Demo work failed: ${work.error}`);
			const corrections = await generatePendingTimeCorrectionApprovalsStepAction(
				input([t.requester]),
			);
			if (!corrections.success) throw new Error(`Demo corrections failed: ${corrections.error}`);
		} finally {
			random.mockRestore();
			vi.useRealTimers();
			harness.userId = null;
		}
	}

	async function submitAbsence(t: Tenant, startDate: string) {
		actAs(t.requesterUser, t.organization);
		const result = await requestAbsenceEffect({
			categoryId: t.category,
			startDate,
			endDate: startDate,
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
		});
		harness.userId = null;
		if (!result.success) throw new Error(`Submission failed: ${result.error}`);
		const { rows } = await admin.query<{ workflow_id: string; assignment_id: string }>(
			`select a.approval_workflow_id as workflow_id, sa.id as assignment_id
			 from absence_entry a
			 join approval_stage_assignment sa on sa.workflow_id = a.approval_workflow_id
			 where a.id = $1`,
			[result.data.absenceId],
		);
		const row = only(rows);
		return {
			absenceId: result.data.absenceId,
			workflowId: row.workflow_id,
			assignmentId: row.assignment_id,
		};
	}

	function deliver(t: Tenant, minutes = 0) {
		return processApprovalDeliveries({
			organizationId: t.organization,
			now: T0.add({ minutes }),
		});
	}

	/** The card delivered for a workflow and its approve callback. */
	async function cardOf(workflowId: string) {
		const message = only(
			(
				await admin.query<{ remote_message_id: string }>(
					"select remote_message_id from approval_delivery_message where workflow_id = $1",
					[workflowId],
				)
			).rows,
		);
		const body = sent.get(Number(message.remote_message_id));
		const markup = body?.reply_markup as
			| { inline_keyboard: Array<Array<{ callback_data?: string }>> }
			| undefined;
		const buttons = markup?.inline_keyboard.flat() ?? [];
		const approve = buttons.find((button) => button.callback_data?.includes('"ba"'));
		return { messageId: Number(message.remote_message_id), data: approve?.callback_data ?? "" };
	}

	async function press(t: Tenant, card: { messageId: number; data: string }, queryId: string) {
		await handleTelegramUpdate(
			{
				update_id: 30_600 + calls.length,
				callback_query: {
					id: queryId,
					from: { id: t.telegramUserId, is_bot: false, first_name: "Morgan" },
					message: {
						message_id: card.messageId,
						date: 1_790_000_000,
						chat: { id: t.chatId, type: "private" as const },
					},
					data: card.data,
				},
			},
			botConfig(t),
		);
	}

	/** A submitted legacy expense claim, its request and delivery intent (#296). */
	async function submittedClaim(t: Tenant) {
		const claim = only(
			(
				await admin.query<{ id: string }>(
					`insert into travel_expense_claim
					 (organization_id, employee_id, approver_id, type, status, trip_start, trip_end,
					  original_currency, original_amount, calculated_currency, calculated_amount,
					  submitted_at, created_by, updated_at)
					 values ($1, $2, $3, 'receipt', 'submitted', '2026-10-01', '2026-10-02',
					  'EUR', 42.50, 'EUR', 42.50, now(), $4, now())
					 returning id`,
					[t.organization, t.requester, t.manager, t.requesterUser],
				)
			).rows,
		);
		const request = only(
			(
				await admin.query<{ id: string }>(
					`insert into approval_request
					 (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
					 values ($1, 'travel_expense_claim', $2, $3, $4, 'pending', now())
					 returning id`,
					[t.organization, claim.id, t.requester, t.manager],
				)
			).rows,
		);
		await admin.query(
			`insert into approval_delivery_intent
			 (organization_id, workflow_type, source_type, source_id, legacy_approval_request_id, event)
			 values ($1, 'travel_expense', 'travel_expense_claim', $2, $3, 'submitted')`,
			[t.organization, claim.id, request.id],
		);
		return { claimId: claim.id, requestId: request.id };
	}

	async function populate(t: Tenant): Promise<Population> {
		await seedTenant(t);
		await generateDemoWork(t);
		const held = await submitAbsence(t, "2026-10-05");
		failNextSends.push(403);
		await deliver(t);
		const decided = await submitAbsence(t, "2026-10-12");
		await deliver(t, 1);
		const card = await cardOf(decided.workflowId);
		await press(t, card, `t306-${t.key}-q-1`);
		await deliver(t, 2);
		const expense = await submittedClaim(t);
		const stagedUpload = randomUUID();
		await stageTravelExpenseReceiptUpload(db, {
			attachmentId: stagedUpload,
			organizationId: t.organization,
			claimId: expense.claimId,
			uploadedBy: t.requester,
			storageKey: `travel-expenses/${t.organization}/${stagedUpload}`,
		});
		return { held, decided, card, expense, stagedUpload };
	}

	/** Every public table with an organization column, as the database knows it. */
	async function organizationTables(): Promise<string[]> {
		const { rows } = await admin.query<{ table_name: string }>(
			`select c.table_name from information_schema.columns c
			 join information_schema.tables t
			   on t.table_schema = c.table_schema and t.table_name = c.table_name
			 where c.table_schema = 'public' and c.column_name = 'organization_id'
			   and t.table_type = 'BASE TABLE'
			 order by c.table_name`,
		);
		return rows.map((row) => row.table_name);
	}

	/** Every organization-scoped row of one tenant, table by table. */
	async function tenantRows(organizationId: string) {
		const result: Record<string, unknown[]> = {};
		for (const table of await organizationTables()) {
			const { rows } = await admin.query<{ row: unknown }>(
				`select row_to_json(t) as row from "${table}" t where organization_id = $1
				 order by row_to_json(t)::text`,
				[organizationId],
			);
			if (rows.length > 0) result[table] = rows.map((row) => row.row);
		}
		return result;
	}

	async function counts(organizationId: string, tables: readonly string[]) {
		const result: Record<string, number> = {};
		for (const table of tables) {
			const { rows } = await admin.query<{ count: number }>(
				`select count(*)::int as count from "${table}" where organization_id = $1`,
				[organizationId],
			);
			result[table] = only(rows).count;
		}
		return result;
	}

	/** An employee's adopted work graph: entries, periods, records, receipts, position. */
	async function workGraph(employeeId: string) {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where employee_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where employee_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where employee_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where employee_id = $1) as receipts,
			   (select row_to_json(t) from time_entry_append_position t where employee_id = $1) as position`,
			[employeeId],
		);
		return only(rows);
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
			throw new Error("Lifecycle cleanup PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.userId = null;
		harness.organizationId = null;
		harness.role = "user";
		calls.length = 0;
		sent.clear();
		failNextSends.length = 0;
		installTelegramTransport();
		await cleanup();
		await admin.query(
			`insert into "user" (id, name, email, role, created_at, updated_at)
			 values ($1, 'Platform admin', 't306-platform-admin@example.test', 'admin', $2, $2)`,
			[PLATFORM_ADMIN_USER, SEEDED_AT],
		);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("populates every adopted lifecycle the cleanup paths must reconcile", async () => {
		const population = await populate(target);

		const present = await counts(target.organization, [
			"time_entry_append_position",
			"completed_work_operation",
			"approval_workflow",
			"approval_submitted_revision",
			"approval_decision_evidence",
			"approval_review_binding",
			"approval_invocation",
			"approval_delivery_work",
			"approval_delivery_message",
			"approval_delivery_intent",
			"approval_escalation_attention",
			"approval_request",
			"travel_expense_receipt_upload",
		]);
		for (const [table, count] of Object.entries(present)) {
			expect({ table, present: count > 0 }).toEqual({ table, present: true });
		}
		const { rows: attention } = await admin.query(
			`select workflow_id, reason from approval_escalation_attention
			 where organization_id = $1 and status = 'open'`,
			[target.organization],
		);
		expect(attention).toEqual([
			{ workflow_id: population.held.workflowId, reason: "delivery_unavailable" },
		]);
		const { rows: invocations } = await admin.query(
			"select workflow_id from approval_invocation where organization_id = $1",
			[target.organization],
		);
		expect(invocations).toEqual([{ workflow_id: population.decided.workflowId }]);
	});

	describe("whole-organization cleanup", () => {
		it("removes every linked lifecycle of the deleted tenant and nothing of another", async () => {
			const population = await populate(target);
			await populate(survivor);
			const survivorBefore = await tenantRows(survivor.organization);
			await admin.query(
				"update organization set deleted_at = now() - interval '6 days' where id = $1",
				[target.organization],
			);

			const result = await runOrganizationCleanup();

			expect(result).toEqual({ success: true, organizationsDeleted: 1, errors: [] });
			// Only the outstanding receipt object cleanup survives the tenant: staging
			// rows are kept by value so the stored object is still deleted (#295).
			expect(Object.keys(await tenantRows(target.organization))).toEqual([
				"travel_expense_receipt_upload",
			]);
			const { rows: employees } = await admin.query(
				"select id from employee where id = any($1::uuid[])",
				[[target.admin, target.requester, target.manager]],
			);
			expect(employees).toEqual([]);
			expect(await tenantRows(survivor.organization)).toEqual(survivorBefore);
			expect(await userRows(target)).toEqual({ active_organization: null, push_subscriptions: 0 });
			expect(await userRows(survivor)).toEqual({
				active_organization: survivor.organization,
				push_subscriptions: 1,
			});

			// The outstanding object is still removed; its staging row then goes too.
			const deletedObjects: string[] = [];
			const receipts = await runTravelExpenseReceiptCleanup(db, {
				deleteObject: async ({ key }) => {
					deletedObjects.push(key);
				},
				now: T0,
				only: { attachmentId: population.stagedUpload, organizationId: target.organization },
			});
			expect(receipts).toMatchObject({ claimed: 1, deleted: 1 });
			expect(deletedObjects).toEqual([
				`travel-expenses/${target.organization}/${population.stagedUpload}`,
			]);
			expect(await tenantRows(target.organization)).toEqual({});

			// Late workers find nothing to recreate for the purged tenant.
			await expect(deliver(target, 10)).resolves.toMatchObject({ claimed: 0 });
			await expect(
				recheckEscalationAttention({ organizationId: target.organization }),
			).resolves.toEqual({ checked: 0, resolved: 0, persisting: 0 });
			expect(await tenantRows(target.organization)).toEqual({});
		});

		it("rolls a failed tenant deletion back completely", async () => {
			await populate(target);
			await admin.query(
				"update organization set deleted_at = now() - interval '6 days' where id = $1",
				[target.organization],
			);
			const before = await tenantRows(target.organization);
			// The very last statement fails: every earlier delete must roll back with it.
			await admin.query(`
				create function t306_fail() returns trigger language plpgsql as $$
				begin raise exception 't306 injected organization delete failure'; end $$;
				create trigger t306_fail before delete on organization
				for each row execute function t306_fail();
			`);

			const result = await runOrganizationCleanup();

			expect(result).toMatchObject({ success: false, organizationsDeleted: 0 });
			expect(result.errors).toHaveLength(1);
			expect(await tenantRows(target.organization)).toEqual(before);
			expect(await userRows(target)).toEqual({
				active_organization: target.organization,
				push_subscriptions: 1,
			});
		});
	});

	describe("privileged approval deletion", () => {
		it("purges one lifecycle with its recovery state; the other cycle, sources and work stay", async () => {
			const population = await populate(target);
			await populate(survivor);
			const survivorBefore = await tenantRows(survivor.organization);
			const requesterWork = await workGraph(target.requester);
			const heldBefore = await admin.query(
				`select
				   (select json_agg(row_to_json(t) order by t.id) from approval_submitted_revision t where workflow_id = $1) as revisions,
				   (select json_agg(row_to_json(t) order by t.id) from approval_delivery_work t where workflow_id = $1) as work,
				   (select json_agg(row_to_json(t) order by t.id) from approval_escalation_attention t where workflow_id = $1) as attention`,
				[population.held.workflowId],
			);
			const ids = async (query: string) =>
				(await admin.query<{ id: string }>(query, [population.decided.workflowId])).rows
					.map((row) => row.id)
					.sort();
			const expected = {
				workflows: [population.decided.workflowId],
				evidence: {
					submittedRevisions: await ids(
						"select id from approval_submitted_revision where workflow_id = $1",
					),
					decisionEvidence: await ids(
						"select id from approval_decision_evidence where workflow_id = $1",
					),
					reviewBindings: await ids(
						"select id from approval_review_binding where workflow_id = $1",
					),
					invocations: await ids("select id from approval_invocation where workflow_id = $1"),
				},
				delivery: {
					work: await ids("select id from approval_delivery_work where workflow_id = $1"),
					messages: await ids("select id from approval_delivery_message where workflow_id = $1"),
					intents: [],
				},
				attention: [],
			};
			expect(expected.evidence.invocations).toHaveLength(1);

			actAsPlatformAdmin();
			const decided = await forceDeleteApprovalAction({
				organizationId: target.organization,
				approvalId: population.decided.workflowId,
			});

			expect(decided).toMatchObject({ success: true, data: expected });
			const audit = only(
				(
					await admin.query<{ metadata: string }>(
						`select metadata from platform_admin_audit_log
						 where admin_user_id = $1 and target_id = $2 and action = 'force_delete_approval'`,
						[PLATFORM_ADMIN_USER, population.decided.workflowId],
					)
				).rows,
			);
			expect(JSON.parse(audit.metadata)).toMatchObject({
				organizationId: target.organization,
				...expected,
			});
			// The source keeps its business outcome; only the approval reference is cleared.
			const { rows: decidedSource } = await admin.query(
				"select status, approval_workflow_id from absence_entry where id = $1",
				[population.decided.absenceId],
			);
			expect(decidedSource).toEqual([{ status: "approved", approval_workflow_id: null }]);
			// The unrelated cycle of the same requester and the adopted work are untouched.
			const heldAfter = await admin.query(
				`select
				   (select json_agg(row_to_json(t) order by t.id) from approval_submitted_revision t where workflow_id = $1) as revisions,
				   (select json_agg(row_to_json(t) order by t.id) from approval_delivery_work t where workflow_id = $1) as work,
				   (select json_agg(row_to_json(t) order by t.id) from approval_escalation_attention t where workflow_id = $1) as attention`,
				[population.held.workflowId],
			);
			expect(heldAfter.rows).toEqual(heldBefore.rows);
			expect(await workGraph(target.requester)).toEqual(requesterWork);

			// A later press on the purged card decides and records nothing.
			await press(target, population.card, "t306-late-q");
			const { rows: lateInvocations } = await admin.query(
				"select id from approval_invocation where workflow_id = $1",
				[population.decided.workflowId],
			);
			expect(lateInvocations).toEqual([]);

			// Purging the held cycle removes its open attention with it.
			const attentionIds = (
				(heldBefore.rows[0] as { attention: Array<{ id: string }> }).attention ?? []
			).map((row) => row.id);
			const held = await forceDeleteApprovalAction({
				organizationId: target.organization,
				approvalId: population.held.workflowId,
			});
			expect(held).toMatchObject({
				success: true,
				data: { workflows: [population.held.workflowId], attention: attentionIds },
			});
			const { rows: attentionLeft } = await admin.query(
				"select id from approval_escalation_attention where organization_id = $1",
				[target.organization],
			);
			expect(attentionLeft).toEqual([]);

			// Late delivery and attention passes cannot recreate the purged cycles.
			await deliver(target, 60);
			await recheckEscalationAttention({ organizationId: target.organization });
			const { rows: recreated } = await admin.query(
				`select
				   (select count(*)::int from approval_delivery_work where workflow_id = any($1::uuid[])) as work,
				   (select count(*)::int from approval_delivery_message where workflow_id = any($1::uuid[])) as messages,
				   (select count(*)::int from approval_escalation_attention where workflow_id = any($1::uuid[])) as attention,
				   (select count(*)::int from approval_submitted_revision where workflow_id = any($1::uuid[])) as revisions`,
				[[population.held.workflowId, population.decided.workflowId]],
			);
			expect(recreated).toEqual([{ work: 0, messages: 0, attention: 0, revisions: 0 }]);
			expect(await workGraph(target.requester)).toEqual(requesterWork);
			expect(await tenantRows(survivor.organization)).toEqual(survivorBefore);
		});

		it("purges a correction lifecycle without touching the retained correction work", async () => {
			await populate(target);
			const requesterWork = await workGraph(target.requester);
			const request = (
				await admin.query<{ id: string; entity_id: string }>(
					`select id, entity_id from approval_request
					 where organization_id = $1 and entity_type = 'time_entry' and status = 'pending'
					 order by created_at, id limit 1`,
					[target.organization],
				)
			).rows[0];
			if (!request) throw new Error("No demo correction approval");
			const { rows: pendingBefore } = await admin.query<{ count: number }>(
				`select count(*)::int as count from approval_request
				 where organization_id = $1 and entity_type = 'time_entry'`,
				[target.organization],
			);

			actAsPlatformAdmin();
			const result = await forceDeleteApprovalAction({
				organizationId: target.organization,
				approvalId: request.id,
			});

			expect(result).toMatchObject({ success: true, data: { legacyRequests: [request.id] } });
			const { rows: pendingAfter } = await admin.query<{ count: number }>(
				`select count(*)::int as count from approval_request
				 where organization_id = $1 and entity_type = 'time_entry'`,
				[target.organization],
			);
			expect(only(pendingAfter).count).toBe(only(pendingBefore).count - 1);
			// Committed correction entries, receipts and the append position are retained
			// append evidence: purging an approval never rewrites the history it described.
			expect(await workGraph(target.requester)).toEqual(requesterWork);

			// A later run replays its committed corrections without recreating the purge.
			await generateDemoCorrections(target);
			const { rows: recreated } = await admin.query(
				`select id from approval_request where organization_id = $1 and entity_id = $2`,
				[target.organization, request.entity_id],
			);
			expect(recreated).toEqual([]);
		});
	});

	describe("selective demo cleanup", () => {
		it("deletes non-admin employees with every lifecycle naming them; the admin's work stays admissible", async () => {
			const population = await populate(target);
			await populate(survivor);
			const survivorBefore = await tenantRows(survivor.organization);
			const adminWork = await workGraph(target.admin);
			const { rows: audited } = await admin.query<{ id: string }>(
				`select id from audit_log where organization_id = $1 and employee_id = any($2::uuid[])
				 order by id`,
				[target.organization, [target.requester, target.manager]],
			);
			expect(audited.length).toBeGreaterThan(0);

			actAs(target.adminUser, null);
			const result = await deleteNonAdminDataAction(target.organization);

			expect(result).toMatchObject({
				success: true,
				data: { employeesDeleted: 2, auditEntriesDetached: audited.length },
			});
			if (!result.success) return;
			expect(result.data.approvalLifecyclesDeleted).toBeGreaterThan(0);
			// The audit trail stays, detached from the deleted employees.
			const { rows: detached } = await admin.query(
				"select id, employee_id from audit_log where id = any($1::uuid[]) order by id",
				[audited.map((row) => row.id)],
			);
			expect(detached).toEqual(audited.map((row) => ({ id: row.id, employee_id: null })));
			expect(await workGraph(target.admin)).toEqual(adminWork);
			const left = await counts(target.organization, [
				"approval_workflow",
				"approval_request",
				"approval_submitted_revision",
				"approval_decision_evidence",
				"approval_review_binding",
				"approval_invocation",
				"approval_delivery_work",
				"approval_delivery_message",
				"approval_delivery_intent",
				"approval_escalation_attention",
			]);
			expect(Object.values(left).every((count) => count === 0)).toBe(true);
			// The staged receipt upload keeps its by-value cleanup work.
			expect(
				(
					await admin.query("select id from travel_expense_receipt_upload where id = $1", [
						population.stagedUpload,
					])
				).rows,
			).toHaveLength(1);
			expect(await tenantRows(survivor.organization)).toEqual(survivorBefore);
		});
	});
});
