/**
 * #300 / T36 runtime evidence: escalation replacement delivery and old-card
 * retirement through the shared Telegram delivery transport.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * A real canonical absence submission is delivered to its manager by the real
 * delivery owner. The real scheduled escalation commits the transfer with its
 * delivery event; escalation's real replacement delivery pass expands the
 * event, sends the replacement card and retires the former card; real web and
 * webhook decisions race it. Only the request/session, billing guard, e-mail
 * and notification fan-out, calendar queue, work-balance marking, the vault,
 * the post-commit fast path (so each test drives the passes explicitly) and
 * the Telegram HTTP transport (fetch) are replaced.
 */

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
			max: 10,
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
							user: { id: harness.userId, role: "user" },
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
	getOrganizationBaseUrl: async () => "https://t300.example.test",
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
	const ignore = async () => undefined;
	return {
		...original,
		onAbsenceRequestSubmitted: ignore,
		onAbsenceRequestPendingApproval: ignore,
		onAbsenceRequestApproved: ignore,
		onAbsenceRequestRejected: ignore,
		onApprovedAbsenceCancelledByEmployee: ignore,
	};
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
	getOrgSecret: async () => "300300300:AAT300-replacement_delivery_test",
}));

// The best-effort fast path only runs the passes sooner; recording the calls
// keeps each test's delivery passes explicit and deterministic.
vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
		harness.kicks.push(input);
	},
}));

const BOT_TOKEN = "300300300:AAT300-replacement_delivery_test";

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { db } = await import("@/db");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { expandApprovalDeliveryIntents } = await import("@/lib/approvals/delivery/store");

