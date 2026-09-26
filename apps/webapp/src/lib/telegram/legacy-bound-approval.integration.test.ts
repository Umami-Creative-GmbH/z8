/**
 * #384 runtime evidence: Telegram cards for legacy-authoritative absences
 * (rollout `legacy`, `shadow`, `ready`) decided through legacy reviewed
 * bindings, and their cycle-keyed legacy delivery.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * A real legacy absence submission captures the legacy submitted revision. The
 * real Telegram preparation/render (old path or delivery owner) issues the
 * bound card, and the real webhook update handler decides it through the shared
 * bot attempt and the legacy branch of the absence decision owner. Only the
 * request/session, billing guard, e-mail and notification fan-out, calendar
 * queue, work-balance marking, the post-commit delivery fast path and the
 * Telegram HTTP transport (fetch) are replaced.
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
	getOrganizationBaseUrl: async () => "https://t384.example.test",
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
	getOrgSecret: async () => "384384384:AAT384-legacy_card_test",
}));

// The post-commit fast path only runs the owner sooner; tests run it explicitly.
vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
		harness.kicks.push(input);
	},
}));

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { cancelAbsenceRequest } = await import("@/app/[locale]/(app)/absences/mutations");
const { approveAbsenceEffect, rejectAbsenceEffect } = await import(
	"@/lib/approvals/server/absence-approvals"
);
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { prepareApprovalPresentation } = await import("@/lib/approvals/presentation");
const { sendTelegramNotification } = await import("@/lib/notifications/telegram-channel");
const { recordLegacyDeliveryIntent } = await import("@/lib/approvals/delivery/intents");
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
	describe.skip(`Legacy absence bound approval PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const BOT_TOKEN = "384384384:AAT384-legacy_card_test";
const OTHER_BOT_TOKEN = "384384385:AAT384-other_org_bot";
const MANAGER_TELEGRAM_ID = 38_401;
const SECOND_TELEGRAM_ID = 38_402;
const FINAL_TELEGRAM_ID = 38_403;
const MANAGER_CHAT_ID = 384_555;
const SECOND_CHAT_ID = 384_556;
const FINAL_CHAT_ID = 384_557;

const ids = {
	organization: "t384-legacy-org",
	otherOrganization: "t384-other-org",
	requesterUser: "t384-requester-user",
	managerUser: "t384-manager-user",
	secondManagerUser: "t384-second-manager-user",
	finalUser: "t384-final-user",
	requester: "e3840000-0000-4000-8000-000000000001",
	manager: "e3840000-0000-4000-8000-000000000002",
	secondManager: "e3840000-0000-4000-8000-000000000003",
	finalApprover: "e3840000-0000-4000-8000-000000000004",
	managerInOther: "e3840000-0000-4000-8000-000000000005",
	managerLink: "e3841000-0000-4000-8000-000000000001",
	category: "e3842000-0000-4000-8000-000000000001",
	policy: "e3843000-0000-4000-8000-000000000001",
	firstStage: "e3843000-0000-4000-8000-000000000002",
	secondStage: "e3843000-0000-4000-8000-000000000003",
} as const;

type RolloutMode = "legacy" | "shadow" | "ready" | "canonical";

const bot = (organizationId: string = ids.organization, botToken = BOT_TOKEN) => ({
	organizationId,
	botToken,
	botUsername: "t384_bot",
	webhookSecret: "t384-secret",
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

describeIntegration("Legacy absence Telegram cards with reviewed bindings (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 8000;
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

	async function setRollout(mode: RolloutMode) {
		await admin.query(
			`update approval_workflow_rollout set lifecycle_mode = $2, side_effect_mode = $3
			 where organization_id = $1 and workflow_type = 'absence'`,
			[ids.organization, mode, mode === "canonical" ? "canonical" : "legacy"],
		);
	}

	async function seed(
		options: {
			mode?: RolloutMode;
			capture?: boolean;
			presentation?: "actionable" | "review_only" | null;
			twoStages?: boolean;
			delivery?: boolean;
		} = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const mode = options.mode ?? "legacy";
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T384 legacy', $1, $3), ($2, 'T384 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', $2, $3, $4, $4)`,
			[ids.organization, mode, mode === "canonical" ? "canonical" : "legacy", timestamp],
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
		if (options.delivery) {
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, 'absence', 'telegram', $2)`,
				[ids.organization, timestamp],
			);
		}
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't384-requester@example.test', $5, $5),
			 ($2, 'Morgan Manager', 't384-manager@example.test', $5, $5),
			 ($3, 'Sam Second', 't384-second@example.test', $5, $5),
			 ($4, 'Frankie Final', 't384-final@example.test', $5, $5)`,
			[ids.requesterUser, ids.managerUser, ids.secondManagerUser, ids.finalUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'de', 'Europe/Berlin', '24h', $2)`,
			[ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't384-member-' || user_id, $1, user_id, 'member', 'approved', $2
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
			 values ('t384-member-other-manager', $1, $2, 'member', 'approved', $3)`,
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
				 values ($1, $2, 'T384 two stages', true, 1, $3, $4)`,
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
			 ($1, $4, $5, true, $8), ($2, $4, $6, true, $8), ($3, $4, $7, true, $8),
			 ($1, $9, $5, true, $8)`,
			[
				ids.managerUser,
				ids.secondManagerUser,
				ids.finalUser,
				ids.organization,
				String(MANAGER_TELEGRAM_ID),
				String(SECOND_TELEGRAM_ID),
				String(FINAL_TELEGRAM_ID),
				timestamp,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into telegram_conversation
			 (organization_id, user_id, chat_id, chat_type, is_active, updated_at) values
			 ($1, $2, $5, 'private', true, $8), ($1, $3, $6, 'private', true, $8),
			 ($1, $4, $7, 'private', true, $8)`,
			[
				ids.organization,
				ids.managerUser,
				ids.secondManagerUser,
				ids.finalUser,
				String(MANAGER_CHAT_ID),
				String(SECOND_CHAT_ID),
				String(FINAL_CHAT_ID),
				timestamp,
			],
		);
		// The delivery owner's adapter needs the organization's active bot.
		await admin.query(
			`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't384_bot', 't384-secret', 'active', true, false, $2)`,
			[ids.organization, timestamp],
		);
	}

	async function submit(
		dates: { startDate: string; endDate: string } = {
			startDate: "2026-08-03",
			endDate: "2026-08-04",
		},
	): Promise<{ absenceId: string; requestId: string }> {
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
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where organization_id = $1 and entity_id = $2 and status = 'pending'`,
			[ids.organization, result.data.absenceId],
		);
		harness.userId = null;
		return { absenceId: result.data.absenceId, requestId: only(rows).id };
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

	/** Sends the real initial card through the old path and returns what reached Telegram. */
	async function sendCard(requestId: string, approverId: string = ids.manager) {
		const before = calls.length;
		await sendApprovalMessageToManager(requestId, approverId, ids.organization, BOT_TOKEN);
		const sent = calls.slice(before).filter((call) => call.method === "sendMessage");
		const tracked = only(
			(
				await admin.query<{ message_id: string }>(
					`select message_id from telegram_approval_message
					 where organization_id = $1 and approval_request_id = $2`,
					[ids.organization, requestId],
				)
			).rows,
		);
		return { ...parseSent(only(sent)), messageId: Number(tracked.message_id) };
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

	/** Every lifecycle row a legacy decision could write, for "nothing changed" checks. */
	async function state(absenceId: string) {
		const { rows } = await admin.query<Record<string, string>>(
			`select
			   (select status from absence_entry where id = $1) as absence,
			   (select string_agg(status::text, ',' order by created_at) from approval_request
			     where entity_id = $1) as requests,
			   (select count(*) from approval_decision_evidence d
			     join approval_submitted_revision r on r.id = d.submitted_revision_id
			     where r.source_id = $1) as decisions,
			   (select count(*) from approval_invocation i
			     join approval_decision_evidence d on d.id = i.decision_evidence_id
			     join approval_submitted_revision r on r.id = d.submitted_revision_id
			     where r.source_id = $1) as invocations,
			   (select count(*) from approval_workflow where source_id = $1
			     and workflow_type = 'absence' and status <> 'pending') as decided_observations`,
			[absenceId],
		);
		return only(rows);
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

	async function messages(absenceId: string) {
		const { rows } = await admin.query<{
			id: string;
			remote_message_id: string;
			recipient_employee_id: string;
			legacy_approval_request_id: string;
			legacy_cycle_id: string;
			binding_id: string | null;
			controls: string;
			state: string;
			status_version: number;
		}>(
			`select id, remote_message_id, recipient_employee_id, legacy_approval_request_id,
			        legacy_cycle_id, binding_id, controls, state, status_version
			 from approval_delivery_message
			 where legacy_source_id = $1 and lifecycle = 'legacy'
			 order by created_at, id`,
			[absenceId],
		);
		return rows;
	}

	/** The pending-approval notification the existing path sends to the approver. */
	async function oldPathNotification(
		entityId: string,
		entityType: "absence_entry" | "approval_request" = "absence_entry",
	) {
		const before = calls.length;
		await sendTelegramNotification({
			userId: ids.managerUser,
			organizationId: ids.organization,
			type: "approval_request_submitted",
			title: "Absence request",
			message: "Avery Requester requested an absence",
			entityType,
			entityId,
		});
		return calls.slice(before).filter((call) => call.method === "sendMessage");
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
			throw new Error("Legacy absence bound approval PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
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
	});

	for (const mode of ["legacy", "shadow", "ready"] as const) {
		it(`binds a ${mode}-mode card to the exact legacy request and legacy revision`, async () => {
			await seed({ mode });
			const { requestId, absenceId } = await submit();
			const card = await sendCard(requestId);

			expect(card.chatId).toBe(MANAGER_CHAT_ID);
			expect(card.text).toContain("Abwesenheitsantrag zur Genehmigung");
			expect(card.text).toContain("Mitarbeiter: Avery Requester");
			expect(card.text).toContain("Zeitraum: 3. Aug. 2026 – 4. Aug. 2026");
			expect(card.text).not.toContain("Private note");
			expect(card.buttons.map((button) => button.text)).toEqual([
				"Genehmigen",
				"Ablehnen",
				"In Z8 prüfen",
			]);
			expect(card.buttons[2]?.url).toBe(
				`https://t384.example.test/approvals/review/${ids.organization}/compatibility/${requestId}`,
			);
			const { rows } = await admin.query(
				`select b.authority, b.organization_id, b.recipient_employee_id, b.workflow_id,
				        b.stage_id, b.assignment_id, b.legacy_approval_request_id,
				        r.authority as revision_authority, r.source_id, r.legacy_approval_request_id as revision_request
				 from approval_review_binding b
				 join approval_submitted_revision r on r.id = b.submitted_revision_id
				 where b.id = $1`,
				[bindingOf(card.callbackData[0])],
			);
			expect(only(rows)).toEqual({
				authority: "legacy",
				organization_id: ids.organization,
				recipient_employee_id: ids.manager,
				workflow_id: null,
				stage_id: null,
				assignment_id: null,
				legacy_approval_request_id: requestId,
				revision_authority: "legacy",
				source_id: absenceId,
				revision_request: requestId,
			});
		});
	}

	it("sends the unchanged review-only notice and binds nothing when any gate is missing", async () => {
		const gates: Array<{ name: string; options: Parameters<typeof seed>[0] }> = [
			{ name: "no presentation control", options: { presentation: null } },
			{ name: "review_only", options: { presentation: "review_only" } },
			{ name: "capture inactive", options: { capture: false } },
		];
		for (const gate of gates) {
			await seed(gate.options);
			const { requestId } = await submit();
			const card = await sendCard(requestId);
			expect(card.text, gate.name).toContain("Prüfung erforderlich");
			expect(card.callbackData, gate.name).toEqual([]);
			const { rows } = await admin.query(
				"select count(*)::int as count from approval_review_binding where organization_id = $1",
				[ids.organization],
			);
			expect(only(rows), gate.name).toEqual({ count: 0 });
		}

		// A material change after submission: the revision no longer matches.
		await seed();
		const changed = await submit();
		await admin.query("update absence_entry set end_date = '2026-08-05' where id = $1", [
			changed.absenceId,
		]);
		const stale = await sendCard(changed.requestId);
		expect(stale.text).toContain("Prüfung erforderlich");
		expect(stale.callbackData).toEqual([]);

		// Teams shares the bound path but is not admitted for legacy absences,
		// even with an actionable control.
		await admin.query(
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 values ($1, 'absence', 'teams', 'actionable')`,
			[ids.organization],
		);
		const pending = await submit({ startDate: "2026-09-07", endDate: "2026-09-08" });
		const teams = await prepareApprovalPresentation({
			approvalId: pending.requestId,
			recipientEmployeeId: ids.manager,
			organizationId: ids.organization,
			provider: "teams",
		});
		expect(teams.status).toBe("review_required");
		const { rows } = await admin.query(
			"select count(*)::int as count from approval_review_binding where organization_id = $1",
			[ids.organization],
		);
		expect(only(rows)).toEqual({ count: 0 });
	});

	it("commits one legacy decision per callback query and replays it exactly on redelivery", async () => {
		await seed();
		const { requestId, absenceId } = await submit();
		const card = await sendCard(requestId);
		const [approveData, rejectData] = card.callbackData;
		const bindingId = bindingOf(approveData);
		const first = callback({
			data: approveData ?? "",
			queryId: "t384-query-1",
			updateId: 1001,
			messageId: card.messageId,
		});

		const fresh = await press(first);
		const decided = await state(absenceId);
		expect(decided).toMatchObject({
			absence: "approved",
			requests: "approved",
			decisions: "1",
			invocations: "1",
		});
		const { rows: associations } = await admin.query(
			`select i.authority, i.workflow_id, i.legacy_approval_request_id, i.scheme,
			        i.receiver_scope, i.invocation_id, i.delivery_id, i.provider_actor_id,
			        i.actor_employee_id, i.reviewed_binding_id, i.action, i.receipt_idempotency_key,
			        d.authority as evidence_authority, d.receipt_idempotency_key as evidence_key,
			        d.receipt_command_fingerprint, d.reviewed_binding_id as evidence_binding,
			        d.legacy_approval_request_id as evidence_request, d.assignment_outcome,
			        d.request_outcome, d.actor_employee_id as evidence_actor, d.decided_at,
			        r.approved_at
			 from approval_invocation i
			 join approval_decision_evidence d on d.id = i.decision_evidence_id
			 join approval_request r on r.id = d.legacy_approval_request_id
			 where i.organization_id = $1`,
			[ids.organization],
		);
		const association = only(associations);
		expect(association).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			legacy_approval_request_id: requestId,
			scheme: "telegram_callback_query",
			receiver_scope: "telegram-bot:384384384",
			invocation_id: "t384-query-1",
			delivery_id: "1001",
			provider_actor_id: String(MANAGER_TELEGRAM_ID),
			actor_employee_id: ids.manager,
			reviewed_binding_id: bindingId,
			action: "approve",
			evidence_authority: "legacy",
			evidence_binding: bindingId,
			evidence_request: requestId,
			assignment_outcome: "approved",
			request_outcome: "approved",
			evidence_actor: ids.manager,
		});
		// #290's invocation receipt identity; the legacy command fingerprint is unchanged.
		expect(association.receipt_idempotency_key).toBe(
			"approval-invocation:v1:telegram_callback_query:22:telegram-bot:384384384:12:t384-query-1",
		);
		expect(association.evidence_key).toBe(association.receipt_idempotency_key);
		expect(association.receipt_command_fingerprint).toMatch(/^absence-legacy-decision:v1:/);
		expect(association.decided_at).toEqual(association.approved_at);
		expect(only(fresh.edits).body.text).toContain("Antrag genehmigt");
		expect(JSON.stringify(only(fresh.edits).body.reply_markup)).not.toContain("callback_data");
		expect(only(fresh.answers).body).toMatchObject({
			callback_query_id: "t384-query-1",
			text: "Antrag genehmigt",
		});

		// Transport redelivery and a new update carrying the same query replay.
		for (const update of [first, { ...first, update_id: 1002 }]) {
			const replay = await press(update);
			expect(await state(absenceId)).toEqual(decided);
			expect(only(replay.edits).body.text).toContain("ursprüngliches Ergebnis");
		}
		// The same query with a different command conflicts; nothing changes.
		const conflict = await press(
			callback({
				data: rejectData ?? "",
				queryId: "t384-query-1",
				updateId: 1003,
				messageId: card.messageId,
			}),
		);
		expect(await state(absenceId)).toEqual(decided);
		expect(only(conflict.edits).body.text).toContain("bereits mit einer anderen Aktion erfasst");
		// A fresh query gets fresh checks and never falls back to the old receipt.
		const again = await press(
			callback({
				data: approveData ?? "",
				queryId: "t384-query-2",
				updateId: 1004,
				messageId: card.messageId,
			}),
		);
		expect(await state(absenceId)).toEqual(decided);
		expect(only(again.answers).body).toMatchObject({ text: "Prüfung erforderlich" });

		// A semantic web retry never matches the invocation's receipt.
		actAs(ids.managerUser);
		const web = await approveAbsenceEffect(absenceId, { approvalRequestId: requestId });
		expect(web.success).toBe(false);
		expect(await state(absenceId)).toEqual(decided);
	});

	it("rejects through the same path; a rejection time comes from the persisted request", async () => {
		await seed({ mode: "shadow" });
		const { requestId, absenceId } = await submit();
		const card = await sendCard(requestId);
		const result = await press(
			callback({
				data: card.callbackData[1] ?? "",
				queryId: "t384-reject",
				updateId: 2001,
				messageId: card.messageId,
			}),
		);
		expect(await state(absenceId)).toMatchObject({
			absence: "rejected",
			requests: "rejected",
			decisions: "1",
			invocations: "1",
		});
		const { rows } = await admin.query(
			`select d.assignment_outcome, d.request_outcome, d.decided_at = r.updated_at as persisted,
			        d.observed_workflow_id is not null as observed, d.workflow_id
			 from approval_decision_evidence d join approval_request r on r.id = d.legacy_approval_request_id
			 where r.id = $1`,
			[requestId],
		);
		// The shadow observation is recorded as an observation, never as authority.
		expect(only(rows)).toEqual({
			assignment_outcome: "rejected",
			request_outcome: "rejected",
			persisted: true,
			observed: true,
			workflow_id: null,
		});
		expect(only(result.edits).body.text).toContain("Antrag abgelehnt");
	});

	it("records a chain stage as an intermediate step and decides the next stage's own card", async () => {
		// Legacy mode: shadow/ready chain submissions fail before any card exists
		// (sub-millisecond chain timestamps in the observation; pre-existing).
		await seed({ twoStages: true });
		const { requestId, absenceId } = await submit();
		const card = await sendCard(requestId);
		const first = await press(
			callback({
				data: card.callbackData[0] ?? "",
				queryId: "t384-stage-1",
				updateId: 3001,
				messageId: card.messageId,
			}),
		);
		expect(await state(absenceId)).toMatchObject({
			absence: "pending",
			requests: "approved,pending",
			decisions: "1",
			invocations: "1",
		});
		expect(only(first.edits).body.text).toContain("Genehmigung erfasst");
		const { rows: stage } = await admin.query<{ id: string; approver_id: string }>(
			`select id, approver_id from approval_request
			 where entity_id = $1 and status = 'pending'`,
			[absenceId],
		);
		const second = only(stage);
		expect(second.approver_id).toBe(ids.finalApprover);
		// The stage-one card cannot decide the next stage.
		const reused = await press(
			callback({
				data: card.callbackData[0] ?? "",
				queryId: "t384-stage-1-again",
				updateId: 3002,
				messageId: card.messageId,
			}),
		);
		expect(only(reused.answers).body).toMatchObject({ text: "Prüfung erforderlich" });

		const finalCard = await sendCard(second.id, ids.finalApprover);
		const { rows: binding } = await admin.query(
			"select legacy_approval_request_id, submitted_revision_id from approval_review_binding where id = $1",
			[bindingOf(finalCard.callbackData[0])],
		);
		expect(only(binding)).toMatchObject({ legacy_approval_request_id: second.id });
		await press(
			callback({
				data: finalCard.callbackData[0] ?? "",
				queryId: "t384-stage-2",
				updateId: 3003,
				messageId: finalCard.messageId,
				chatId: FINAL_CHAT_ID,
				telegramUserId: FINAL_TELEGRAM_ID,
			}),
		);
		expect(await state(absenceId)).toMatchObject({
			absence: "approved",
			requests: "approved,approved",
			decisions: "2",
			invocations: "2",
		});
		const { rows: outcomes } = await admin.query(
			`select d.request_outcome, d.legacy_chain_stage_id is not null as chain_stage
			 from approval_decision_evidence d
			 join approval_submitted_revision r on r.id = d.submitted_revision_id
			 where r.source_id = $1 order by d.decided_at`,
			[absenceId],
		);
		expect(outcomes).toEqual([
			{ request_outcome: "pending", chain_stage: true },
			{ request_outcome: "approved", chain_stage: true },
		]);
	});

	it("decides nothing for stale, changed, reassigned, foreign or paused presses", async () => {
		await seed();
		const pressOnce = async (
			card: Awaited<ReturnType<typeof sendCard>>,
			queryId: string,
			overrides: { telegramUserId?: number; chatId?: number } = {},
			botConfig = bot(),
		) =>
			press(
				callback({
					data: card.callbackData[0] ?? "",
					queryId,
					updateId: Math.floor(Math.random() * 1_000_000),
					messageId: card.messageId,
					...overrides,
				}),
				botConfig,
			);

		// A web decision between rendering and the press.
		const raced = await submit();
		const racedCard = await sendCard(raced.requestId);
		actAs(ids.managerUser);
		expect(
			(await approveAbsenceEffect(raced.absenceId, { approvalRequestId: raced.requestId })).success,
		).toBe(true);
		harness.userId = null;
		const afterWeb = await state(raced.absenceId);
		const racedPress = await pressOnce(racedCard, "t384-raced");
		expect(await state(raced.absenceId)).toEqual(afterWeb);
		expect(only(racedPress.answers).body).toMatchObject({ text: "Prüfung erforderlich" });

		// An in-place material change after rendering keeps the #288 hold.
		const changed = await submit({ startDate: "2026-08-10", endDate: "2026-08-11" });
		const changedCard = await sendCard(changed.requestId);
		await admin.query("update absence_entry set end_date = '2026-08-12' where id = $1", [
			changed.absenceId,
		]);
		const before = await state(changed.absenceId);
		await pressOnce(changedCard, "t384-changed");
		expect(await state(changed.absenceId)).toEqual(before);

		// Another recipient pressing the manager's card, and the manager through
		// another organization's bot, decide nothing.
		const foreign = await submit({ startDate: "2026-08-17", endDate: "2026-08-18" });
		const foreignCard = await sendCard(foreign.requestId);
		const pending = await state(foreign.absenceId);
		await pressOnce(foreignCard, "t384-other-recipient", {
			telegramUserId: SECOND_TELEGRAM_ID,
			chatId: SECOND_CHAT_ID,
		});
		await pressOnce(foreignCard, "t384-other-org", {}, bot(ids.otherOrganization, OTHER_BOT_TOKEN));
		expect(await state(foreign.absenceId)).toEqual(pending);

		// Reassigned to another approver: the former holder stays an eligible
		// manager of the requester, but a card never reaches that authority.
		await admin.query("update approval_request set approver_id = $2 where id = $1", [
			foreign.requestId,
			ids.secondManager,
		]);
		await pressOnce(foreignCard, "t384-reassigned");
		expect(await state(foreign.absenceId)).toEqual(pending);
		await admin.query("update approval_request set approver_id = $2 where id = $1", [
			foreign.requestId,
			ids.manager,
		]);

		// A committed #299 escalation transfer (the request moved and journaled,
		// as the transfer writes them): the former holder's card decides nothing,
		// and the replacement decides on the web.
		const moved = await submit({ startDate: "2026-09-21", endDate: "2026-09-22" });
		const movedCard = await sendCard(moved.requestId);
		await admin.query("update approval_request set approver_id = $2 where id = $1", [
			moved.requestId,
			ids.secondManager,
		]);
		await admin.query(
			`insert into approval_escalation_transfer
			 (organization_id, operation_key, initiator, authority_mode, workflow_type,
			  legacy_approval_request_id, legacy_source_sequence,
			  source_approver_employee_id, replacement_approver_employee_id, requester_employee_id,
			  receipt_idempotency_key, receipt_actor_fingerprint, receipt_command_fingerprint,
			  request_fingerprint, actor_kind, actor_user_id, actor_employee_id, transferred_at)
			 values ($1, 't384-transfer', 'human', 'legacy', 'absence', $2, 0,
			  $3, $4, $5, 't384-transfer', 'v1', 'v1', 'v1', 'user', $6, $7, now())`,
			[
				ids.organization,
				moved.requestId,
				ids.manager,
				ids.secondManager,
				ids.requester,
				ids.finalUser,
				ids.finalApprover,
			],
		);
		const movedPending = await state(moved.absenceId);
		await pressOnce(movedCard, "t384-transferred");
		expect(await state(moved.absenceId)).toEqual(movedPending);
		actAs(ids.secondManagerUser);
		expect(
			(await approveAbsenceEffect(moved.absenceId, { approvalRequestId: moved.requestId })).success,
		).toBe(true);
		harness.userId = null;
		expect((await state(moved.absenceId)).absence).toBe("approved");

		// Pausing the provider stops fresh presses on sent cards; a committed
		// press still replays.
		const committed = await submit({ startDate: "2026-08-24", endDate: "2026-08-25" });
		const committedCard = await sendCard(committed.requestId);
		await pressOnce(committedCard, "t384-before-pause");
		const committedState = await state(committed.absenceId);
		expect(committedState).toMatchObject({ absence: "approved", invocations: "1" });
		await admin.query(
			`update approval_presentation_control set mode = 'review_only'
			 where organization_id = $1 and workflow_type = 'absence' and provider = 'telegram'`,
			[ids.organization],
		);
		const paused = await pressOnce(foreignCard, "t384-paused");
		expect(await state(foreign.absenceId)).toEqual(pending);
		expect(only(paused.edits).body.text).toContain("Es wurde keine Entscheidung getroffen");
		const replay = await press(
			callback({
				data: committedCard.callbackData[0] ?? "",
				queryId: "t384-before-pause",
				updateId: 4242,
				messageId: committedCard.messageId,
			}),
		);
		expect(await state(committed.absenceId)).toEqual(committedState);
		expect(only(replay.edits).body.text).toContain("ursprüngliches Ergebnis");

		// The same card decides once the provider is admitted again.
		await admin.query(
			`update approval_presentation_control set mode = 'actionable'
			 where organization_id = $1 and workflow_type = 'absence' and provider = 'telegram'`,
			[ids.organization],
		);
		await pressOnce(foreignCard, "t384-readmitted");
		expect(await state(foreign.absenceId)).toMatchObject({ absence: "approved", invocations: "1" });
	});

	it("never decides under the other authority after a cutover between render and press", async () => {
		// legacy → canonical
		await seed();
		const legacy = await submit();
		const legacyCard = await sendCard(legacy.requestId);
		const before = await state(legacy.absenceId);
		await setRollout("canonical");
		const toCanonical = await press(
			callback({
				data: legacyCard.callbackData[0] ?? "",
				queryId: "t384-cutover-1",
				updateId: 5001,
				messageId: legacyCard.messageId,
			}),
		);
		expect(await state(legacy.absenceId)).toEqual(before);
		expect(only(toCanonical.answers).body).toMatchObject({ text: "Prüfung erforderlich" });

		// canonical → legacy: a canonical binding decides nothing under legacy authority.
		await seed({ mode: "canonical" });
		const canonical = await submit();
		const canonicalCard = await sendCard(canonical.requestId);
		const { rows } = await admin.query(
			"select authority from approval_review_binding where id = $1",
			[bindingOf(canonicalCard.callbackData[0])],
		);
		expect(only(rows)).toEqual({ authority: "canonical" });
		const pendingCanonical = await state(canonical.absenceId);
		await setRollout("legacy");
		await press(
			callback({
				data: canonicalCard.callbackData[0] ?? "",
				queryId: "t384-cutover-2",
				updateId: 5002,
				messageId: canonicalCard.messageId,
			}),
		);
		expect(await state(canonical.absenceId)).toEqual(pendingCanonical);
	});

	it("rolls back the whole decision when the invocation cannot be written, and serializes concurrent deliveries", async () => {
		await seed();
		const { requestId, absenceId } = await submit();
		const card = await sendCard(requestId);
		const before = await state(absenceId);
		await admin.query(`
			create or replace function t384_fail_invocation() returns trigger language plpgsql as $$
			begin
				if new.invocation_id = 't384-fail' then
					raise exception 't384 injected invocation failure';
				end if;
				return new;
			end;
			$$;
			create trigger t384_fail_invocation before insert on approval_invocation
			for each row execute function t384_fail_invocation();
		`);
		const update = callback({
			data: card.callbackData[0] ?? "",
			queryId: "t384-fail",
			updateId: 7001,
			messageId: card.messageId,
		});
		try {
			const failed = await press(update);
			// Legacy request, absence, evidence and invocation roll back together.
			expect(await state(absenceId)).toEqual(before);
			expect(failed.edits).toEqual([]);
			expect(only(failed.answers).body.text).toBeUndefined();
		} finally {
			await admin.query(`
				drop trigger if exists t384_fail_invocation on approval_invocation;
				drop function if exists t384_fail_invocation();
			`);
		}
		// Nothing committed: three concurrent redeliveries decide exactly once.
		const start = calls.length;
		await Promise.all([
			handleTelegramUpdate(update, bot()),
			handleTelegramUpdate(update, bot()),
			handleTelegramUpdate(update, bot()),
		]);
		expect(await state(absenceId)).toMatchObject({
			absence: "approved",
			requests: "approved",
			decisions: "1",
			invocations: "1",
		});
		const texts = calls
			.slice(start)
			.filter((call) => call.method === "editMessageText")
			.map((call) => String(call.body.text));
		expect(texts).toHaveLength(3);
		expect(texts.filter((text) => text.includes("ursprüngliches Ergebnis"))).toHaveLength(2);
	});

	it("delivers the cycle's card through the owner, silences the old path and refreshes after a press", async () => {
		// Without a delivery control nothing is recorded and the old path notifies.
		await seed();
		const unowned = await submit();
		const { rows: noIntents } = await admin.query(
			"select count(*)::int as count from approval_delivery_intent where organization_id = $1",
			[ids.organization],
		);
		expect(only(noIntents)).toEqual({ count: 0 });
		expect(await oldPathNotification(unowned.absenceId)).toHaveLength(1);

		await seed({ delivery: true });
		const { absenceId, requestId } = await submit();
		const { rows: intents } = await admin.query(
			`select event, legacy_approval_request_id, legacy_cycle_id, workflow_type, source_id
			 from approval_delivery_intent where organization_id = $1`,
			[ids.organization],
		);
		expect(intents).toEqual([
			{
				event: "submitted",
				legacy_approval_request_id: requestId,
				legacy_cycle_id: requestId,
				workflow_type: "absence",
				source_id: absenceId,
			},
		]);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		// The owner delivers this cycle: the old path sends neither card nor message.
		expect(await oldPathNotification(absenceId)).toEqual([]);
		expect(await oldPathNotification(requestId, "approval_request")).toEqual([]);

		const initial = await runOwner();
		const card = only(initial.sent);
		expect(card.chatId).toBe(MANAGER_CHAT_ID);
		expect(card.text).toContain("Abwesenheitsantrag zur Genehmigung");
		expect(card.buttons.map((button) => button.text)).toEqual([
			"Genehmigen",
			"Ablehnen",
			"In Z8 prüfen",
		]);
		const [message] = await messages(absenceId);
		expect(message).toMatchObject({
			recipient_employee_id: ids.manager,
			legacy_approval_request_id: requestId,
			legacy_cycle_id: requestId,
			binding_id: bindingOf(card.callbackData[0]),
			controls: "actionable",
			state: "current",
			status_version: 1,
		});
		// A second pass sends nothing new.
		expect((await runOwner()).sent).toEqual([]);

		harness.kicks.length = 0;
		const pressed = await press(
			callback({
				data: card.callbackData[0] ?? "",
				queryId: "t384-owner-press",
				updateId: 6001,
				messageId: Number(message?.remote_message_id),
			}),
		);
		// The webhook acknowledges; the decided card has one writer, the owner.
		expect(pressed.edits).toEqual([]);
		expect(only(pressed.answers).body).toMatchObject({ text: "Antrag genehmigt" });
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		const refreshed = await runOwner();
		const edit = only(refreshed.edits);
		expect(edit.body.text).toContain("Antrag genehmigt");
		expect(JSON.stringify(edit.body.reply_markup ?? {})).not.toContain("callback_data");
		expect(await messages(absenceId)).toMatchObject([
			{ controls: "none", state: "retired", status_version: 2 },
		]);
		expect((await runOwner()).edits).toEqual([]);
	});

	it("refreshes owner-delivered cards after web decisions and walks a chain stage by stage", async () => {
		await seed({ delivery: true, twoStages: true });
		const { absenceId, requestId } = await submit();
		const first = only((await runOwner()).sent);
		expect(first.chatId).toBe(MANAGER_CHAT_ID);

		// Stage one on the web: the stage-one card refreshes and the final
		// approver gets the next stage's own card, in the same cycle.
		actAs(ids.managerUser);
		expect((await approveAbsenceEffect(absenceId, { approvalRequestId: requestId })).success).toBe(
			true,
		);
		harness.userId = null;
		const afterStageOne = await runOwner();
		expect(only(afterStageOne.edits).body.text).toContain("Genehmigung erfasst");
		const second = only(afterStageOne.sent);
		expect(second.chatId).toBe(FINAL_CHAT_ID);
		const { rows: chains } = await admin.query<{ id: string }>(
			"select id from approval_chain_instance where entity_id = $1",
			[absenceId],
		);
		const chainId = only(chains).id;
		expect((await messages(absenceId)).map((row) => row.legacy_cycle_id)).toEqual([
			chainId,
			chainId,
		]);

		// Stage two rejected on the web: both cards reach the final status.
		const { rows: stage } = await admin.query<{ id: string }>(
			"select id from approval_request where entity_id = $1 and status = 'pending'",
			[absenceId],
		);
		actAs(ids.finalUser);
		expect(
			(
				await rejectAbsenceEffect(absenceId, "Overlaps a release", {
					approvalRequestId: only(stage).id,
				})
			).success,
		).toBe(true);
		harness.userId = null;
		const final = await runOwner();
		// The stage-one card keeps its own step and states the request's outcome;
		// the final approver (no settings) reads the default locale.
		const texts = Object.fromEntries(
			final.edits.map((call) => [String(call.body.chat_id), String(call.body.text)]),
		);
		expect(Object.keys(texts).sort()).toEqual(
			[String(MANAGER_CHAT_ID), String(FINAL_CHAT_ID)].sort(),
		);
		expect(texts[String(MANAGER_CHAT_ID)]).toContain("Genehmigung erfasst");
		expect(texts[String(MANAGER_CHAT_ID)]).toContain("Aktueller Stand des Antrags: abgelehnt");
		expect(texts[String(FINAL_CHAT_ID)]).toContain("Request rejected");
		expect(texts[String(FINAL_CHAT_ID)]).toContain("Rejected by Frankie Final");
		expect((await messages(absenceId)).map((row) => row.status_version)).toEqual([3, 3]);
	});

	it("withdraws a cancelled cycle's cards and keeps its history until privileged cleanup", async () => {
		await seed({ delivery: true });
		const { absenceId, requestId } = await submit();
		const card = only((await runOwner()).sent);
		const { rows: revisions } = await admin.query<{ id: string }>(
			"select id from approval_submitted_revision where source_id = $1",
			[absenceId],
		);
		const revisionId = only(revisions).id;

		actAs(ids.requesterUser);
		expect(await cancelAbsenceRequest(absenceId)).toMatchObject({ success: true });
		harness.userId = null;
		const { rows: requests } = await admin.query(
			"select id from approval_request where entity_id = $1",
			[absenceId],
		);
		expect(requests).toEqual([]);
		const withdrawn = await runOwner();
		expect(only(withdrawn.edits).body.text).toContain("zurückgezogen");
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
		const late = await press(
			callback({
				data: card.callbackData[0] ?? "",
				queryId: "t384-withdrawn",
				updateId: 6101,
				messageId: Number((await messages(absenceId))[0]?.remote_message_id),
			}),
		);
		expect(only(late.answers).body).toMatchObject({ text: "Prüfung erforderlich" });

		const deleted = await deleteApproval(db, ids.organization, revisionId);
		expect(deleted.evidence.submittedRevisions).toEqual([revisionId]);
		expect(deleted.evidence.reviewBindings).toHaveLength(1);
		expect(deleted.delivery.work).toHaveLength(2);
		expect(deleted.delivery.messages).toHaveLength(1);
		expect(deleted.delivery.intents).toHaveLength(2);
		expect(await survivors()).toEqual({ bindings: 0, work: 0, messages: 0, intents: 0 });
		// A redelivered press after the purge recreates nothing.
		await press(
			callback({
				data: card.callbackData[0] ?? "",
				queryId: "t384-withdrawn",
				updateId: 6102,
				messageId: Number(deleted.delivery.messages.length),
			}),
		);
		expect(await survivors()).toEqual({ bindings: 0, work: 0, messages: 0, intents: 0 });
	});

	it("purges exactly a decided cycle's bindings, invocations and delivery rows and reports them", async () => {
		await seed({ delivery: true });
		const kept = await submit({ startDate: "2026-09-14", endDate: "2026-09-15" });
		const { absenceId, requestId } = await submit();
		const sent = (await runOwner()).sent;
		expect(sent).toHaveLength(2);
		const [message] = await messages(absenceId);
		const card = sent.find(
			(candidate) => bindingOf(candidate.callbackData[0]) === message?.binding_id,
		);
		const update = callback({
			data: card?.callbackData[0] ?? "",
			queryId: "t384-purge",
			updateId: 6201,
			messageId: Number(message?.remote_message_id),
		});
		await press(update);
		await runOwner();
		const { rows: invocations } = await admin.query<{ id: string }>(
			"select id from approval_invocation where legacy_approval_request_id = $1",
			[requestId],
		);
		const deleted = await deleteApproval(db, ids.organization, requestId);
		expect(deleted.legacyRequests).toEqual([requestId]);
		expect(deleted.evidence.invocations).toEqual([only(invocations).id]);
		expect(deleted.evidence.reviewBindings).toEqual([message?.binding_id]);
		expect(deleted.delivery.messages).toEqual([message?.id]);
		expect(deleted.delivery.intents).toHaveLength(2);
		expect(await messages(absenceId)).toEqual([]);
		// The other cycle and the business record are preserved.
		expect(await messages(kept.absenceId)).toHaveLength(1);
		expect((await state(absenceId)).absence).toBe("approved");
		// A late redelivery of the purged press recreates nothing.
		await press(update);
		const { rows: after } = await admin.query(
			"select count(*)::int as count from approval_invocation where legacy_approval_request_id = $1",
			[requestId],
		);
		expect(only(after)).toEqual({ count: 0 });
	});

	it("delivers, versions and refreshes two cycles of one source independently", async () => {
		// Absences create one cycle per source; time kinds (#432) will create
		// several. The second cycle is seeded here as a new legacy request of the
		// same source with its own intent. Capture stays off, so neither cycle
		// has a revision and both cards are review-only notices.
		await seed({ delivery: true, capture: false });
		const { absenceId, requestId } = await submit();
		expect(only((await runOwner()).sent).chatId).toBe(MANAGER_CHAT_ID);
		actAs(ids.managerUser);
		expect((await approveAbsenceEffect(absenceId, { approvalRequestId: requestId })).success).toBe(
			true,
		);
		harness.userId = null;
		expect((await runOwner()).edits).toHaveLength(1);

		const { rows: second } = await admin.query<{ id: string }>(
			`insert into approval_request
			 (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
			 values ($1, 'absence_entry', $2, $3, $4, 'pending', now()) returning id`,
			[ids.organization, absenceId, ids.requester, ids.secondManager],
		);
		const secondId = only(second).id;
		// The source is pending again, as a resubmission leaves it.
		await admin.query(
			"update absence_entry set status = 'pending', approved_by = null, approved_at = null where id = $1",
			[absenceId],
		);
		await recordLegacyDeliveryIntent(db, {
			organizationId: ids.organization,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: absenceId,
			approvalRequestId: secondId,
			cycleId: secondId,
			event: "submitted",
		});
		// The second cycle gets its own card; the first cycle's card is untouched.
		const initial = await runOwner();
		expect(only(initial.sent).chatId).toBe(SECOND_CHAT_ID);
		expect(initial.edits).toEqual([]);

		// Deciding the second cycle refreshes only its card: a source-scoped
		// version would have moved the first cycle's card again.
		actAs(ids.secondManagerUser);
		expect((await approveAbsenceEffect(absenceId, { approvalRequestId: secondId })).success).toBe(
			true,
		);
		harness.userId = null;
		const refreshed = await runOwner();
		expect(only(refreshed.edits).body.chat_id).toBe(String(SECOND_CHAT_ID));
		const versions = Object.fromEntries(
			(await messages(absenceId)).map((row) => [row.legacy_cycle_id, row.status_version]),
		);
		expect(versions).toEqual({ [requestId]: 2, [secondId]: 2 });
		expect((await runOwner()).edits).toEqual([]);
	});

	for (const mode of ["shadow", "ready"] as const) {
		it(`delivers, decides and refreshes a ${mode}-mode card under legacy authority`, async () => {
			await seed({ mode, delivery: true });
			const { absenceId, requestId } = await submit();
			const card = only((await runOwner()).sent);
			const [message] = await messages(absenceId);
			expect(message).toMatchObject({
				legacy_cycle_id: requestId,
				binding_id: bindingOf(card.callbackData[0]),
			});
			const pressed = await press(
				callback({
					data: card.callbackData[1] ?? "",
					queryId: `t384-${mode}-press`,
					updateId: 6301,
					messageId: Number(message?.remote_message_id),
				}),
			);
			expect(only(pressed.answers).body).toMatchObject({ text: "Antrag abgelehnt" });
			expect(await state(absenceId)).toMatchObject({
				absence: "rejected",
				requests: "rejected",
				decisions: "1",
				invocations: "1",
			});
			// The mirrored observation follows; it never became the authority.
			const { rows } = await admin.query(
				`select d.workflow_id, d.observed_workflow_id is not null as observed
				 from approval_decision_evidence d where d.legacy_approval_request_id = $1`,
				[requestId],
			);
			expect(only(rows)).toEqual({ workflow_id: null, observed: true });
			const refreshed = await runOwner();
			expect(only(refreshed.edits).body.text).toContain("Antrag abgelehnt");
			expect(await messages(absenceId)).toMatchObject([
				{ controls: "none", state: "retired", status_version: 2 },
			]);
		});
	}
});
