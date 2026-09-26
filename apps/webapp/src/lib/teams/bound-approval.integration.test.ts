/**
 * #293 / T29 runtime evidence: bound Teams absence cards, decided through
 * scoped recorded-activity identity, delivered and refreshed by the approval
 * delivery owner.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * A real canonical absence submission commits its lifecycle intents; the real
 * delivery owner prepares the real Teams card and records the actual message;
 * the real Teams invoke handler (`handleBotActivity`) resolves tenant and user
 * and runs the shared bound attempt into the authoritative decision owner.
 * Replaced: session, billing guard, e-mail and notification fan-out, calendar
 * queue, work-balance marking, the post-commit fast path (so each test drives
 * the owner explicitly), the bot credentials and the Bot Framework connector
 * transport (send/update). Connector JWT authentication happens before
 * `handleBotActivity` in the webhook route and is not exercised here.
 */

import type { TurnContext } from "botbuilder";
import { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const APP_ID = "29300000-0000-4000-8000-00000000a001";
const TENANT_ID = "29300000-0000-4000-8000-00000000b001";

type TeamsFailure =
	| { kind: "failed"; status: number; code: string | null }
	| { kind: "unknown"; reason: "network" | "timeout" };

interface TransportCall {
	method: "send" | "update";
	conversationId: string | undefined;
	activityId?: string;
	activity: Record<string, unknown>;
}

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	kicks: [] as Array<{ organizationId: string; workflowId?: string | null }>,
	calls: [] as TransportCall[],
	nextActivityId: 1,
	script: { send: [] as unknown[], update: [] as unknown[] },
	duringSend: null as null | (() => Promise<void>),
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

vi.mock("@/env", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/env")>();
	const overrides: Record<string, string> = {
		MICROSOFT_APP_ID: "29300000-0000-4000-8000-00000000a001",
		MICROSOFT_APP_PASSWORD: "t293-app-password",
	};
	return {
		...original,
		env: new Proxy(original.env, {
			get: (target, key) =>
				typeof key === "string" && key in overrides ? overrides[key] : Reflect.get(target, key),
		}),
	};
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
	getOrganizationBaseUrl: async () => "https://t293.example.test",
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

vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
		harness.kicks.push(input);
	},
}));