const { recoverApprovalDeliveryForAttention } = await import("@/lib/approvals/delivery/recovery");
const { telegramApprovalDeliveryAdapter } = await import("@/lib/telegram/approval-delivery");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { saveConversation } = await import("@/lib/telegram/conversation-manager");
const { processDueEscalations } = await import("./transfer");
const { expandEscalationTransferEvents, processEscalationReplacementDeliveries } = await import(
	"./replacement-delivery"
);

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
	describe.skip(`Escalation replacement delivery PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const MANAGER_TELEGRAM_ID = 30_001;
const BACKUP_TELEGRAM_ID = 30_002;
const MANAGER_CHAT_ID = 300_111;
const BACKUP_CHAT_ID = 300_222;
// Pinned pass time. Submissions and new work use the database's real time, so
// the pinned clock lies after it, and every assignment is already overdue for
// the one-hour response window.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t300-replacement-org",
	requesterUser: "t300-requester-user",
	managerUser: "t300-manager-user",
	backupUser: "t300-backup-user",
	requester: "e3000000-0000-4000-8000-000000000001",
	manager: "e3000000-0000-4000-8000-000000000002",
	backup: "e3000000-0000-4000-8000-000000000003",
	managerLink: "e3001000-0000-4000-8000-000000000001",
	backupLink: "e3001000-0000-4000-8000-000000000002",
	category: "e3002000-0000-4000-8000-000000000001",
} as const;

interface TelegramCall {
	method: string;
	body: Record<string, unknown>;
}

type TransportResponse =
	| { kind: "ok" }
	| { kind: "error"; status: number; errorCode: number; description: string }
	| { kind: "network" };

interface Submitted {
	absenceId: string;
	requestId: string;
	workflowId: string;
	assignmentId: string;
}

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

function minutes(count: number) {
	return T0.add({ minutes: count });
}

describeIntegration("escalation replacement delivery (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 30_000;
	const originalFetch = globalThis.fetch;
	/** Per-method scripted responses; anything unscripted succeeds. */
	const script: Record<string, TransportResponse[]> = {};
	/** Runs while a sendMessage is in flight, before Telegram "answers". */
	let duringSend: (() => Promise<void>) | null = null;

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
			calls.push({ method, body });
			if (method === "sendMessage" && duringSend) {
				const hook = duringSend;
				duringSend = null;
				await hook();
			}
			const scripted = script[method]?.shift() ?? { kind: "ok" };
			if (scripted.kind === "network") throw new TypeError("fetch failed");
			if (scripted.kind === "error") {
				return new Response(
					JSON.stringify({
						ok: false,
						error_code: scripted.errorCode,
						description: scripted.description,
					}),
					{ status: scripted.status, headers: { "content-type": "application/json" } },
				);
			}
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
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.backupUser],
		]);
	}

	async function seed(options: { enableEscalations?: boolean } = {}) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T300 replacement', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', 'canonical', 'canonical', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'absence', 'capture')`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_presentation_control
			 (organization_id, workflow_type, provider, mode) values ($1, 'absence', 'telegram', 'actionable')`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ($1, 'absence', 'telegram', $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t300"}'::jsonb)`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't300-requester@example.test', $4, $4),
			 ($2, 'Morgan Manager', 't300-manager@example.test', $4, $4),
			 ($3, 'Blake Backup', 't300-backup@example.test', $4, $4)`,
			[ids.requesterUser, ids.managerUser, ids.backupUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'Europe/Berlin', '24h', $2 from unnest($1::text[]) as user_id`,
			[[ids.managerUser, ids.backupUser], timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't300-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.requesterUser, ids.managerUser, ids.backupUser]],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'employee', $8), ($3, $4, $7, 'manager', $8), ($5, $6, $7, 'manager', $8)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.backup,
				ids.backupUser,
				ids.organization,
				timestamp,
			],
		);
		// The primary manager receives the request; the other direct manager is
		// the deterministic backup.
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $3, $4, true, $6, $7, $7), ($2, $3, $5, false, $6, $7, $7)`,
			[
				ids.managerLink,
				ids.backupLink,
				ids.requester,
				ids.manager,
				ids.backup,
				ids.managerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, counts_against_vacation,
			  is_active, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', true, true, true, $3)`,
			[ids.category, ids.organization, timestamp],
		);
		await admin.query(
			`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't300_bot', 't300-secret', 'active', true, $2, $3)`,
			[ids.organization, options.enableEscalations ?? true, timestamp],
		);
		await admin.query(
			`insert into telegram_user_mapping
			 (user_id, organization_id, telegram_user_id, is_active, updated_at)
			 values ($1, $3, $4, true, $6), ($2, $3, $5, true, $6)`,
			[
				ids.managerUser,
				ids.backupUser,
				ids.organization,
				String(MANAGER_TELEGRAM_ID),
				String(BACKUP_TELEGRAM_ID),
				timestamp,
			],
		);
		await admin.query(
			`insert into telegram_conversation
			 (organization_id, user_id, chat_id, chat_type, is_active, updated_at)
			 values ($1, $2, $4, 'private', true, $6), ($1, $3, $5, 'private', true, $6)`,
			[
				ids.organization,
				ids.managerUser,
				ids.backupUser,
				String(MANAGER_CHAT_ID),
				String(BACKUP_CHAT_ID),
				timestamp,
			],
		);
	}

	async function submit(): Promise<Submitted> {
		actAs(ids.requesterUser);
		const result = await requestAbsenceEffect({
			categoryId: ids.category,
			startDate: "2026-11-02",
			endDate: "2026-11-03",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
			notes: "Private note that stays in authenticated review",
		});
		harness.userId = null;
		if (!result.success) throw new Error(`Submission failed: ${result.error}`);
		const { rows } = await admin.query<{
			id: string;
			workflow_id: string;
			assignment_id: string;
		}>(
			`select r.id, a.approval_workflow_id as workflow_id, sa.id as assignment_id
			 from approval_request r
			 join absence_entry a on a.id = r.entity_id
			 join approval_stage_assignment sa on sa.workflow_id = a.approval_workflow_id
			 where r.organization_id = $1 and r.entity_id = $2 and r.status = 'pending'`,
			[ids.organization, result.data.absenceId],
		);
		const request = only(rows);
		return {
			absenceId: result.data.absenceId,
			requestId: request.id,
			workflowId: request.workflow_id,
			assignmentId: request.assignment_id,
		};
	}

	function deliver(now: Temporal.Instant = T0) {
		return processApprovalDeliveries({ organizationId: ids.organization, now });
	}

	function escalate(now: Temporal.Instant = T0) {
		return processDueEscalations({ organizationId: ids.organization, now });
	}

	function replace(now: Temporal.Instant = T0) {
		return processEscalationReplacementDeliveries({ organizationId: ids.organization, now });
	}

	/** Submitted, the manager's card delivered and the assignment transferred. */
	async function transferred() {
		const submitted = await submit();
		await deliver();
		const managerCard = only(sends());
		const summary = await escalate();
		expect(summary.transferred).toBe(1);
		const transfer = only(await transfers(submitted.workflowId));
		return { ...submitted, managerCard, transfer };
	}

	async function decideOnWeb(userId: string, submitted: Submitted) {
		actAs(userId);
		const result = await approveAbsenceEffect(submitted.absenceId, {
			approvalRequestId: submitted.requestId,
		});
		harness.userId = null;
		return result;
	}

	async function transfers(workflowId: string) {
		const { rows } = await admin.query<{
			id: string;
			source_assignment_id: string;
			replacement_assignment_id: string;
			replacement_approver_employee_id: string;
		}>(
			`select id, source_assignment_id, replacement_assignment_id, replacement_approver_employee_id
			 from approval_escalation_transfer where workflow_id = $1 order by created_at`,
			[workflowId],
		);
		return rows;
	}

	async function transferEvent(transferId: string) {
		const { rows } = await admin.query<{ expansion_status: string; expanded_at: Date | null }>(
			`select expansion_status, expanded_at from approval_escalation_transfer_event
			 where transfer_id = $1`,
			[transferId],
		);
		return only(rows);
	}

	async function work(workflowId: string) {
		const { rows } = await admin.query<{
			id: string;
			effect: string;
			status: string;
			assignment_id: string;
			recipient_employee_id: string;
			escalation_transfer_id: string | null;
			retry_count: number;
			attempt_count: number;
			last_outcome: string | null;
			available_at: Date;
			message_id: string | null;
		}>(
			`select id, effect, status, assignment_id, recipient_employee_id, escalation_transfer_id,
			 retry_count, attempt_count, last_outcome, available_at, message_id
			 from approval_delivery_work where workflow_id = $1
			 order by created_at, array_position(array['initial', 'replacement', 'refresh'], effect)`,
			[workflowId],
		);
		return rows;
	}

	async function replacementWork(workflowId: string) {
		return (await work(workflowId)).filter((row) => row.effect === "replacement");
	}

	async function messages(workflowId: string) {
		const { rows } = await admin.query<{
			id: string;
			assignment_id: string;
			recipient_employee_id: string;
			destination_id: string;
			remote_message_id: string;
			binding_id: string | null;
			controls: string;
			state: string;
			status_version: number;
		}>(
			`select * from approval_delivery_message where workflow_id = $1
			 order by remote_message_id::bigint`,
			[workflowId],
		);
		return rows;
	}

	async function workflowVersion(workflowId: string): Promise<number> {
		const { rows } = await admin.query<{ version: number }>(
			"select version from approval_workflow where id = $1",
			[workflowId],
		);
		return only(rows).version;
	}

	async function assignmentStatus(assignmentId: string): Promise<string> {
		const { rows } = await admin.query<{ status: string }>(
			"select status from approval_stage_assignment where id = $1",
			[assignmentId],
		);
		return only(rows).status;
	}

	async function openAttention(reason: string) {
		const { rows } = await admin.query<{ id: string; assignment_id: string | null }>(
			`select id, assignment_id from approval_escalation_attention
			 where organization_id = $1 and reason = $2 and status = 'open'`,
			[ids.organization, reason],
		);
		return rows;
	}

	const sends = () => calls.filter((call) => call.method === "sendMessage");
	const sendsTo = (chatId: number) =>
		sends().filter((call) => call.body.chat_id === String(chatId));
	const edits = () => calls.filter((call) => call.method === "editMessageText");
	const buttonsOf = (call: TelegramCall) =>
		(
			call.body.reply_markup as {
				inline_keyboard: Array<Array<{ callback_data?: string; url?: string }>>;
			}
		).inline_keyboard.flat();
	const controlsOf = (call: TelegramCall) =>
		buttonsOf(call).filter((button) => button.callback_data);

	function approveData(card: TelegramCall): string {
		return (
			buttonsOf(card).find((button) => button.callback_data?.includes('"ba"'))?.callback_data ?? ""
		);
	}

	function botConfig() {
		return {
			organizationId: ids.organization,
			botToken: BOT_TOKEN,
			botUsername: "t300_bot",
			webhookSecret: "t300-secret",
			setupStatus: "active",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: false,
			enableEscalations: true,
			digestTime: "09:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		};
	}

	async function press(
		from: { telegramId: number; chatId: number },
		messageId: number,
		data: string,
		queryId: string,
	) {
		await handleTelegramUpdate(
			{
				update_id: 7000 + calls.length,
				callback_query: {
					id: queryId,
					from: { id: from.telegramId, is_bot: false, first_name: "Approver" },
					message: {
						message_id: messageId,
						date: 1_790_000_000,
						chat: { id: from.chatId, type: "private" as const },
					},
					data,
				},
			},
			botConfig(),
		);
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
			throw new Error("Escalation replacement delivery PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
		harness.kicks.length = 0;
		calls.length = 0;
		duringSend = null;
		for (const key of Object.keys(script)) delete script[key];
		installTelegramTransport();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
	});

	it("sends the replacement card and retires the former card from the committed event (commit before send)", async () => {
		await seed();
		const { workflowId, assignmentId, managerCard, transfer } = await transferred();
		const [managerMessage] = await messages(workflowId);

		// The transfer committed its event and only asked for a fast pass;
		// nothing was sent before the pass ran (as after a crash right after commit).
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization, workflowId });
		expect(await transferEvent(transfer.id)).toMatchObject({ expansion_status: "pending" });
		expect(sends()).toHaveLength(1);
		expect(transfer).toMatchObject({
			source_assignment_id: assignmentId,
			replacement_approver_employee_id: ids.backup,
		});

		// Pausing automation stops new transfers, never committed delivery.
		await admin.query(
			"update approval_escalation_control set automation_paused = true where organization_id = $1",
			[ids.organization],
		);
		const summary = await replace();
		expect(summary).toMatchObject({ expanded: 1, planned: 2, outcomes: { delivered: 2 } });

		const replacementCard = only(sendsTo(BACKUP_CHAT_ID));
		expect(String(replacementCard.body.text)).toContain("Absence approval request");
		expect(String(replacementCard.body.text)).not.toContain("Private note");
		expect(controlsOf(replacementCard)).toHaveLength(2);
		const retirement = only(edits());
		expect(retirement.body.message_id).toBe(Number(managerMessage?.remote_message_id));
		expect(String(retirement.body.text)).toContain("Reassigned");
		expect(String(retirement.body.text)).not.toContain("Blake");
		expect(controlsOf(retirement)).toHaveLength(0);

		const version = await workflowVersion(workflowId);
		const { rows: bindings } = await admin.query<{ id: string }>(
			"select id from approval_review_binding where assignment_id = $1",
			[transfer.replacement_assignment_id],
		);
		expect(await messages(workflowId)).toMatchObject([
			{
				assignment_id: assignmentId,
				recipient_employee_id: ids.manager,
				controls: "none",
				state: "retired",
				status_version: version,
			},
			{
				assignment_id: transfer.replacement_assignment_id,
				recipient_employee_id: ids.backup,
				destination_id: String(BACKUP_CHAT_ID),
				binding_id: only(bindings).id,
				controls: "actionable",
				state: "current",
			},
		]);
		expect(
			(await work(workflowId)).map((row) => [row.effect, row.status, row.escalation_transfer_id]),
		).toEqual([
			["initial", "delivered", null],
			["replacement", "delivered", transfer.id],
			["refresh", "delivered", transfer.id],
		]);
		expect((await transferEvent(transfer.id)).expansion_status).toBe("expanded");

		// The delivery owner's pass converges on the same effects: its intent for
		// the transfer plans nothing new and it never executes escalation work.
		await deliver(minutes(1));
		await replace(minutes(2));
		expect(sends()).toHaveLength(2);
		expect(edits()).toHaveLength(1);
		expect(managerCard.body.chat_id).toBe(String(MANAGER_CHAT_ID));
		expect(await work(workflowId)).toHaveLength(3);
	});

	it("lets the replacement decide from its card; a press on the former card decides nothing", async () => {
		await seed();
		const { workflowId, managerCard, transfer } = await transferred();
		const [managerMessage] = await messages(workflowId);

		// The former holder presses before the retirement reaches Telegram.
		await press(
			{ telegramId: MANAGER_TELEGRAM_ID, chatId: MANAGER_CHAT_ID },
			Number(managerMessage?.remote_message_id),
			approveData(managerCard),
			"t300-q-former",
		);
		expect(await assignmentStatus(transfer.replacement_assignment_id)).toBe("pending");
		const { rows: stillPending } = await admin.query<{ status: string }>(
			"select status from approval_workflow where id = $1",
			[workflowId],
		);
		expect(only(stillPending).status).toBe("pending");
		const refused = only(calls.filter((call) => call.method === "answerCallbackQuery"));
		// The acknowledgment explains that the assignment moved.
		expect(refused.body.text).toBe("Reassigned");

		await replace();
		const replacementCard = only(sendsTo(BACKUP_CHAT_ID));
		const replacementMessage = (await messages(workflowId))[1];
		await press(
			{ telegramId: BACKUP_TELEGRAM_ID, chatId: BACKUP_CHAT_ID },
			Number(replacementMessage?.remote_message_id),
			approveData(replacementCard),
			"t300-q-replacement",
		);
		const { rows: decided } = await admin.query<{ status: string }>(
			"select status from approval_workflow where id = $1",
			[workflowId],
		);
		expect(only(decided).status).toBe("approved");

		// The decision's intent refreshes every tracked card; controls never return.
		await deliver(minutes(1));
		await replace(minutes(1));
		const replacementEdit = edits().find(
			(call) => call.body.message_id === Number(replacementMessage?.remote_message_id),
		);
		expect(String(replacementEdit?.body.text)).toContain("Approved by Blake Backup");
		expect(edits().every((call) => controlsOf(call).length === 0)).toBe(true);
		const version = await workflowVersion(workflowId);
		for (const message of await messages(workflowId)) {
			expect(message).toMatchObject({ controls: "none", status_version: version });
		}
		const managerEdits = edits().filter(
			(call) => call.body.message_id === Number(managerMessage?.remote_message_id),
		);
		expect(managerEdits.length).toBeGreaterThan(0);
		expect(managerEdits.every((call) => String(call.body.text).includes("Reassigned"))).toBe(true);
	});

	it("freezes the intended channels at the first expansion and rechecks disablement before sending", async () => {
		await seed({ enableEscalations: false });
		const first = await transferred();
		const expanded = await replace();
		expect(expanded).toMatchObject({ expanded: 1, planned: 1 });
		// No replacement channel; the former card is still retired.
		expect(await replacementWork(first.workflowId)).toHaveLength(0);
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(0);
		const [managerMessage] = await messages(first.workflowId);
		expect(only(edits()).body.message_id).toBe(Number(managerMessage?.remote_message_id));

		// Enabling escalations later adds no channel to an expanded transfer.
		await admin.query(
			"update telegram_bot_config set enable_escalations = true where organization_id = $1",
			[ids.organization],
		);
		await replace(minutes(1));
		expect(await replacementWork(first.workflowId)).toHaveLength(0);
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(0);

		// Intended at expansion, disabled before the send: nothing leaves.
		await seed({ enableEscalations: true });
		calls.length = 0;
		const second = await transferred();
		await expandEscalationTransferEvents({ organizationId: ids.organization, limit: 10 });
		await admin.query(
			"update telegram_bot_config set enable_escalations = false where organization_id = $1",
			[ids.organization],
		);
		await replace();
		expect(only(await replacementWork(second.workflowId))).toMatchObject({
			status: "suppressed",
			last_outcome: "escalations_disabled",
		});
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(0);
	});

	it("recovers an expansion that crashed after the transfer committed, without another transfer", async () => {
		await seed();
		const { workflowId, transfer } = await transferred();
		vi.spyOn(telegramApprovalDeliveryAdapter, "acceptsEscalationDelivery").mockRejectedValueOnce(
			new Error("t300 injected expansion crash"),
		);
		await expect(replace()).rejects.toThrow("t300 injected expansion crash");
		expect(await transferEvent(transfer.id)).toMatchObject({ expansion_status: "pending" });
		expect(await work(workflowId)).toHaveLength(1);

		// Scheduled escalation never repeats the committed transfer.
		const rerun = await escalate(minutes(1));
		expect(rerun.transferred).toBe(0);
		expect(await transfers(workflowId)).toHaveLength(1);

		const recovered = await replace(minutes(1));
		expect(recovered).toMatchObject({ expanded: 1, outcomes: { delivered: 2 } });
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(1);
		expect(await transfers(workflowId)).toHaveLength(1);
	});

	it("cancels a replacement card whose assignment was decided before it was sent", async () => {
		await seed();
		const submitted = await transferred();
		await expandEscalationTransferEvents({ organizationId: ids.organization, limit: 10 });
		expect(only(await replacementWork(submitted.workflowId)).status).toBe("pending");

		const decided = await decideOnWeb(ids.backupUser, submitted);
		expect(decided.success).toBe(true);
		const summary = await replace();
		expect(summary.cancelled).toBe(1);
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(0);
		expect(only(await replacementWork(submitted.workflowId))).toMatchObject({
			status: "cancelled",
			last_outcome: "obsolete",
		});
	});

	it("sends and edits nothing under legacy authority after a cutover between planning and send", async () => {
		await seed();
		const submitted = await transferred();
		await expandEscalationTransferEvents({ organizationId: ids.organization, limit: 10 });
		await admin.query(
			`update approval_workflow_rollout set lifecycle_mode = 'legacy', side_effect_mode = 'legacy'
			 where organization_id = $1 and workflow_type = 'absence'`,
			[ids.organization],
		);
		await replace();
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(0);
		expect(edits()).toHaveLength(0);
		expect(
			(await work(submitted.workflowId))
				.filter((row) => row.escalation_transfer_id)
				.map((row) => [row.effect, row.status, row.last_outcome]),
		).toEqual([
			["replacement", "cancelled", "authority_changed"],
			["refresh", "cancelled", "authority_changed"],
		]);
	});

	it("tracks a replacement card that went stale in flight and retires it", async () => {
		await seed();
		const submitted = await transferred();
		// The replacement decides on the web while Telegram is accepting its card.
		duringSend = async () => {
			const decided = await decideOnWeb(ids.backupUser, submitted);
			if (!decided.success) throw new Error("Web decision failed");
		};

		await replace();
		const replacementMessage = only(
			(await messages(submitted.workflowId)).filter(
				(message) => message.recipient_employee_id === ids.backup,
			),
		);
		expect(replacementMessage).toMatchObject({ controls: "actionable" });
		expect(replacementMessage.status_version).toBeLessThan(
			await workflowVersion(submitted.workflowId),
		);
		const staleRetirement = (await work(submitted.workflowId)).find(
			(row) => row.effect === "refresh" && row.message_id === replacementMessage.id,
		);
		expect(staleRetirement).toMatchObject({
			status: "pending",
			escalation_transfer_id: submitted.transfer.id,
		});

		await replace(minutes(1));
		const edit = edits().find(
			(call) => call.body.message_id === Number(replacementMessage.remote_message_id),
		);
		expect(String(edit?.body.text)).toContain("Approved by Blake Backup");
		expect(
			only(
				(await messages(submitted.workflowId)).filter(
					(message) => message.recipient_employee_id === ids.backup,
				),
			),
		).toMatchObject({ controls: "none", state: "retired" });
	});

	it("retries a failed replacement send without touching authority, exhausts visibly and recovers without resending", async () => {
		await seed();
		const { workflowId, transfer } = await transferred();
		const failure = {
			kind: "error" as const,
			status: 502,
			errorCode: 502,
			description: "Bad Gateway",
		};
		script.sendMessage = Array.from({ length: 6 }, () => failure);

		let now = T0;
		await replace(now);
		for (const [index, wait] of [1, 5, 30, 120, 720].entries()) {
			const [row] = await replacementWork(workflowId);
			expect(row).toMatchObject({ status: "pending", retry_count: index + 1 });
			expect(Temporal.Instant.from(row?.available_at.toISOString() ?? "")).toEqual(
				now.add({ minutes: wait }),
			);
			await replace(now.add({ minutes: wait }).subtract({ seconds: 1 }));
			expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(index + 1);
			now = now.add({ minutes: wait });
			await replace(now);
		}
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(6);
		expect(only(await replacementWork(workflowId))).toMatchObject({
			status: "exhausted",
			last_outcome: "ambiguous:telegram_502",
		});
		const incident = only(await openAttention("delivery_exhausted"));
		expect(incident.assignment_id).toBe(transfer.replacement_assignment_id);

		// Delivery failure never undoes or repeats the transfer.
		expect(await assignmentStatus(transfer.replacement_assignment_id)).toBe("pending");
		const later = await escalate(now);
		expect(later.transferred).toBe(0);
		expect(await transfers(workflowId)).toHaveLength(1);

		const recovered = await recoverApprovalDeliveryForAttention({
			organizationId: ids.organization,
			attentionId: incident.id,
			actorUserId: ids.managerUser,
			now: now.add({ hours: 1 }),
		});
		expect(recovered.kind).toBe("rearmed");
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization, workflowId });
		// The delivery owner never executes escalation work.
		await deliver(now.add({ hours: 1 }));
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(6);
		await replace(now.add({ hours: 1 }));
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(7);
		expect(only(await replacementWork(workflowId))).toMatchObject({ status: "delivered" });
		expect(await openAttention("delivery_exhausted")).toHaveLength(0);

		// Delivered work is never resent by recovery.
		await expect(
			recoverApprovalDeliveryForAttention({
				organizationId: ids.organization,
				attentionId: incident.id,
				actorUserId: ids.managerUser,
			}),
		).resolves.toEqual({ kind: "not_found" });
		await replace(now.add({ hours: 2 }));
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(7);
	});

	it("resends after a failed local acknowledgment and keeps every known duplicate identity", async () => {
		await seed();
		const submitted = await transferred();
		await admin.query(`
			create or replace function t300_fail_tracking() returns trigger language plpgsql as $$
			begin
				if new.recipient_employee_id = 'e3000000-0000-4000-8000-000000000003'::uuid then
					raise exception 't300 injected tracking failure';
				end if;
				return new;
			end $$;
			create trigger t300_fail_tracking before insert on approval_delivery_message
			for each row execute function t300_fail_tracking();
		`);
		try {
			const first = await replace();
			expect(first.outcomes).toMatchObject({ retry_scheduled: 1 });
		} finally {
			await admin.query(`
				drop trigger t300_fail_tracking on approval_delivery_message;
				drop function t300_fail_tracking();
			`);
		}
		expect(only(await replacementWork(submitted.workflowId))).toMatchObject({
			status: "pending",
			last_outcome: "ambiguous:internal_error",
		});
		await replace(minutes(1));
		// Telegram accepted twice; only the second identity is known.
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(2);
		expect(
			(await messages(submitted.workflowId)).filter(
				(message) => message.recipient_employee_id === ids.backup,
			),
		).toHaveLength(1);

		// A worker whose lease expired mid-send still records its late message.
		let release!: () => void;
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		let stalled!: () => void;
		const inFlight = new Promise<void>((resolve) => {
			stalled = resolve;
		});
		await seed();
		calls.length = 0;
		const raced = await transferred();
		duringSend = async () => {
			stalled();
			await released;
		};
		// Worker A stalls inside the replacement send; B finds its lease expired.
		const workerA = replace(T0);
		await inFlight;
		// B takes over every expired lease of A's batch (the retirement, too).
		const workerB = await replace(minutes(3));
		expect(workerB.outcomes.delivered).toBeGreaterThanOrEqual(1);
		expect(workerB.outcomes.lease_lost).toBeUndefined();
		release();
		const late = await workerA;
		expect(late.outcomes.lease_lost).toBeGreaterThanOrEqual(1);
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(2);
		const replacementMessages = (await messages(raced.workflowId)).filter(
			(message) => message.recipient_employee_id === ids.backup,
		);
		expect(replacementMessages).toHaveLength(2);
		expect(only(await replacementWork(raced.workflowId))).toMatchObject({
			status: "delivered",
			attempt_count: 2,
		});

		// Both duplicates are retired once the replacement decides.
		const decided = await decideOnWeb(ids.backupUser, raced);
		expect(decided.success).toBe(true);
		await deliver(minutes(10));
		await replace(minutes(10));
		for (const message of await messages(raced.workflowId)) {
			expect(message.controls).toBe("none");
		}
	});

	it("raises attention at once when the replacement has no destination and re-arms on repair", async () => {
		await seed();
		await admin.query("delete from telegram_conversation where user_id = $1", [ids.backupUser]);
		const { workflowId, transfer } = await transferred();

		await replace();
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(0);
		expect(only(await replacementWork(workflowId))).toMatchObject({
			status: "awaiting_repair",
			retry_count: 0,
			last_outcome: "destination_invalid:destination_missing",
		});
		expect(only(await openAttention("delivery_unavailable")).assignment_id).toBe(
			transfer.replacement_assignment_id,
		);

		await saveConversation(String(BACKUP_CHAT_ID), "private", ids.backupUser, ids.organization);
		await replace(minutes(1));
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(1);
		expect(only(await replacementWork(workflowId)).status).toBe("delivered");
		expect(await openAttention("delivery_unavailable")).toHaveLength(0);
	});

	it("honors the replacement's notification preference", async () => {
		await seed();
		await admin.query(
			`insert into notification_preference (user_id, notification_type, channel, enabled, updated_at)
			 values ($1, 'approval_request_submitted', 'telegram', false, now())`,
			[ids.backupUser],
		);
		const { workflowId } = await transferred();
		await replace();
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(0);
		expect(only(await replacementWork(workflowId))).toMatchObject({
			status: "suppressed",
			last_outcome: "preference_disabled",
		});
		// The former card is retired regardless.
		expect(edits()).toHaveLength(1);
	});

	it("owns the former card's retirement even when the delivery owner planned it first", async () => {
		await seed();
		const { workflowId, transfer } = await transferred();
		// The delivery owner expands the transition's intent before escalation's
		// pass: it plans the same refresh, unlinked.
		const planned = await expandApprovalDeliveryIntents({
			organizationId: ids.organization,
			limit: 10,
		});
		expect(planned.created).toBe(1);
		expect(
			(await work(workflowId)).find((row) => row.effect === "refresh")?.escalation_transfer_id,
		).toBeNull();

		await replace();
		const retirements = (await work(workflowId)).filter((row) => row.effect === "refresh");
		expect(retirements).toHaveLength(1);
		expect(retirements[0]).toMatchObject({
			status: "delivered",
			escalation_transfer_id: transfer.id,
		});
		expect(edits()).toHaveLength(1);
	});

	it("keeps authority when the replacement send fails permanently, and retries a failed retirement", async () => {
		await seed();
		const { workflowId, transfer } = await transferred();
		script.sendMessage = [
			{ kind: "error", status: 400, errorCode: 400, description: "Bad Request: invalid markup" },
		];
		script.editMessageText = [{ kind: "network" }];

		await replace();
		expect(only(await replacementWork(workflowId))).toMatchObject({
			status: "failed",
			last_outcome: "permanent:telegram_400",
		});
		expect(only(await openAttention("delivery_exhausted")).assignment_id).toBe(
			transfer.replacement_assignment_id,
		);
		const retirement = (await work(workflowId)).find((row) => row.effect === "refresh");
		expect(retirement).toMatchObject({
			status: "pending",
			retry_count: 1,
			last_outcome: "ambiguous:network",
		});
		expect(await assignmentStatus(transfer.replacement_assignment_id)).toBe("pending");
		expect(await transfers(workflowId)).toHaveLength(1);

		// A permanent failure is not retried; the retirement is, and succeeds.
		await replace(minutes(1));
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(1);
		expect(edits()).toHaveLength(2);
		const [former] = await messages(workflowId);
		expect(former).toMatchObject({ controls: "none", state: "retired" });
	});

	it("sends no fresh details to a replacement who lost organization membership", async () => {
		await seed();
		const { workflowId } = await transferred();
		await admin.query("delete from member where organization_id = $1 and user_id = $2", [
			ids.organization,
			ids.backupUser,
		]);
		await replace();
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(0);
		expect(only(await replacementWork(workflowId))).toMatchObject({
			status: "suppressed",
			last_outcome: "not_entitled",
		});
	});

	it("sends one replacement card when passes run concurrently", async () => {
		await seed();
		const { workflowId } = await transferred();
		await Promise.all([replace(), replace(), replace()]);
		expect(sendsTo(BACKUP_CHAT_ID)).toHaveLength(1);
		expect(edits()).toHaveLength(1);
		expect(
			(await messages(workflowId)).filter(
				(message) => message.recipient_employee_id === ids.backup,
			),
		).toHaveLength(1);
	});

	it("privileged cleanup removes and reports replacement work and messages with the journal", async () => {
		await seed();
		const { workflowId, transfer } = await transferred();
		await replace();
		const deliveryWork = (await work(workflowId)).map((row) => row.id).sort();
		const deliveryMessages = (await messages(workflowId)).map((row) => row.id).sort();
		expect(deliveryWork).toHaveLength(3);
		expect(deliveryMessages).toHaveLength(2);

		const deleted = await deleteApproval(db, ids.organization, workflowId);
		expect(deleted.delivery).toEqual({
			work: deliveryWork,
			messages: deliveryMessages,
			intents: [],
		});
		expect(deleted.escalationTransfers).toEqual([transfer.id]);
		expect(await work(workflowId)).toHaveLength(0);
		expect(await messages(workflowId)).toHaveLength(0);
	});
});
