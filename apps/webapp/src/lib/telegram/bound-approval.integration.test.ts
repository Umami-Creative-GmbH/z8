/**
 * #290 / T26 runtime evidence: Telegram absence cards decided through reviewed
 * bindings and bot-scoped callback-query identity.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * A real canonical absence submission captures the submitted revision. The real
 * Telegram preparation/render issues the bound card, and the real webhook update
 * handler decides it through the shared bot attempt, the absence decision owner
 * and the transition engine. Only the request/session, billing guard, e-mail and
 * notification fan-out, calendar queue, work-balance marking and the Telegram
 * HTTP transport (fetch) are replaced.
 */

import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

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
			max: 8,
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
	getOrganizationBaseUrl: async () => "https://t290.example.test",
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

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { approveAbsenceEffect, decideBoundAbsenceInvocation } = await import(
	"@/lib/approvals/server/absence-approvals"
);
const { deleteApproval } = await import("@/lib/approvals/maintenance");
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
	describe.skip(`Telegram bound approval PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const BOT_TOKEN = "290290290:AAT290-bound_card_test";
const OTHER_BOT_TOKEN = "290290291:AAT290-other_org_bot";
const MANAGER_TELEGRAM_ID = 29_001;
const SECOND_TELEGRAM_ID = 29_002;
const MANAGER_CHAT_ID = 290_555;
const SECOND_CHAT_ID = 290_556;

const ids = {
	organization: "t290-bound-org",
	otherOrganization: "t290-other-org",
	requesterUser: "t290-requester-user",
	managerUser: "t290-manager-user",
	secondManagerUser: "t290-second-manager-user",
	finalUser: "t290-final-user",
	requester: "e2900000-0000-4000-8000-000000000001",
	manager: "e2900000-0000-4000-8000-000000000002",
	secondManager: "e2900000-0000-4000-8000-000000000003",
	finalApprover: "e2900000-0000-4000-8000-000000000004",
	managerInOther: "e2900000-0000-4000-8000-000000000005",
	managerLink: "e2901000-0000-4000-8000-000000000001",
	category: "e2902000-0000-4000-8000-000000000001",
	policy: "e2903000-0000-4000-8000-000000000001",
	firstStage: "e2903000-0000-4000-8000-000000000002",
	secondStage: "e2903000-0000-4000-8000-000000000003",
} as const;

const bot = (organizationId: string = ids.organization, botToken = BOT_TOKEN) => ({
	organizationId,
	botToken,
	botUsername: "t290_bot",
	webhookSecret: "t290-secret",
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

describeIntegration("Telegram absence cards with reviewed bindings (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 7000;
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
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.secondManagerUser, ids.finalUser],
		]);
	}

	async function seed(
		options: {
			lifecycle?: "canonical" | "legacy";
			capture?: boolean;
			presentation?: "actionable" | "review_only" | null;
			twoStages?: boolean;
		} = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const lifecycle = options.lifecycle ?? "canonical";
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T290 bound', $1, $3), ($2, 'T290 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', $2, $3, $4, $4)`,
			[ids.organization, lifecycle, lifecycle, timestamp],
		);
		if (options.capture ?? true) {
			await admin.query(
				`insert into approval_evidence_control (organization_id, workflow_type, mode)
				 values ($1, 'absence', 'capture')`,
				[ids.organization],
			);
		}
		const presentation = options.presentation === undefined ? "actionable" : options.presentation;
		if (presentation) {
			await admin.query(
				`insert into approval_presentation_control
				 (organization_id, workflow_type, provider, mode) values ($1, 'absence', 'telegram', $2)`,
				[ids.organization, presentation],
			);
		}
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't290-requester@example.test', $5, $5),
			 ($2, 'Morgan Manager', 't290-manager@example.test', $5, $5),
			 ($3, 'Sam Second', 't290-second@example.test', $5, $5),
			 ($4, 'Frankie Final', 't290-final@example.test', $5, $5)`,
			[ids.requesterUser, ids.managerUser, ids.secondManagerUser, ids.finalUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'de', 'Europe/Berlin', '24h', $2)`,
			[ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't290-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[
				ids.organization,
				timestamp,
				[ids.requesterUser, ids.managerUser, ids.secondManagerUser, ids.finalUser],
			],
		);
		// The manager is also a member of another organization with its own bot.
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t290-member-other-manager', $1, $2, 'member', 'approved', $3)`,
			[ids.otherOrganization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'employee', $12), ($3, $4, $11, 'manager', $12),
			 ($5, $6, $11, 'manager', $12), ($7, $8, $11, 'admin', $12),
			 ($9, $10, $13, 'manager', $12)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.secondManager,
				ids.secondManagerUser,
				ids.finalApprover,
				ids.finalUser,
				ids.managerInOther,
				ids.managerUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
			],
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
		if (options.twoStages) {
			await admin.query(
				`insert into approval_policy
				 (id, organization_id, name, is_active, priority, created_by, updated_at)
				 values ($1, $2, 'T290 two stages', true, 1, $3, $4)`,
				[ids.policy, ids.organization, ids.managerUser, timestamp],
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
					ids.policy,
					ids.finalApprover,
					timestamp,
				],
			);
		}
		// Verified Telegram linkage and private chats (the bot resolves actors
		// from these, never from callback data).
		await admin.query(
			`insert into telegram_user_mapping
			 (user_id, organization_id, telegram_user_id, is_active, updated_at) values
			 ($1, $3, $4, true, $6), ($2, $3, $5, true, $6), ($1, $7, $4, true, $6)`,
			[
				ids.managerUser,
				ids.secondManagerUser,
				ids.organization,
				String(MANAGER_TELEGRAM_ID),
				String(SECOND_TELEGRAM_ID),
				timestamp,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into telegram_conversation
			 (organization_id, user_id, chat_id, chat_type, is_active, updated_at) values
			 ($1, $2, $4, 'private', true, $6), ($1, $3, $5, 'private', true, $6)`,
			[
				ids.organization,
				ids.managerUser,
				ids.secondManagerUser,
				String(MANAGER_CHAT_ID),
				String(SECOND_CHAT_ID),
				timestamp,
			],
		);
	}

	async function submit(
		dates: { startDate: string; endDate: string } = {
			startDate: "2026-08-03",
			endDate: "2026-08-04",
		},
	): Promise<{ absenceId: string; requestId: string; workflowId: string }> {
		actAs(ids.requesterUser);
		const result = await requestAbsenceEffect({
			categoryId: ids.category,
			...dates,
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
			notes: "Private note that stays in authenticated review",
		});
		if (!result.success) throw new Error(`Submission failed: ${result.error}`);
		const { rows } = await admin.query<{ id: string; workflow_id: string | null }>(
			`select r.id, a.approval_workflow_id as workflow_id
			 from approval_request r join absence_entry a on a.id = r.entity_id
			 where r.organization_id = $1 and r.entity_id = $2 and r.status = 'pending'`,
			[ids.organization, result.data.absenceId],
		);
		const request = only(rows);
		harness.userId = null;
		return {
			absenceId: result.data.absenceId,
			requestId: request.id,
			workflowId: request.workflow_id ?? "",
		};
	}

	/** Sends the real initial card and returns what reached Telegram. */
	async function sendCard(requestId: string, approverId: string = ids.manager) {
		const before = calls.length;
		await sendApprovalMessageToManager(requestId, approverId, ids.organization, BOT_TOKEN);
		const sent = calls.slice(before).filter((call) => call.method === "sendMessage");
		const message = only(sent);
		const markup = message.body.reply_markup as {
			inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
		};
		const buttons = markup.inline_keyboard.flat();
		const callbackData = buttons
			.map((button) => button.callback_data)
			.filter((data): data is string => typeof data === "string");
		const tracked = only(
			(
				await admin.query<{ message_id: string }>(
					`select message_id from telegram_approval_message
					 where organization_id = $1 and approval_request_id = $2`,
					[ids.organization, requestId],
				)
			).rows,
		);
		return {
			text: String(message.body.text),
			buttons,
			callbackData,
			messageId: Number(tracked.message_id),
			chatId: Number(message.body.chat_id),
		};
	}

	function callback(options: {
		data: string;
		queryId: string;
		updateId: number;
		messageId: number;
		chatId?: number;
		telegramUserId?: number;
	}) {
		return {
			update_id: options.updateId,
			callback_query: {
				id: options.queryId,
				from: {
					id: options.telegramUserId ?? MANAGER_TELEGRAM_ID,
					is_bot: false,
					first_name: "Morgan",
				},
				message: {
					message_id: options.messageId,
					date: 1_790_000_000,
					chat: { id: options.chatId ?? MANAGER_CHAT_ID, type: "private" as const },
				},
				data: options.data,
			},
		};
	}

	async function press(update: ReturnType<typeof callback>, botConfig = bot()) {
		const before = calls.length;
		await handleTelegramUpdate(update, botConfig);
		const after = calls.slice(before);
		return {
			edits: after.filter((call) => call.method === "editMessageText"),
			answers: after.filter((call) => call.method === "answerCallbackQuery"),
		};
	}

	async function counts(workflowId: string) {
		const { rows } = await admin.query<Record<string, string>>(
			`select
			   (select count(*) from approval_decision_evidence where workflow_id = $1) as decisions,
			   (select count(*) from approval_invocation where workflow_id = $1) as invocations,
			   (select count(*) from approval_workflow_command where workflow_id = $1) as receipts,
			   (select count(*) from approval_workflow_event where workflow_id = $1) as events,
			   (select version from approval_workflow where id = $1) as version,
			   (select status from approval_workflow where id = $1) as status`,
			[workflowId],
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
			throw new Error("Telegram bound approval PostgreSQL is disabled");
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
	});

	it("renders the submitted revision as a localized card bound to the exact assignment", async () => {
		await seed();
		const { requestId, workflowId, absenceId } = await submit();
		const card = await sendCard(requestId);

		expect(card.chatId).toBe(MANAGER_CHAT_ID);
		// Recipient locale (de) and zone; logical dates are not shifted.
		expect(card.text).toContain("Abwesenheitsantrag zur Genehmigung");
		expect(card.text).toContain("Mitarbeiter: Avery Requester");
		expect(card.text).toContain("Kategorie: Vacation");
		expect(card.text).toContain("Zeitraum: 3. Aug. 2026 – 4. Aug. 2026");
		expect(card.text).toContain("Umfang: Ganze Tage");
		expect(card.text).toMatch(/Eingereicht: .+ \(Europe\/Berlin\)/);
		// Free text stays in authenticated review.
		expect(card.text).not.toContain("Private note");
		expect(card.buttons.map((button) => button.text)).toEqual([
			"Genehmigen",
			"Ablehnen",
			"In Z8 prüfen",
		]);
		expect(card.buttons[2]?.url).toBe(
			`https://t290.example.test/approvals/review/${ids.organization}/compatibility/${requestId}`,
		);

		const [approveData] = card.callbackData;
		const bindingId = (JSON.parse(approveData ?? "{}") as { b: string }).b;
		const { rows } = await admin.query(
			`select b.organization_id, b.recipient_employee_id, b.workflow_id, b.stage_id,
			        b.assignment_id, b.submitted_revision_id, a.approver_employee_id,
			        a.status as assignment_status, r.source_id, s.legacy_approval_request_id
			 from approval_review_binding b
			 join approval_stage_assignment a on a.id = b.assignment_id
			 join approval_submitted_revision r on r.id = b.submitted_revision_id
			 join approval_workflow_stage s on s.id = b.stage_id
			 where b.id = $1`,
			[bindingId],
		);
		expect(only(rows)).toMatchObject({
			organization_id: ids.organization,
			recipient_employee_id: ids.manager,
			workflow_id: workflowId,
			approver_employee_id: ids.manager,
			assignment_status: "pending",
			source_id: absenceId,
			legacy_approval_request_id: requestId,
		});
	});

	it("commits one bound decision per callback query and replays it exactly on redelivery", async () => {
		await seed();
		const { requestId, workflowId, absenceId } = await submit();
		const card = await sendCard(requestId);
		const [approveData, rejectData] = card.callbackData;
		const bindingId = (JSON.parse(approveData ?? "{}") as { b: string }).b;
		const first = callback({
			data: approveData ?? "",
			queryId: "t290-query-1",
			updateId: 1001,
			messageId: card.messageId,
		});

		const fresh = await press(first);
		const decided = await counts(workflowId);
		expect(decided).toMatchObject({ decisions: "1", invocations: "1", status: "approved" });
		const { rows: absences } = await admin.query(
			"select status, approved_by from absence_entry where id = $1",
			[absenceId],
		);
		expect(only(absences)).toMatchObject({ status: "approved", approved_by: ids.manager });
		const { rows: associations } = await admin.query(
			`select i.scheme, i.receiver_scope, i.invocation_id, i.delivery_id, i.provider_actor_id,
			        i.actor_employee_id, i.reviewed_binding_id, i.action, i.receipt_idempotency_key,
			        d.receipt_idempotency_key as evidence_key, d.reviewed_binding_id as evidence_binding,
			        d.assignment_outcome, d.request_outcome, d.actor_employee_id as evidence_actor,
			        d.decided_at, c.idempotency_key as receipt_key, c.state as receipt_state
			 from approval_invocation i
			 join approval_decision_evidence d on d.id = i.decision_evidence_id
			 join approval_workflow_command c
			   on c.workflow_id = i.workflow_id and c.idempotency_key = i.receipt_idempotency_key
			 where i.workflow_id = $1`,
			[workflowId],
		);
		const association = only(associations);
		expect(association).toMatchObject({
			scheme: "telegram_callback_query",
			receiver_scope: "telegram-bot:290290290",
			invocation_id: "t290-query-1",
			delivery_id: "1001",
			provider_actor_id: String(MANAGER_TELEGRAM_ID),
			actor_employee_id: ids.manager,
			reviewed_binding_id: bindingId,
			action: "approve",
			evidence_binding: bindingId,
			assignment_outcome: "approved",
			request_outcome: "approved",
			evidence_actor: ids.manager,
			receipt_state: "completed",
		});
		expect(association.receipt_idempotency_key).toBe(
			"approval-invocation:v1:telegram_callback_query:22:telegram-bot:290290290:12:t290-query-1",
		);
		expect(association.evidence_key).toBe(association.receipt_idempotency_key);
		expect(association.receipt_key).toBe(association.receipt_idempotency_key);
		// The card is retired into the committed outcome; provider acknowledgment
		// only reports that outcome.
		expect(only(fresh.edits).body.text).toContain("Antrag genehmigt");
		expect(only(fresh.edits).body.text).toContain("Genehmigt von Morgan Manager am");
		expect(JSON.stringify(only(fresh.edits).body.reply_markup)).not.toContain("callback_data");
		expect(only(fresh.answers).body).toMatchObject({
			callback_query_id: "t290-query-1",
			text: "Antrag genehmigt",
		});

		// Transport redelivery (same update) and a new update carrying the same
		// query both replay the original evidence without any write.
		for (const update of [first, { ...first, update_id: 1002 }]) {
			const replay = await press(update);
			expect(await counts(workflowId)).toEqual(decided);
			expect(only(replay.edits).body.text).toContain("Antrag genehmigt");
			expect(only(replay.edits).body.text).toContain("ursprüngliches Ergebnis");
		}
		const { rows: kept } = await admin.query(
			"select delivery_id, decided_at from approval_invocation i join approval_decision_evidence d on d.id = i.decision_evidence_id where i.workflow_id = $1",
			[workflowId],
		);
		expect(only(kept)).toMatchObject({ delivery_id: "1001", decided_at: association.decided_at });

		// The same query with a different command conflicts; nothing changes.
		const conflict = await press(
			callback({
				data: rejectData ?? "",
				queryId: "t290-query-1",
				updateId: 1003,
				messageId: card.messageId,
			}),
		);
		expect(await counts(workflowId)).toEqual(decided);
		expect(only(conflict.edits).body.text).toContain("bereits mit einer anderen Aktion erfasst");

		// A fresh query gets fresh checks and never falls back to the old receipt.
		const again = await press(
			callback({
				data: approveData ?? "",
				queryId: "t290-query-2",
				updateId: 1004,
				messageId: card.messageId,
			}),
		);
		expect(await counts(workflowId)).toEqual(decided);
		expect(only(again.edits).body.text).toContain("Es wurde keine Entscheidung getroffen");
		expect(only(again.answers).body).toMatchObject({ text: "Prüfung erforderlich" });
	});

	it("rejects through the same path and records the rejection outcome", async () => {
		await seed();
		const { requestId, workflowId, absenceId } = await submit();
		const card = await sendCard(requestId);
		const [, rejectData] = card.callbackData;
		const result = await press(
			callback({
				data: rejectData ?? "",
				queryId: "t290-reject",
				updateId: 2001,
				messageId: card.messageId,
			}),
		);
		expect(await counts(workflowId)).toMatchObject({
			decisions: "1",
			invocations: "1",
			status: "rejected",
		});
		const { rows } = await admin.query(
			"select status, rejection_reason from absence_entry where id = $1",
			[absenceId],
		);
		expect(only(rows)).toMatchObject({ status: "rejected" });
		expect(only(result.edits).body.text).toContain("Antrag abgelehnt");
	});

	it("reports an intermediate approval as recorded, not as final approval", async () => {
		await seed({ twoStages: true });
		const { requestId, workflowId } = await submit();
		const card = await sendCard(requestId);
		const [approveData] = card.callbackData;
		const result = await press(
			callback({
				data: approveData ?? "",
				queryId: "t290-stage-1",
				updateId: 3001,
				messageId: card.messageId,
			}),
		);
		expect(await counts(workflowId)).toMatchObject({
			decisions: "1",
			invocations: "1",
			status: "pending",
		});
		const { rows } = await admin.query(
			"select assignment_outcome, request_outcome from approval_decision_evidence where workflow_id = $1",
			[workflowId],
		);
		expect(only(rows)).toEqual({ assignment_outcome: "approved", request_outcome: "pending" });
		expect(only(result.edits).body.text).toContain("Genehmigung erfasst");
		expect(only(result.edits).body.text).toContain("wartet noch auf weitere Genehmigungen");
	});

	it("revalidates at commit: a web decision or material change after rendering decides nothing", async () => {
		await seed();
		const raced = await submit();
		const racedCard = await sendCard(raced.requestId);
		// Cross-platform decision between rendering and the click.
		actAs(ids.managerUser);
		const web = await approveAbsenceEffect(raced.absenceId, { approvalRequestId: raced.requestId });
		expect(web.success).toBe(true);
		harness.userId = null;
		const afterWeb = await counts(raced.workflowId);
		const racedPress = await press(
			callback({
				data: racedCard.callbackData[0] ?? "",
				queryId: "t290-race",
				updateId: 4001,
				messageId: racedCard.messageId,
			}),
		);
		expect(await counts(raced.workflowId)).toEqual(afterWeb);
		expect(only(racedPress.edits).body.text).toContain("Es wurde keine Entscheidung getroffen");

		await seed();
		const changed = await submit();
		const changedCard = await sendCard(changed.requestId);
		// Material change in place after the card was rendered.
		await admin.query("update absence_entry set end_date = '2026-08-05' where id = $1", [
			changed.absenceId,
		]);
		const before = await counts(changed.workflowId);
		const changedPress = await press(
			callback({
				data: changedCard.callbackData[0] ?? "",
				queryId: "t290-material",
				updateId: 4002,
				messageId: changedCard.messageId,
			}),
		);
		expect(await counts(changed.workflowId)).toEqual(before);
		expect(before).toMatchObject({ status: "pending", decisions: "0" });
		expect(only(changedPress.edits).body.text).toContain("Es wurde keine Entscheidung getroffen");
		// Nothing was bound to the rejected attempt.
		const { rows } = await admin.query(
			"select count(*)::int as count from approval_invocation where organization_id = $1",
			[ids.organization],
		);
		expect(only(rows)).toEqual({ count: 0 });
	});

	it("keeps bindings recipient- and tenant-scoped and requires provider identity", async () => {
		await seed();
		const { requestId, workflowId } = await submit();
		const card = await sendCard(requestId);
		const approveData = card.callbackData[0] ?? "";
		const before = await counts(workflowId);

		// Another linked manager pressing the forwarded card.
		await press(
			callback({
				data: approveData,
				queryId: "t290-other-recipient",
				updateId: 5001,
				messageId: card.messageId,
				chatId: SECOND_CHAT_ID,
				telegramUserId: SECOND_TELEGRAM_ID,
			}),
		);
		// The same Telegram user through another organization's bot.
		await press(
			callback({
				data: approveData,
				queryId: "t290-foreign-bot",
				updateId: 5002,
				messageId: card.messageId,
			}),
			bot(ids.otherOrganization, OTHER_BOT_TOKEN),
		);
		// Missing callback-query identity and an unrecognizable bot identity.
		await press(
			callback({ data: approveData, queryId: "", updateId: 5003, messageId: card.messageId }),
		);
		await press(
			callback({
				data: approveData,
				queryId: "t290-bad-bot",
				updateId: 5004,
				messageId: card.messageId,
			}),
			bot(ids.organization, "not-a-telegram-token"),
		);
		expect(await counts(workflowId)).toEqual(before);
		expect(before).toMatchObject({ status: "pending", decisions: "0", invocations: "0" });
	});

	it("keeps old unbound cards historical-only and review-only for absences", async () => {
		await seed();
		const { requestId, workflowId } = await submit();
		const card = await sendCard(requestId);
		const before = await counts(workflowId);
		const legacy = await press(
			callback({
				data: JSON.stringify({ a: "ap", id: requestId }),
				queryId: "t290-unbound",
				updateId: 6001,
				messageId: card.messageId,
			}),
		);
		expect(await counts(workflowId)).toEqual(before);
		expect(only(legacy.edits).body.text).toContain("Es wurde keine Entscheidung getroffen");
	});

	it("stays review-only until every gate admits the card", async () => {
		const cases = [
			{ presentation: null },
			{ presentation: "review_only" as const },
			{ capture: false },
			{ lifecycle: "legacy" as const },
		];
		for (const gate of cases) {
			await seed(gate);
			const { requestId } = await submit();
			const card = await sendCard(requestId);
			expect(card.callbackData).toEqual([]);
			expect(card.text).toContain("Prüfung erforderlich");
			const { rows } = await admin.query(
				"select count(*)::int as count from approval_review_binding where organization_id = $1",
				[ids.organization],
			);
			expect(only(rows)).toEqual({ count: 0 });
		}
		// Slack has no established invocation identity and can never be admitted.
		await expect(
			admin.query(
				`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
				 values ($1, 'absence', 'slack', 'actionable')`,
				[ids.organization],
			),
		).rejects.toThrow(/approval_presentation_control_slack_check/);
	});

	it("rolls the decision back when the invocation association cannot be written", async () => {
		await seed();
		const { requestId, workflowId, absenceId } = await submit();
		const card = await sendCard(requestId);
		const before = await counts(workflowId);
		await admin.query(`
			create or replace function t290_fail_invocation() returns trigger language plpgsql as $$
			begin
				if new.invocation_id = 't290-fail' then
					raise exception 't290 injected invocation failure';
				end if;
				return new;
			end;
			$$;
			create trigger t290_fail_invocation before insert on approval_invocation
			for each row execute function t290_fail_invocation();
		`);
		try {
			const failed = await press(
				callback({
					data: card.callbackData[0] ?? "",
					queryId: "t290-fail",
					updateId: 7001,
					messageId: card.messageId,
				}),
			);
			expect(await counts(workflowId)).toEqual(before);
			const { rows } = await admin.query("select status from absence_entry where id = $1", [
				absenceId,
			]);
			expect(only(rows)).toEqual({ status: "pending" });
			// Outcome unknown to the adapter: no success is claimed.
			expect(failed.edits).toEqual([]);
			expect(only(failed.answers).body.text).toBeUndefined();
		} finally {
			await admin.query(`
				drop trigger if exists t290_fail_invocation on approval_invocation;
				drop function if exists t290_fail_invocation();
			`);
		}
		// Nothing committed, so a redelivery of the same query decides freshly.
		await press(
			callback({
				data: card.callbackData[0] ?? "",
				queryId: "t290-fail",
				updateId: 7001,
				messageId: card.messageId,
			}),
		);
		expect(await counts(workflowId)).toMatchObject({
			decisions: "1",
			invocations: "1",
			status: "approved",
		});
	});

	it("serializes concurrent deliveries of one query into a single decision", async () => {
		await seed();
		const { requestId, workflowId } = await submit();
		const card = await sendCard(requestId);
		const update = callback({
			data: card.callbackData[0] ?? "",
			queryId: "t290-concurrent",
			updateId: 8001,
			messageId: card.messageId,
		});
		const before = calls.length;
		await Promise.all([
			handleTelegramUpdate(update, bot()),
			handleTelegramUpdate(update, bot()),
			handleTelegramUpdate(update, bot()),
		]);
		expect(await counts(workflowId)).toMatchObject({
			decisions: "1",
			invocations: "1",
			status: "approved",
		});
		const texts = calls
			.slice(before)
			.filter((call) => call.method === "editMessageText")
			.map((call) => String(call.body.text));
		expect(texts).toHaveLength(3);
		expect(texts.every((text) => text.includes("Antrag genehmigt"))).toBe(true);
		// One delivery committed; the others waited and replayed its evidence.
		expect(texts.filter((text) => text.includes("ursprüngliches Ergebnis"))).toHaveLength(2);
	});

	it("purges invocation associations with their lifecycle and cannot recreate them", async () => {
		await seed();
		const { requestId, workflowId } = await submit();
		const card = await sendCard(requestId);
		const update = callback({
			data: card.callbackData[0] ?? "",
			queryId: "t290-purge",
			updateId: 9001,
			messageId: card.messageId,
		});
		await press(update);
		const { rows: before } = await admin.query<{ id: string }>(
			"select id from approval_invocation where workflow_id = $1",
			[workflowId],
		);
		const invocationId = only(before).id;
		const deleted = await deleteApproval(db, ids.organization, workflowId);
		expect(deleted.evidence.invocations).toEqual([invocationId]);
		expect(deleted.evidence.reviewBindings).toHaveLength(1);
		// A late redelivery finds no binding and recreates nothing.
		await press(update);
		const { rows } = await admin.query(
			`select
			   (select count(*)::int from approval_invocation where organization_id = $1) as invocations,
			   (select count(*)::int from approval_decision_evidence where organization_id = $1) as decisions,
			   (select count(*)::int from approval_workflow where organization_id = $1) as workflows`,
			[ids.organization],
		);
		expect(only(rows)).toEqual({ invocations: 0, decisions: 0, workflows: 0 });
	});

	it("rejects updates to invocation associations", async () => {
		await seed();
		const { requestId, workflowId } = await submit();
		const card = await sendCard(requestId);
		await press(
			callback({
				data: card.callbackData[0] ?? "",
				queryId: "t290-immutable",
				updateId: 9101,
				messageId: card.messageId,
			}),
		);
		await expect(
			admin.query("update approval_invocation set delivery_id = 'x' where workflow_id = $1", [
				workflowId,
			]),
		).rejects.toThrow(/immutable/);
	});

	it("pauses cards already sent while committed presses still replay", async () => {
		await seed();
		const decidedCase = await submit();
		const decidedCard = await sendCard(decidedCase.requestId);
		const committed = callback({
			data: decidedCard.callbackData[0] ?? "",
			queryId: "t290-before-pause",
			updateId: 9201,
			messageId: decidedCard.messageId,
		});
		await press(committed);
		const pendingCase = await submit({ startDate: "2026-09-07", endDate: "2026-09-08" });
		const pendingCard = await sendCard(pendingCase.requestId);

		// The adoption writer pauses Telegram after both cards were sent.
		await admin.query(
			`update approval_presentation_control set mode = 'review_only'
			 where organization_id = $1 and workflow_type = 'absence' and provider = 'telegram'`,
			[ids.organization],
		);
		const before = await counts(pendingCase.workflowId);
		const paused = await press(
			callback({
				data: pendingCard.callbackData[0] ?? "",
				queryId: "t290-after-pause",
				updateId: 9202,
				messageId: pendingCard.messageId,
			}),
		);
		expect(await counts(pendingCase.workflowId)).toEqual(before);
		expect(before).toMatchObject({ status: "pending", decisions: "0", invocations: "0" });
		expect(only(paused.edits).body.text).toContain("Es wurde keine Entscheidung getroffen");

		const decidedBefore = await counts(decidedCase.workflowId);
		const replay = await press(committed);
		expect(await counts(decidedCase.workflowId)).toEqual(decidedBefore);
		expect(only(replay.edits).body.text).toContain("ursprüngliches Ergebnis");
	});

	it("replays a committed press without consulting current state and conflicts on another actor", async () => {
		await seed();
		const { requestId, workflowId, absenceId } = await submit();
		const card = await sendCard(requestId);
		const approveData = card.callbackData[0] ?? "";
		const bindingId = (JSON.parse(approveData) as { b: string }).b;
		const update = callback({
			data: approveData,
			queryId: "t290-relinked",
			updateId: 9301,
			messageId: card.messageId,
		});
		await press(update);
		const decided = await counts(workflowId);

		// Current source state moves on: the absence no longer points at the
		// workflow. The committed press still returns its original evidence.
		await admin.query("update absence_entry set approval_workflow_id = null where id = $1", [
			absenceId,
		]);
		const replay = await press(update);
		expect(await counts(workflowId)).toEqual(decided);
		expect(only(replay.edits).body.text).toContain("Antrag genehmigt");
		expect(only(replay.edits).body.text).toContain("ursprüngliches Ergebnis");

		// The same query presented by another actor is a mismatch, not a new
		// operation and not "not found".
		await expect(
			decideBoundAbsenceInvocation({
				database: db,
				organizationId: ids.organization,
				actorEmployeeId: ids.secondManager,
				actorUserId: ids.secondManagerUser,
				bindingId,
				action: "approve",
				invocation: {
					identity: {
						organizationId: ids.organization,
						scheme: "telegram_callback_query",
						schemeVersion: 1,
						receiverScope: "telegram-bot:290290290",
						invocationId: "t290-relinked",
					},
					deliveryId: "9302",
					providerActorId: String(SECOND_TELEGRAM_ID),
				},
			}),
		).resolves.toEqual({ status: "conflict" });
		expect(await counts(workflowId)).toEqual(decided);
	});

	it("issues no binding for a card that does not fit one Telegram message", async () => {
		await seed();
		await admin.query("update absence_category set name = repeat('Vacation ', 600) where id = $1", [
			ids.category,
		]);
		const { requestId } = await submit();
		const card = await sendCard(requestId);
		expect(card.callbackData).toEqual([]);
		expect(card.text).toContain("Prüfung erforderlich");
		const { rows } = await admin.query(
			"select count(*)::int as count from approval_review_binding where organization_id = $1",
			[ids.organization],
		);
		expect(only(rows)).toEqual({ count: 0 });
	});

	it("decides nothing for an actor who is no longer an approved member", async () => {
		await seed();
		const { requestId, workflowId } = await submit();
		const card = await sendCard(requestId);
		const bindingId = (JSON.parse(card.callbackData[0] ?? "{}") as { b: string }).b;
		await admin.query(
			"update member set status = 'pending' where organization_id = $1 and user_id = $2",
			[ids.organization, ids.managerUser],
		);
		const before = await counts(workflowId);
		await press(
			callback({
				data: card.callbackData[0] ?? "",
				queryId: "t290-departed",
				updateId: 9401,
				messageId: card.messageId,
			}),
		);
		await expect(
			decideBoundAbsenceInvocation({
				database: db,
				organizationId: ids.organization,
				actorEmployeeId: ids.manager,
				actorUserId: ids.managerUser,
				bindingId,
				action: "approve",
				invocation: {
					identity: {
						organizationId: ids.organization,
						scheme: "telegram_callback_query",
						schemeVersion: 1,
						receiverScope: "telegram-bot:290290290",
						invocationId: "t290-departed-direct",
					},
					deliveryId: null,
					providerActorId: String(MANAGER_TELEGRAM_ID),
				},
			}),
		).resolves.toEqual({ status: "not_found" });
		expect(await counts(workflowId)).toEqual(before);
		expect(before).toMatchObject({ status: "pending", decisions: "0" });
	});
});