// The Bot Framework connector transport; everything above it is real.
vi.mock("@/lib/teams/bot-adapter", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/teams/bot-adapter")>();
	type Reference = { conversation?: { id?: string } };
	async function send(reference: Reference, activity: Record<string, unknown>) {
		harness.calls.push({
			method: "send",
			conversationId: reference.conversation?.id,
			activity,
		});
		if (harness.duringSend) {
			const hook = harness.duringSend;
			harness.duringSend = null;
			await hook();
		}
		const scripted = harness.script.send.shift() as
			| TeamsFailure
			| { kind: "ok"; activityId: string | null }
			| undefined;
		return (
			scripted ?? { kind: "ok" as const, activityId: `t293-activity-${harness.nextActivityId++}` }
		);
	}
	return {
		...original,
		isBotConfigured: () => true,
		sendActivityWithOutcome: send,
		updateActivityWithOutcome: async (
			reference: Reference,
			activityId: string,
			activity: Record<string, unknown>,
		) => {
			harness.calls.push({
				method: "update",
				conversationId: reference.conversation?.id,
				activityId,
				activity,
			});
			return (harness.script.update.shift() as TeamsFailure | undefined) ?? { kind: "ok" as const };
		},
		sendProactiveMessage: async (reference: Reference, activity: Record<string, unknown>) => {
			const sent = await send(reference, activity);
			return sent.kind === "ok" ? (sent.activityId ?? undefined) : undefined;
		},
	};
});

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { db } = await import("@/db");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { handleBotActivity } = await import("./bot-handler");
const { saveConversationReference } = await import("./conversation-manager");
const { sendApprovalCardToManager } = await import("./approval-handler");
const { sendTeamsNotification } = await import("@/lib/notifications/teams-channel");

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
	describe.skip(`Teams bound approvals PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const MANAGER_AAD_ID = "29300000-0000-4000-8000-00000000c001";
const CONVERSATION_ID = "a:t293-personal-conversation";
const SERVICE_URL = "https://smba.trafficmanager.net/emea/";
const MESSAGE_SCOPE = `teams-bot:${APP_ID}:tenant:${TENANT_ID}`;
const INVOCATION_SCOPE = `${MESSAGE_SCOPE}:conversation:${CONVERSATION_ID}`;
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t293-teams-org",
	requesterUser: "t293-requester-user",
	managerUser: "t293-manager-user",
	requester: "e2930000-0000-4000-8000-000000000001",
	manager: "e2930000-0000-4000-8000-000000000002",
	managerLink: "e2931000-0000-4000-8000-000000000001",
	category: "e2932000-0000-4000-8000-000000000001",
} as const;

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

type Card = {
	body?: Array<{ type: string; text?: string; facts?: Array<{ title: string; value: string }> }>;
	actions?: Array<{ type: string; verb?: string; data?: unknown; url?: string }>;
};

function cardOf(activity: Record<string, unknown>): Card {
	const attachments = activity.attachments as Array<{ content: Card }> | undefined;
	return attachments?.[0]?.content ?? {};
}

function cardText(activity: Record<string, unknown>): string {
	const card = cardOf(activity);
	return JSON.stringify(card.body ?? []);
}

function executeActions(activity: Record<string, unknown>) {
	return (cardOf(activity).actions ?? []).filter((action) => action.type === "Action.Execute");
}

function conversationReference() {
	return {
		activityId: "t293-first-message",
		user: { id: "29:t293-manager", aadObjectId: MANAGER_AAD_ID },
		bot: { id: `28:${APP_ID}`, name: "Z8" },
		conversation: {
			id: CONVERSATION_ID,
			conversationType: "personal",
			tenantId: TENANT_ID,
		},
		channelId: "msteams",
		serviceUrl: SERVICE_URL,
	};
}

interface Turn {
	sent: Array<Record<string, unknown>>;
	updated: Array<Record<string, unknown>>;
	response(): { status: number; body: Record<string, unknown> } | undefined;
}

/** One webhook turn after connector authentication. */
async function turn(activity: Record<string, unknown>): Promise<Turn> {
	const sent: Array<Record<string, unknown>> = [];
	const updated: Array<Record<string, unknown>> = [];
	const context = {
		activity,
		sendActivity: async (reply: Record<string, unknown> | string) => {
			sent.push(typeof reply === "string" ? { type: "message", text: reply } : reply);
			return { id: "t293-reply" };
		},
		updateActivity: async (update: Record<string, unknown>) => {
			updated.push(update);
		},
	} as unknown as TurnContext;
	await handleBotActivity(context);
	return {
		sent,
		updated,
		response: () =>
			sent.find((reply) => reply.type === "invokeResponse")?.value as
				| { status: number; body: Record<string, unknown> }
				| undefined,
	};
}

function press(input: {
	activityId?: string | null;
	cardActivityId: string;
	verb: string | undefined;
	data: unknown;
	trigger?: string;
	overrides?: Record<string, unknown>;
}) {
	return turn({
		type: "invoke",
		name: "adaptiveCard/action",
		...(input.activityId === null ? {} : { id: input.activityId ?? "f:t293-activity" }),
		channelId: "msteams",
		serviceUrl: SERVICE_URL,
		replyToId: input.cardActivityId,
		recipient: { id: `28:${APP_ID}`, name: "Z8" },
		from: { id: "29:t293-manager", aadObjectId: MANAGER_AAD_ID, name: "Morgan Manager" },
		conversation: { id: CONVERSATION_ID, conversationType: "personal", tenantId: TENANT_ID },
		channelData: { tenant: { id: TENANT_ID } },
		value: {
			action: { type: "Action.Execute", verb: input.verb, data: input.data, id: "card-action" },
			trigger: input.trigger ?? "manual",
		},
		...input.overrides,
	});
}

function responseText(result: Turn): unknown {
	return result.response()?.body.value;
}

describeIntegration("Teams bound approval cards (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });

	const sends = () => harness.calls.filter((call) => call.method === "send");
	const updates = () => harness.calls.filter((call) => call.method === "update");

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function cleanup() {
		await admin.query("delete from teams_tenant_config where tenant_id = $1", [TENANT_ID]);
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser],
		]);
	}

	async function seed(options: { deliveryControl?: boolean; conversation?: boolean } = {}) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T293 Teams', $1, $2)`,
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
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 values ($1, 'absence', 'teams', 'actionable')`,
			[ids.organization],
		);
		if (options.deliveryControl ?? true) {
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, 'absence', 'teams', $2)`,
				[ids.organization, timestamp],
			);
		}
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't293-requester@example.test', $3, $3),
			 ($2, 'Morgan Manager', 't293-manager@example.test', $3, $3)`,
			[ids.requesterUser, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'Europe/Berlin', '24h', $2)`,
			[ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't293-member-' || user_id, $1, user_id, 'member', 'approved', $2
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
			`insert into teams_tenant_config
			 (tenant_id, tenant_name, organization_id, setup_status, enable_approvals, updated_at)
			 values ($1, 'T293 tenant', $2, 'active', true, $3)`,
			[TENANT_ID, ids.organization, timestamp],
		);
		await admin.query(
			`insert into teams_user_mapping
			 (user_id, organization_id, teams_user_id, teams_email, teams_tenant_id, is_active, updated_at)
			 values ($1, $2, $3, 't293-manager@example.test', $4, true, $5)`,
			[ids.managerUser, ids.organization, MANAGER_AAD_ID, TENANT_ID, timestamp],
		);
		if (options.conversation ?? true) {
			await admin.query(
				`insert into teams_conversation
				 (organization_id, user_id, conversation_reference, teams_conversation_id,
				  teams_service_url, teams_tenant_id, conversation_type, is_active, updated_at, last_used_at)
				 values ($1, $2, $3, $4, $5, $6, 'personal', true, $7, $7)`,
				[
					ids.organization,
					ids.managerUser,
					JSON.stringify(conversationReference()),
					CONVERSATION_ID,
					SERVICE_URL,
					TENANT_ID,
					timestamp,
				],
			);
		}
	}

	async function submit() {
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

	async function messages(workflowId: string) {
		const { rows } = await admin.query<{
			id: string;
			receiver_scope: string;
			destination_id: string;
			remote_message_id: string;
			binding_id: string | null;
			controls: string;
			state: string;
			status_version: number;
		}>(`select * from approval_delivery_message where workflow_id = $1 order by created_at`, [
			workflowId,
		]);
		return rows;
	}

	async function work(workflowId: string) {
		const { rows } = await admin.query<{
			effect: string;
			status: string;
			retry_count: number;
			last_outcome: string | null;
			available_at: Date;
		}>(
			`select effect, status, retry_count, last_outcome, available_at
			 from approval_delivery_work where workflow_id = $1 order by created_at, effect`,
			[workflowId],
		);
		return rows;
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

	/** Submits, delivers the bound card and returns what a press needs. */
	async function deliveredCard() {
		const submitted = await submit();
		await deliver();
		const sent = only(sends());
		const message = only(await messages(submitted.workflowId));
		const [approve, reject] = executeActions(sent.activity);
		return { ...submitted, sent, message, approve, reject };
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
			throw new Error("Teams bound approval PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
		harness.kicks.length = 0;
		harness.calls.length = 0;
		harness.script.send.length = 0;
		harness.script.update.length = 0;
		harness.duringSend = null;
		harness.nextActivityId = 1;
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
	});

	it("delivers one bound card with its full Teams identity from the committed intent", async () => {
		await seed();
		const { workflowId, assignmentId } = await submit();
		expect(sends()).toHaveLength(0);

		expect((await deliver()).outcomes).toEqual({ delivered: 1 });
		const sent = only(sends());
		expect(sent.conversationId).toBe(CONVERSATION_ID);
		expect(cardText(sent.activity)).toContain("Absence approval request");
		expect(cardText(sent.activity)).toContain("Avery Requester");
		expect(cardText(sent.activity)).not.toContain("Private note");
		const { rows: bindings } = await admin.query<{ id: string }>(
			"select id from approval_review_binding where assignment_id = $1",
			[assignmentId],
		);
		const bindingId = only(bindings).id;
		expect(executeActions(sent.activity)).toEqual([
			expect.objectContaining({ verb: "z8.approval.approve", data: { b: bindingId } }),
			expect.objectContaining({ verb: "z8.approval.reject", data: { b: bindingId } }),
		]);
		const review = (cardOf(sent.activity).actions ?? []).find(
			(action) => action.type === "Action.OpenUrl",
		);
		expect(review?.url).toContain("https://t293.example.test");
		expect(only(await messages(workflowId))).toMatchObject({
			receiver_scope: MESSAGE_SCOPE,
			destination_id: CONVERSATION_ID,
			remote_message_id: "t293-activity-1",
			binding_id: bindingId,
			controls: "actionable",
			state: "current",
		});

		await deliver(minutes(60));
		expect(sends()).toHaveLength(1);
	});

	it("decides once per recorded activity, replays it exactly and leaves the card to the owner", async () => {
		await seed();
		const card = await deliveredCard();
		const bindingId = (card.approve?.data as { b: string } | undefined)?.b;

		const fresh = await press({
			activityId: "f:t293-press-1",
			cardActivityId: card.message.remote_message_id,
			verb: card.approve?.verb,
			data: card.approve?.data,
		});
		expect(fresh.response()).toEqual({
			status: 200,
			body: {
				statusCode: 200,
				type: "application/vnd.microsoft.activity.message",
				value: "Request approved",
			},
		});
		const decided = await counts(card.workflowId);
		expect(decided).toMatchObject({ decisions: "1", invocations: "1", status: "approved" });
		const { rows } = await admin.query(
			`select i.scheme, i.receiver_scope, i.invocation_id, i.delivery_id, i.provider_actor_id,
			        i.actor_employee_id, i.reviewed_binding_id, i.action, i.receipt_idempotency_key,
			        c.state as receipt_state, d.request_outcome
			 from approval_invocation i
			 join approval_decision_evidence d on d.id = i.decision_evidence_id
			 join approval_workflow_command c
			   on c.workflow_id = i.workflow_id and c.idempotency_key = i.receipt_idempotency_key
			 where i.workflow_id = $1`,
			[card.workflowId],
		);
		expect(only(rows)).toMatchObject({
			scheme: "teams_adaptive_card_action",
			receiver_scope: INVOCATION_SCOPE,
			invocation_id: "f:t293-press-1",
			delivery_id: null,
			provider_actor_id: MANAGER_AAD_ID,
			actor_employee_id: ids.manager,
			reviewed_binding_id: bindingId,
			action: "approve",
			receipt_state: "completed",
			request_outcome: "approved",
		});
		expect(only(rows).receipt_idempotency_key).toBe(
			`approval-invocation:v1:teams_adaptive_card_action:${INVOCATION_SCOPE.length}:${INVOCATION_SCOPE}:14:f:t293-press-1`,
		);
		// The decided card has one writer: the owner, from the decision's intent.
		expect(fresh.updated).toHaveLength(0);
		expect(harness.kicks).toContainEqual({
			organizationId: ids.organization,
			workflowId: card.workflowId,
		});
		await deliver(minutes(1));
		const refresh = only(updates());
		expect(refresh.activityId).toBe(card.message.remote_message_id);
		expect(cardText(refresh.activity)).toContain("Request approved");
		expect(cardText(refresh.activity)).toContain("Approved by Morgan Manager");
		expect(executeActions(refresh.activity)).toHaveLength(0);
		expect(only(await messages(card.workflowId))).toMatchObject({
			controls: "none",
			state: "retired",
		});

		// A service retry of the same recorded activity replays; nothing is written.
		const replay = await press({
			activityId: "f:t293-press-1",
			cardActivityId: card.message.remote_message_id,
			verb: card.approve?.verb,
			data: card.approve?.data,
		});
		expect(responseText(replay)).toBe("Request approved");
		expect(await counts(card.workflowId)).toEqual(decided);

		// The same activity carrying a different command is a conflict.
		const conflict = await press({
			activityId: "f:t293-press-1",
			cardActivityId: card.message.remote_message_id,
			verb: card.reject?.verb,
			data: card.reject?.data,
		});
		expect(responseText(conflict)).toBe("Review required");
		expect(await counts(card.workflowId)).toEqual(decided);

		// A new recorded activity gets fresh checks and never matches the old receipt.
		const again = await press({
			activityId: "f:t293-press-2",
			cardActivityId: card.message.remote_message_id,
			verb: card.approve?.verb,
			data: card.approve?.data,
		});
		expect(responseText(again)).toBe("Review required");
		expect(await counts(card.workflowId)).toEqual(decided);
		expect(again.updated).toHaveLength(0);
	});

	it("never decides from an automatic refresh", async () => {
		await seed();
		const card = await deliveredCard();
		const refresh = await press({
			activityId: "f:t293-refresh",
			cardActivityId: card.message.remote_message_id,
			verb: card.approve?.verb,
			data: card.approve?.data,
			trigger: "automatic",
		});
		expect(responseText(refresh)).toBe("Review required");
		expect(refresh.updated).toHaveLength(0);
		expect(await counts(card.workflowId)).toMatchObject({
			decisions: "0",
			invocations: "0",
			status: "pending",
		});
		expect(only(await messages(card.workflowId))).toMatchObject({ controls: "actionable" });
	});

	it("falls back to review without an established activity identity or scope", async () => {
		await seed();
		const card = await deliveredCard();
		const pressWith = (overrides: Record<string, unknown>, activityId?: string | null) =>
			press({
				activityId,
				cardActivityId: card.message.remote_message_id,
				verb: card.approve?.verb,
				data: card.approve?.data,
				overrides,
			});
		// No recorded activity ID: the card message and card action IDs never stand in.
		const missing = await pressWith({}, null);
		expect(responseText(missing)).toBe("Review required");
		// Conflicting tenant fields, another bot, another channel profile.
		await pressWith({ channelData: { tenant: { id: "29300000-0000-4000-8000-00000000b999" } } });
		await pressWith({ recipient: { id: "28:29300000-0000-4000-8000-00000000a999" } });
		await pressWith({ channelId: "webchat" });
		expect(await counts(card.workflowId)).toMatchObject({
			decisions: "0",
			invocations: "0",
			status: "pending",
		});
		// The still-pending card turned into a review notice without controls.
		const update = missing.updated[0];
		expect(update?.id).toBe(card.message.remote_message_id);
		expect(cardText(update ?? {})).toContain("Review required");
		expect(executeActions(update ?? {})).toHaveLength(0);
		expect(only(await messages(card.workflowId))).toMatchObject({ controls: "none" });
	});

	it("revalidates at commit: a web decision, material change or lost membership decides nothing", async () => {
		await seed();
		const decidedOnWeb = await deliveredCard();
		await approveOnWeb(decidedOnWeb);
		const before = await counts(decidedOnWeb.workflowId);
		const stale = await press({
			activityId: "f:t293-stale",
			cardActivityId: decidedOnWeb.message.remote_message_id,
			verb: decidedOnWeb.approve?.verb,
			data: decidedOnWeb.approve?.data,
		});
		expect(responseText(stale)).toBe("Review required");
		expect(await counts(decidedOnWeb.workflowId)).toEqual(before);
		// No longer pending: the owner refreshes it, the webhook does not.
		expect(stale.updated).toHaveLength(0);

		await seed();
		harness.calls.length = 0;
		const changed = await deliveredCard();
		await admin.query("update absence_entry set end_date = '2026-10-09' where id = $1", [
			changed.absenceId,
		]);
		const material = await press({
			activityId: "f:t293-material",
			cardActivityId: changed.message.remote_message_id,
			verb: changed.approve?.verb,
			data: changed.approve?.data,
		});
		expect(responseText(material)).toBe("Review required");
		expect(await counts(changed.workflowId)).toMatchObject({ decisions: "0", invocations: "0" });

		await seed();
		harness.calls.length = 0;
		const departed = await deliveredCard();
		await admin.query(
			"update member set status = 'pending' where organization_id = $1 and user_id = $2",
			[ids.organization, ids.managerUser],
		);
		const lost = await press({
			activityId: "f:t293-membership",
			cardActivityId: departed.message.remote_message_id,
			verb: departed.approve?.verb,
			data: departed.approve?.data,
		});
		// The departed actor no longer resolves to an employee: refused before any attempt.
		expect(lost.response()).toEqual({ status: 401 });
		expect(await counts(departed.workflowId)).toMatchObject({ decisions: "0", invocations: "0" });
	});

	it("keeps old unbound cards historical-only", async () => {
		await seed();
		const card = await deliveredCard();
		const legacy = await turn({
			type: "invoke",
			id: "f:t293-legacy",
			channelId: "msteams",
			recipient: { id: `28:${APP_ID}` },
			from: { id: "29:t293-manager", aadObjectId: MANAGER_AAD_ID },
			conversation: { id: CONVERSATION_ID, conversationType: "personal", tenantId: TENANT_ID },
			value: { action: "approve", approvalId: card.requestId },
		});
		expect(await counts(card.workflowId)).toMatchObject({
			decisions: "0",
			invocations: "0",
			status: "pending",
		});
		expect(legacy.sent.some((reply) => cardText(reply).includes("Review required"))).toBe(true);
	});

	it("waits for a missing conversation and delivers once the recipient reaches the bot", async () => {
		await seed({ conversation: false });
		const { workflowId } = await submit();
		await deliver();
		expect(sends()).toHaveLength(0);
		expect(only(await work(workflowId))).toMatchObject({
			status: "awaiting_repair",
			last_outcome: "destination_invalid:destination_missing",
		});

		const context = {
			activity: {
				type: "message",
				id: "t293-hello",
				channelId: "msteams",
				serviceUrl: SERVICE_URL,
				recipient: { id: `28:${APP_ID}` },
				from: { id: "29:t293-manager", aadObjectId: MANAGER_AAD_ID },
				conversation: { id: CONVERSATION_ID, conversationType: "personal", tenantId: TENANT_ID },
			},
		} as unknown as TurnContext;
		await saveConversationReference(context, ids.managerUser, ids.organization);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		await deliver(minutes(1));
		expect(only(sends()).conversationId).toBe(CONVERSATION_ID);
		expect(only(await work(workflowId)).status).toBe("delivered");
	});

	it("classifies provider failures and keeps a committed decision when its refresh fails", async () => {
		await seed();
		const retried = await submit();
		harness.script.send.push({ kind: "failed", status: 502, code: "BadGateway" });
		await deliver();
		expect(only(await work(retried.workflowId))).toMatchObject({
			status: "pending",
			retry_count: 1,
			last_outcome: "ambiguous:teams_502_BadGateway",
		});
		const [row] = await work(retried.workflowId);
		expect(Temporal.Instant.from(row?.available_at.toISOString() ?? "")).toEqual(minutes(1));

		await seed();
		harness.calls.length = 0;
		const blocked = await submit();
		harness.script.send.push({ kind: "failed", status: 403, code: "ConversationBlockedByUser" });
		await deliver();
		expect(only(await work(blocked.workflowId))).toMatchObject({
			status: "awaiting_repair",
			retry_count: 0,
			last_outcome: "destination_invalid:teams_403_ConversationBlockedByUser",
		});

		await seed();
		harness.calls.length = 0;
		const untracked = await submit();
		harness.script.send.push({ kind: "ok", activityId: null });
		await deliver();
		expect(only(await work(untracked.workflowId))).toMatchObject({
			status: "pending",
			last_outcome: "ambiguous:no_message_identity",
		});
		expect(await messages(untracked.workflowId)).toHaveLength(0);

		await seed();
		harness.calls.length = 0;
		const refreshed = await deliveredCard();
		harness.script.update.push({ kind: "unknown", reason: "network" });
		await approveOnWeb(refreshed);
		await deliver(minutes(1));
		expect(
			(await work(refreshed.workflowId)).find((item) => item.effect === "refresh"),
		).toMatchObject({ status: "pending", last_outcome: "ambiguous:network" });
		const { rows } = await admin.query<{ status: string }>(
			"select status from absence_entry where id = $1",
			[refreshed.absenceId],
		);
		expect(only(rows).status).toBe("approved");
		await deliver(minutes(2));
		expect(only(await messages(refreshed.workflowId))).toMatchObject({ controls: "none" });
	});

	it("tracks a card that went stale in flight and retires it", async () => {
		await seed();
		const submitted = await submit();
		harness.duringSend = () => approveOnWeb(submitted);
		await deliver();
		const message = only(await messages(submitted.workflowId));
		expect(message).toMatchObject({ controls: "actionable" });
		await deliver(minutes(1));
		expect(only(updates()).activityId).toBe(message.remote_message_id);
		expect(only(await messages(submitted.workflowId))).toMatchObject({
			controls: "none",
			state: "retired",
		});
	});

	it("silences the existing Teams path under the owner and keeps it without one", async () => {
		await seed({ deliveryControl: false });
		const inactive = await submit();
		await deliver();
		expect(await work(inactive.workflowId)).toHaveLength(0);
		const notice = {
			userId: ids.managerUser,
			organizationId: ids.organization,
			type: "approval_request_submitted" as const,
			title: "New absence request",
			message: "Avery Requester requested Vacation.",
			entityType: "absence_entry",
			entityId: inactive.absenceId,
		};
		await sendTeamsNotification(notice);
		expect(sends()).toHaveLength(1);

		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ($1, 'absence', 'teams', '2026-07-01T00:00:00Z')`,
			[ids.organization],
		);
		await sendTeamsNotification(notice);
		await sendTeamsNotification({
			...notice,
			entityType: "approval_request",
			entityId: inactive.requestId,
		});
		// Legacy escalation reaches the same sender directly; it stays silent too.
		await sendApprovalCardToManager(inactive.requestId, ids.manager, ids.organization);
		expect(sends()).toHaveLength(1);
	});

	it("sends a card that does not fit one Teams message review-only, without a binding", async () => {
		await seed();
		await admin.query('update "user" set name = $2 where id = $1', [
			ids.requesterUser,
			`Avery ${"Requester ".repeat(3_500)}`,
		]);
		const { workflowId } = await submit();
		await deliver();
		const sent = only(sends());
		expect(executeActions(sent.activity)).toHaveLength(0);
		expect(cardText(sent.activity)).toContain("Review required");
		expect(only(await messages(workflowId))).toMatchObject({ controls: "none", binding_id: null });
		const { rows } = await admin.query(
			"select id from approval_review_binding where workflow_id = $1",
			[workflowId],
		);
		expect(rows).toHaveLength(0);
	});

	it("decides a bound card sent by the existing path and updates that card in place", async () => {
		await seed({ deliveryControl: false });
		const submitted = await submit();
		await sendApprovalCardToManager(submitted.requestId, ids.manager, ids.organization);
		const sent = only(sends());
		const [approve] = executeActions(sent.activity);
		const { rows: tracked } = await admin.query<{ teams_activity_id: string }>(
			"select teams_activity_id from teams_approval_card where approval_request_id = $1",
			[submitted.requestId],
		);
		const cardActivityId = only(tracked).teams_activity_id;

		const result = await press({
			activityId: "f:t293-existing-path",
			cardActivityId,
			verb: approve?.verb,
			data: approve?.data,
		});
		expect(responseText(result)).toBe("Request approved");
		expect(await counts(submitted.workflowId)).toMatchObject({ decisions: "1", invocations: "1" });
		const update = only(result.updated);
		expect(update.id).toBe(cardActivityId);
		expect(cardText(update)).toContain("Approved by Morgan Manager");
		expect(executeActions(update)).toHaveLength(0);
	});

	it("purges the Teams invocation and delivered messages with their lifecycle", async () => {
		await seed();
		const card = await deliveredCard();
		await press({
			activityId: "f:t293-purge",
			cardActivityId: card.message.remote_message_id,
			verb: card.approve?.verb,
			data: card.approve?.data,
		});
		const { rows: invocations } = await admin.query<{ id: string }>(
			"select id from approval_invocation where workflow_id = $1",
			[card.workflowId],
		);
		const deleted = await deleteApproval(db, ids.organization, card.workflowId);
		expect(deleted.evidence.invocations).toEqual([only(invocations).id]);
		expect(deleted.delivery.messages).toEqual([card.message.id]);
		expect(await messages(card.workflowId)).toHaveLength(0);

		// A late retry of the same activity finds nothing to replay or decide.
		const late = await press({
			activityId: "f:t293-purge",
			cardActivityId: card.message.remote_message_id,
			verb: card.approve?.verb,
			data: card.approve?.data,
		});
		expect(responseText(late)).toBe("Review required");
		const { rows: recreated } = await admin.query(
			"select id from approval_invocation where organization_id = $1",
			[ids.organization],
		);
		expect(recreated).toHaveLength(0);
	});
});
