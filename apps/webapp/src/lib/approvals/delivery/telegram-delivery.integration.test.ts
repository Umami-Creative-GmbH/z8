/**
 * #291 / T27 runtime evidence: Telegram initial and status delivery through
 * the approval delivery owner.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * A real canonical absence submission commits its lifecycle intents (the
 * workflow outbox) with the workflow. The real delivery owner expands them,
 * leases the work, prepares the real Telegram card and records the actual
 * message; real web and webhook decisions commit refresh intents. Only the
 * request/session, billing guard, e-mail and notification fan-out, calendar
 * queue, work-balance marking, the vault, the post-commit fast path (so each
 * test drives the owner explicitly) and the Telegram HTTP transport (fetch)
 * are replaced.
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
	getOrganizationBaseUrl: async () => "https://t291.example.test",
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
	getOrgSecret: async () => "291291291:AAT291-delivery_owner_test",
}));

// The best-effort fast path only runs the owner sooner; recording the calls
// keeps each test's delivery passes explicit and deterministic.
vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
		harness.kicks.push(input);
	},
}));

const BOT_TOKEN = "291291291:AAT291-delivery_owner_test";

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { db } = await import("@/db");
const { processApprovalDeliveries } = await import("./owner");
const {
	claimApprovalDeliveryWork,
	expandApprovalDeliveryIntents,
	recordDeliveredApprovalMessage,
	renewApprovalDeliveryLease,
} = await import("./store");
const { recoverApprovalDeliveryForAttention } = await import("./recovery");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { saveConversation } = await import("@/lib/telegram/conversation-manager");
const { sendTelegramNotification } = await import("@/lib/notifications/telegram-channel");

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
	describe.skip(`Telegram approval delivery PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const MANAGER_TELEGRAM_ID = 29_101;
const MANAGER_CHAT_ID = 291_555;
const RECEIVER_SCOPE = "telegram-bot:291291291";
// Pinned pass time. New work becomes due at the database's now(), so the
// pinned clock must lie after the real time the test runs at.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t291-delivery-org",
	requesterUser: "t291-requester-user",
	managerUser: "t291-manager-user",
	requester: "e2910000-0000-4000-8000-000000000001",
	manager: "e2910000-0000-4000-8000-000000000002",
	managerLink: "e2911000-0000-4000-8000-000000000001",
	category: "e2912000-0000-4000-8000-000000000001",
} as const;

interface TelegramCall {
	method: string;
	body: Record<string, unknown>;
}

type TransportResponse =
	| { kind: "ok" }
	| { kind: "error"; status: number; errorCode: number; description: string }
	| { kind: "network" };

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

describeIntegration("Telegram approval delivery owner (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 9100;
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
			[ids.requesterUser, ids.managerUser],
		]);
	}

	async function seed(options: { control?: boolean; enableApprovals?: boolean } = {}) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T291 delivery', $1, $2)`,
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
		if (options.control ?? true) {
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, 'absence', 'telegram', $2)`,
				[ids.organization, timestamp],
			);
		}
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't291-requester@example.test', $3, $3),
			 ($2, 'Morgan Manager', 't291-manager@example.test', $3, $3)`,
			[ids.requesterUser, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'Europe/Berlin', '24h', $2)`,
			[ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't291-member-' || user_id, $1, user_id, 'member', 'approved', $2
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
			 values ($1, 'vault:managed', 't291_bot', 't291-secret', 'active', $2, false, $3)`,
			[ids.organization, options.enableApprovals ?? true, timestamp],
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

	async function submit(): Promise<{
		absenceId: string;
		requestId: string;
		workflowId: string;
		assignmentId: string;
	}> {
		actAs(ids.requesterUser);
		const result = await requestAbsenceEffect({
			categoryId: ids.category,
			startDate: "2026-10-05",
			endDate: "2026-10-06",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
			notes: "Private note that stays in authenticated review",
		});
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
		harness.userId = null;
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

	async function approveOnWeb(submitted: { absenceId: string; requestId: string }) {
		actAs(ids.managerUser);
		const result = await approveAbsenceEffect(submitted.absenceId, {
			approvalRequestId: submitted.requestId,
		});
		harness.userId = null;
		if (!result.success) throw new Error(`Web approval failed: ${result.error}`);
	}

	async function work(workflowId: string) {
		const { rows } = await admin.query<{
			id: string;
			effect: string;
			status: string;
			retry_count: number;
			attempt_count: number;
			last_outcome: string | null;
			available_at: Date;
			message_id: string | null;
		}>(
			`select id, effect, status, retry_count, attempt_count, last_outcome, available_at, message_id
			 from approval_delivery_work where workflow_id = $1 order by created_at, effect`,
			[workflowId],
		);
		return rows;
	}

	async function messages(workflowId: string) {
		const { rows } = await admin.query<{
			id: string;
			assignment_id: string;
			approval_request_id: string | null;
			recipient_employee_id: string;
			recipient_user_id: string;
			receiver_scope: string;
			destination_id: string;
			remote_message_id: string;
			binding_id: string | null;
			controls: string;
			state: string;
			status_version: number;
		}>(
			`select * from approval_delivery_message where workflow_id = $1 order by remote_message_id`,
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

	async function openAttention(reason: string) {
		const { rows } = await admin.query<{ id: string; delivery_channel: string | null }>(
			`select id, delivery_channel from approval_escalation_attention
			 where organization_id = $1 and reason = $2 and status = 'open'`,
			[ids.organization, reason],
		);
		return rows;
	}

	const sends = () => calls.filter((call) => call.method === "sendMessage");
	const edits = () => calls.filter((call) => call.method === "editMessageText");
	const buttonsOf = (call: TelegramCall) =>
		(
			call.body.reply_markup as {
				inline_keyboard: Array<Array<{ callback_data?: string; url?: string }>>;
			}
		).inline_keyboard.flat();

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
			throw new Error("Telegram approval delivery PostgreSQL is disabled");
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
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
	});

	it("routes a real submission to one bound card through the committed intent (commit before send)", async () => {
		await seed();
		const { workflowId, assignmentId, requestId } = await submit();

		// The submission committed its intents and only asked for a fast pass;
		// nothing was sent before the owner ran (as after a crash right after commit).
		expect(harness.kicks).toEqual([{ organizationId: ids.organization, workflowId }]);
		expect(sends()).toHaveLength(0);
		const { rows: intents } = await admin.query<{ expansion_status: string }>(
			"select expansion_status from approval_outbox where workflow_id = $1",
			[workflowId],
		);
		expect(intents.length).toBeGreaterThan(0);
		expect(intents.every((row) => row.expansion_status === "pending")).toBe(true);

		const summary = await deliver();
		expect(summary.outcomes).toEqual({ delivered: 1 });
		const card = only(sends());
		expect(card.body.chat_id).toBe(String(MANAGER_CHAT_ID));
		expect(String(card.body.text)).toContain("Absence approval request");
		expect(String(card.body.text)).not.toContain("Private note");
		const callbacks = buttonsOf(card).filter((button) => button.callback_data);
		expect(callbacks).toHaveLength(2);

		const message = only(await messages(workflowId));
		const { rows: bindings } = await admin.query<{ id: string }>(
			"select id from approval_review_binding where assignment_id = $1",
			[assignmentId],
		);
		expect(message).toMatchObject({
			assignment_id: assignmentId,
			approval_request_id: requestId,
			recipient_employee_id: ids.manager,
			recipient_user_id: ids.managerUser,
			receiver_scope: RECEIVER_SCOPE,
			destination_id: String(MANAGER_CHAT_ID),
			remote_message_id: String(nextMessageId - 1),
			binding_id: only(bindings).id,
			controls: "actionable",
			state: "current",
			status_version: await workflowVersion(workflowId),
		});
		expect(only(await work(workflowId))).toMatchObject({
			effect: "initial",
			status: "delivered",
			attempt_count: 1,
		});
		const { rows: expanded } = await admin.query<{ expansion_status: string }>(
			"select expansion_status from approval_outbox where workflow_id = $1",
			[workflowId],
		);
		expect(expanded.every((row) => row.expansion_status === "expanded")).toBe(true);

		// Re-running the owner never sends the same effect again.
		await deliver(minutes(60));
		expect(sends()).toHaveLength(1);
	});

	it("refreshes a delivered card after a web decision; controls never come back", async () => {
		await seed();
		const submitted = await submit();
		const { workflowId } = submitted;
		await deliver();
		const [message] = await messages(workflowId);

		await approveOnWeb(submitted);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		await deliver(minutes(1));

		const edit = only(edits());
		expect(edit.body.message_id).toBe(Number(message?.remote_message_id));
		expect(String(edit.body.text)).toContain("Request approved");
		expect(String(edit.body.text)).toContain("Approved by Morgan Manager");
		expect(buttonsOf(edit).every((button) => !button.callback_data)).toBe(true);
		expect(only(await messages(workflowId))).toMatchObject({
			controls: "none",
			state: "retired",
			status_version: await workflowVersion(workflowId),
		});
		expect((await work(workflowId)).map((row) => [row.effect, row.status])).toEqual([
			["initial", "delivered"],
			["refresh", "delivered"],
		]);

		// A later pass has nothing stale to refresh, and never resends the card.
		await deliver(minutes(10));
		expect(edits()).toHaveLength(1);
		expect(sends()).toHaveLength(1);
	});

	function botConfig() {
		return {
			organizationId: ids.organization,
			botToken: BOT_TOKEN,
			botUsername: "t291_bot",
			webhookSecret: "t291-secret",
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

	async function press(messageId: number, data: string, queryId: string) {
		await handleTelegramUpdate(
			{
				update_id: 5000 + calls.length,
				callback_query: {
					id: queryId,
					from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Morgan" },
					message: {
						message_id: messageId,
						date: 1_790_000_000,
						chat: { id: MANAGER_CHAT_ID, type: "private" as const },
					},
					data,
				},
			},
			botConfig(),
		);
	}

	function approveData(card: TelegramCall): string {
		return (
			buttonsOf(card).find((button) => button.callback_data?.includes('"ba"'))?.callback_data ?? ""
		);
	}

	it("refreshes a card decided from Telegram through the owner as its only writer", async () => {
		await seed();
		const { workflowId } = await submit();
		await deliver();
		const card = only(sends());
		const message = only(await messages(workflowId));

		await press(Number(message.remote_message_id), approveData(card), "t291-q-1");
		const { rows: decided } = await admin.query<{ status: string }>(
			"select status from approval_workflow where id = $1",
			[workflowId],
		);
		expect(only(decided).status).toBe("approved");
		// The acknowledgment reports the outcome; the decided card is left to the owner.
		const answer = only(calls.filter((call) => call.method === "answerCallbackQuery"));
		expect(answer.body.text).toBe("Request approved");
		expect(edits()).toHaveLength(0);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization, workflowId });

		// The decision's committed intent brings it to the current status.
		await deliver(minutes(1));
		expect(only(edits()).body.message_id).toBe(Number(message.remote_message_id));
		expect(only(await messages(workflowId))).toMatchObject({
			controls: "none",
			state: "retired",
			status_version: await workflowVersion(workflowId),
		});
	});

	it("turns a still-pending card whose press decided nothing into a review notice", async () => {
		await seed();
		const { workflowId } = await submit();
		await deliver();
		const card = only(sends());
		const message = only(await messages(workflowId));
		// Actionable cards are paused after sending: a fresh press decides nothing.
		await admin.query(
			`update approval_presentation_control set mode = 'review_only'
			 where organization_id = $1`,
			[ids.organization],
		);

		await press(Number(message.remote_message_id), approveData(card), "t291-q-2");
		const { rows } = await admin.query<{ status: string }>(
			"select status from approval_workflow where id = $1",
			[workflowId],
		);
		expect(only(rows).status).toBe("pending");
		const edit = only(edits());
		expect(String(edit.body.text)).toContain("Review required");
		expect(buttonsOf(edit).every((button) => !button.callback_data)).toBe(true);
		expect(only(await messages(workflowId))).toMatchObject({ controls: "none" });
		// The owner leaves a pending card alone.
		await deliver(minutes(1));
		expect(edits()).toHaveLength(1);
	});

	it("does not let a worker whose lease expired reach the provider", async () => {
		await seed();
		const { workflowId } = await submit();
		await expandApprovalDeliveryIntents({ organizationId: ids.organization, limit: 10 });
		const [stalled] = await claimApprovalDeliveryWork({
			organizationId: ids.organization,
			limit: 10,
			now: T0,
		});
		// Behind slow calls earlier in its batch, the first lease expires and
		// another worker takes the work over.
		const [takeover] = await claimApprovalDeliveryWork({
			organizationId: ids.organization,
			limit: 10,
			now: minutes(3),
		});
		expect(takeover?.id).toBe(stalled?.id);
		if (!stalled || !takeover) throw new Error("Expected both claims");
		await expect(renewApprovalDeliveryLease({ work: stalled, now: minutes(3) })).resolves.toBe(
			false,
		);
		await expect(renewApprovalDeliveryLease({ work: takeover, now: minutes(3) })).resolves.toBe(
			true,
		);
		expect(only(await work(workflowId))).toMatchObject({ status: "processing", attempt_count: 2 });
	});

	it("retries after 1m, 5m, 30m, 2h and 12h, exhausts visibly and recovers only on request", async () => {
		await seed();
		const { workflowId, assignmentId } = await submit();
		const failure = {
			kind: "error" as const,
			status: 502,
			errorCode: 502,
			description: "Bad Gateway",
		};
		script.sendMessage = Array.from({ length: 6 }, () => failure);

		let now = T0;
		await deliver(now);
		const expected = [1, 5, 30, 120, 720];
		for (const [index, wait] of expected.entries()) {
			const [row] = await work(workflowId);
			expect(row).toMatchObject({ status: "pending", retry_count: index + 1 });
			expect(Temporal.Instant.from(row?.available_at.toISOString() ?? "")).toEqual(
				now.add({ minutes: wait }),
			);
			// Not due yet: no attempt.
			await deliver(now.add({ minutes: wait }).subtract({ seconds: 1 }));
			expect(sends()).toHaveLength(index + 1);
			now = now.add({ minutes: wait });
			await deliver(now);
		}
		expect(sends()).toHaveLength(6);
		expect(only(await work(workflowId))).toMatchObject({
			status: "exhausted",
			attempt_count: 6,
			last_outcome: "ambiguous:telegram_502",
		});
		const [incident] = await openAttention("delivery_exhausted");
		expect(incident).toMatchObject({ delivery_channel: "telegram" });
		const { rows: attention } = await admin.query<{ assignment_id: string }>(
			"select assignment_id from approval_escalation_attention where id = $1",
			[incident?.id],
		);
		expect(only(attention).assignment_id).toBe(assignmentId);

		// Nothing happens until explicit recovery.
		await deliver(now.add({ hours: 24 }));
		expect(sends()).toHaveLength(6);

		const recovered = await recoverApprovalDeliveryForAttention({
			organizationId: ids.organization,
			attentionId: incident?.id ?? "",
			actorUserId: ids.managerUser,
			now: now.add({ hours: 25 }),
		});
		expect(recovered.kind).toBe("rearmed");
		await deliver(now.add({ hours: 25 }));
		expect(sends()).toHaveLength(7);
		expect(only(await work(workflowId))).toMatchObject({ status: "delivered", retry_count: 0 });
		expect(await openAttention("delivery_exhausted")).toHaveLength(0);

		// Delivered work is never resent by recovery.
		await expect(
			recoverApprovalDeliveryForAttention({
				organizationId: ids.organization,
				attentionId: incident?.id ?? "",
				actorUserId: ids.managerUser,
			}),
		).resolves.toEqual({ kind: "not_found" });
		expect(sends()).toHaveLength(7);
	});

	it("waits for destination repair and re-arms when the recipient reaches the bot", async () => {
		await seed();
		await admin.query("delete from telegram_conversation where organization_id = $1", [
			ids.organization,
		]);
		const { workflowId } = await submit();

		await deliver();
		expect(sends()).toHaveLength(0);
		expect(only(await work(workflowId))).toMatchObject({
			status: "awaiting_repair",
			last_outcome: "destination_invalid:destination_missing",
		});
		expect(await openAttention("delivery_unavailable")).toHaveLength(1);
		// Waiting for repair consumes no retries.
		await deliver(minutes(24 * 60));
		expect(sends()).toHaveLength(0);

		await saveConversation(String(MANAGER_CHAT_ID), "private", ids.managerUser, ids.organization);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		await deliver(minutes(24 * 60 + 1));
		expect(sends()).toHaveLength(1);
		expect(only(await work(workflowId)).status).toBe("delivered");
		expect(await openAttention("delivery_unavailable")).toHaveLength(0);
	});

	it("treats a blocked bot as an invalid destination, not a transient failure", async () => {
		await seed();
		const { workflowId } = await submit();
		script.sendMessage = [
			{
				kind: "error",
				status: 403,
				errorCode: 403,
				description: "Forbidden: bot was blocked by the user",
			},
		];
		await deliver();
		expect(only(await work(workflowId))).toMatchObject({
			status: "awaiting_repair",
			retry_count: 0,
			last_outcome: "destination_invalid:telegram_403",
		});
	});

	it("honors recipient preferences and integration enablement before sending", async () => {
		await seed();
		await admin.query(
			`insert into notification_preference (user_id, notification_type, channel, enabled, updated_at)
			 values ($1, 'approval_request_submitted', 'telegram', false, now())`,
			[ids.managerUser],
		);
		const first = await submit();
		await deliver();
		expect(only(await work(first.workflowId))).toMatchObject({
			status: "suppressed",
			last_outcome: "preference_disabled",
		});

		await seed({ enableApprovals: false });
		const second = await submit();
		await deliver();
		expect(only(await work(second.workflowId))).toMatchObject({
			status: "suppressed",
			last_outcome: "approvals_disabled",
		});
		expect(sends()).toHaveLength(0);
	});

	it("cancels an initial card whose assignment was decided before it was sent", async () => {
		await seed();
		const submitted = await submit();
		const { workflowId } = submitted;
		await expandApprovalDeliveryIntents({ organizationId: ids.organization, limit: 10 });
		expect(only(await work(workflowId)).status).toBe("pending");

		await approveOnWeb(submitted);
		await deliver();
		expect(sends()).toHaveLength(0);
		expect(only(await work(workflowId))).toMatchObject({
			status: "cancelled",
			last_outcome: "obsolete",
		});
	});

	it("tracks a card that went stale while in flight and retires it", async () => {
		await seed();
		const submitted = await submit();
		const { workflowId } = submitted;
		// The decision commits while Telegram is still accepting the card.
		duringSend = () => approveOnWeb(submitted);

		await deliver();
		const message = only(await messages(workflowId));
		expect(message).toMatchObject({ controls: "actionable" });
		expect(message.status_version).toBeLessThan(await workflowVersion(workflowId));

		await deliver(minutes(1));
		expect(only(edits()).body.message_id).toBe(Number(message.remote_message_id));
		expect(only(await messages(workflowId))).toMatchObject({
			controls: "none",
			state: "retired",
		});
	});

	it("recovers an expired lease; the late send is still tracked and refreshed", async () => {
		await seed();
		const submitted = await submit();
		const { workflowId } = submitted;
		let release!: () => void;
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		let stalled!: () => void;
		const inFlight = new Promise<void>((resolve) => {
			stalled = resolve;
		});
		duringSend = async () => {
			stalled();
			await released;
		};

		// Worker A claims and stalls inside the provider call.
		const workerA = deliver(T0);
		await inFlight;
		// Worker B finds A's lease expired and takes the work over.
		const workerB = await deliver(minutes(3));
		expect(workerB.outcomes).toEqual({ delivered: 1 });
		release();
		const late = await workerA;
		expect(late.outcomes).toEqual({ lease_lost: 1 });

		expect(sends()).toHaveLength(2);
		expect(await messages(workflowId)).toHaveLength(2);
		expect(only(await work(workflowId))).toMatchObject({
			status: "delivered",
			attempt_count: 2,
		});

		await approveOnWeb(submitted);
		await deliver(minutes(4));
		expect(edits()).toHaveLength(2);
		expect((await messages(workflowId)).every((row) => row.controls === "none")).toBe(true);
	});

	it("resends after a crash between send and tracking; both identities cannot be proven", async () => {
		await seed();
		const { workflowId } = await submit();
		await admin.query(`
			create or replace function t291_fail_tracking() returns trigger language plpgsql as $$
			begin raise exception 't291 injected tracking failure'; end $$;
			create trigger t291_fail_tracking before insert on approval_delivery_message
			for each row execute function t291_fail_tracking();
		`);
		try {
			const first = await deliver();
			expect(first.outcomes).toEqual({ retry_scheduled: 1 });
		} finally {
			await admin.query(`
				drop trigger t291_fail_tracking on approval_delivery_message;
				drop function t291_fail_tracking();
			`);
		}
		expect(only(await work(workflowId))).toMatchObject({
			status: "pending",
			last_outcome: "ambiguous:internal_error",
		});
		await deliver(minutes(1));
		// Telegram accepted twice; only the second message's identity is known.
		expect(sends()).toHaveLength(2);
		expect(await messages(workflowId)).toHaveLength(1);
	});

	it("delivers once when workers run concurrently", async () => {
		await seed();
		const { workflowId } = await submit();
		await Promise.all([deliver(), deliver(), deliver()]);
		expect(sends()).toHaveLength(1);
		expect(await messages(workflowId)).toHaveLength(1);
	});

	it("keeps a committed decision when refreshing its cards fails", async () => {
		await seed();
		const submitted = await submit();
		const { workflowId, absenceId } = submitted;
		await deliver();
		script.editMessageText = [{ kind: "network" }];
		await approveOnWeb(submitted);
		await deliver(minutes(1));
		const refresh = (await work(workflowId)).find((row) => row.effect === "refresh");
		expect(refresh).toMatchObject({ status: "pending", last_outcome: "ambiguous:network" });
		const { rows } = await admin.query<{ status: string }>(
			"select status from absence_entry where id = $1",
			[absenceId],
		);
		expect(only(rows).status).toBe("approved");
		await deliver(minutes(2));
		expect(only(await messages(workflowId))).toMatchObject({ controls: "none" });
	});

	it("leaves the existing path alone without a control, and silences it with one", async () => {
		await seed({ control: false });
		const inactive = await submit();
		await deliver();
		const { rows: pending } = await admin.query<{ expansion_status: string }>(
			"select expansion_status from approval_outbox where workflow_id = $1",
			[inactive.workflowId],
		);
		expect(pending.every((row) => row.expansion_status === "pending")).toBe(true);
		expect(await work(inactive.workflowId)).toHaveLength(0);
		const legacyNotice = {
			userId: ids.managerUser,
			organizationId: ids.organization,
			type: "approval_request_submitted" as const,
			title: "New absence request",
			message: "Avery Requester requested Vacation.",
			entityType: "absence_entry",
			entityId: inactive.absenceId,
		};
		await sendTelegramNotification(legacyNotice);
		expect(sends()).toHaveLength(1);

		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ($1, 'absence', 'telegram', '2026-07-01T00:00:00Z')`,
			[ids.organization],
		);
		await sendTelegramNotification(legacyNotice);
		expect(sends()).toHaveLength(1);
	});

	it("privileged cleanup removes and reports delivery work and messages; late tracking cannot recreate them", async () => {
		await seed();
		const { workflowId, assignmentId, requestId } = await submit();
		await deliver();
		const message = only(await messages(workflowId));
		const [deliveryWork] = await work(workflowId);

		const deleted = await deleteApproval(db, ids.organization, workflowId);
		expect(deleted.delivery).toEqual({
			work: [deliveryWork?.id],
			messages: [message.id],
		});
		expect(await messages(workflowId)).toHaveLength(0);
		expect(await work(workflowId)).toHaveLength(0);

		const late = await recordDeliveredApprovalMessage({
			organizationId: ids.organization,
			workflowId,
			stageId: "e2913000-0000-4000-8000-000000000001",
			assignmentId,
			approvalRequestId: requestId,
			recipientEmployeeId: ids.manager,
			recipientUserId: ids.managerUser,
			provider: "telegram",
			receiverScope: RECEIVER_SCOPE,
			destinationId: String(MANAGER_CHAT_ID),
			remoteMessageId: "999999",
			bindingId: null,
			originWorkId: null,
			controls: "actionable",
			statusVersion: 1,
		});
		expect(late).toEqual({ kind: "purged" });
	});
});
