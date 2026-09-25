/**
 * #294 / T30 runtime evidence: Slack review-only initial and status delivery
 * through the approval delivery owner.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * A real canonical absence submission commits its lifecycle intents with the
 * workflow. The real owner expands them, prepares the shared presentation and
 * sends through the real Slack Web API client; real web and Telegram decisions
 * commit refresh intents, and real Slack interactions and account linking run
 * through their handlers. Only the request/session, billing guard, e-mail and
 * notification fan-out, calendar queue, work-balance marking, the vault, the
 * post-commit fast path (so each test drives the owner explicitly) and the
 * HTTP transport (fetch, below both provider clients) are replaced.
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
	getOrganizationBaseUrl: async () => "https://t294.example.test",
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
	getOrgSecret: async (_organizationId: string, key: string) =>
		key.startsWith("slack/") ? "xoxb-t294-delivery-owner-test" : "294294294:AAT294-delivery_owner",
}));

// The best-effort fast path only runs the owner sooner; recording the calls
// keeps each test's delivery passes explicit and deterministic.
vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
		harness.kicks.push(input);
	},
}));

const TELEGRAM_BOT_TOKEN = "294294294:AAT294-delivery_owner";

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { db } = await import("@/db");
const { processApprovalDeliveries } = await import("./owner");
const { expandApprovalDeliveryIntents } = await import("./store");
const { recoverApprovalDeliveryForAttention } = await import("./recovery");
const { handleInteraction } = await import("@/lib/slack/bot-handler");
const { getBotConfigByOrganization } = await import("@/lib/slack/bot-config");
const { saveConversation } = await import("@/lib/slack/conversation-manager");
const { claimLinkCode } = await import("@/lib/slack/user-resolver");
const { sendSlackNotification } = await import("@/lib/notifications/slack-channel");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const telegramConversations = await import("@/lib/telegram/conversation-manager");
const { formatInstant } = await import("@/lib/datetime/temporal-format");

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
	describe.skip(`Slack approval delivery PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const SLACK_TEAM_ID = "T294TEAM";
const MANAGER_SLACK_ID = "U294MANAGER";
const MANAGER_DM = "D294MANAGER";
const OPENED_DM = "D294OPENED";
const RECEIVER_SCOPE = `slack-team:${SLACK_TEAM_ID}`;
const MANAGER_TELEGRAM_ID = 29_401;
const MANAGER_TELEGRAM_CHAT = 294_555;
// Pinned pass time. New work becomes due at the database's now(), so the
// pinned clock must lie after the real time the test runs at.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t294-delivery-org",
	requesterUser: "t294-requester-user",
	managerUser: "t294-manager-user",
	requester: "e2940000-0000-4000-8000-000000000001",
	manager: "e2940000-0000-4000-8000-000000000002",
	managerLink: "e2941000-0000-4000-8000-000000000001",
	category: "e2942000-0000-4000-8000-000000000001",
} as const;

interface ProviderCall {
	provider: "slack" | "telegram";
	method: string;
	body: Record<string, unknown>;
}

type SlackResponse =
	| { kind: "ok" }
	| { kind: "platform"; error: string }
	| { kind: "http"; status: number }
	| { kind: "rate_limited" }
	| { kind: "network" };

type SlackBlock = {
	type: string;
	text?: { type: string; text: string };
	elements?: Array<{ action_id?: string; url?: string; type: string }>;
};

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

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

describeIntegration("Slack approval delivery owner (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });
	const calls: ProviderCall[] = [];
	let nextTs = 1_790_000_000;
	let nextTelegramMessageId = 9400;
	const originalFetch = globalThis.fetch;
	/** Per-method scripted Slack responses; anything unscripted succeeds. */
	const script: Record<string, SlackResponse[]> = {};
	/** Runs while a chat.postMessage is in flight, before Slack "answers". */
	let duringPost: (() => Promise<void>) | null = null;

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	/** Both providers' HTTP transport; their clients and everything above are real. */
	function installTransport() {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const telegram = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
			if (telegram) {
				const method = telegram[1] ?? "";
				const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
				calls.push({ provider: "telegram", method, body });
				const result =
					method === "sendMessage"
						? {
								message_id: nextTelegramMessageId++,
								date: 1_790_000_000,
								chat: { id: Number(body.chat_id), type: "private" },
								text: body.text,
							}
						: true;
				return json({ ok: true, result });
			}
			const slack = /^https:\/\/slack\.com\/api\/([\w.]+)$/.exec(url);
			if (!slack) throw new Error(`Unexpected fetch in test: ${url}`);
			const method = slack[1] ?? "";
			const body: Record<string, unknown> = Object.fromEntries(
				new URLSearchParams(String(init?.body ?? "")),
			);
			if (typeof body.blocks === "string") body.blocks = JSON.parse(body.blocks);
			calls.push({ provider: "slack", method, body });
			if (method === "chat.postMessage" && duringPost) {
				const hook = duringPost;
				duringPost = null;
				await hook();
			}
			const scripted = script[method]?.shift() ?? { kind: "ok" };
			switch (scripted.kind) {
				case "network":
					throw new TypeError("fetch failed");
				case "rate_limited":
					return json({ ok: false, error: "ratelimited" }, 429, { "retry-after": "30" });
				case "http":
					return new Response("upstream failure", { status: scripted.status });
				case "platform":
					return json({ ok: false, error: scripted.error });
				case "ok":
					break;
			}
			if (method === "conversations.open") return json({ ok: true, channel: { id: OPENED_DM } });
			if (method === "chat.postMessage") {
				return json({ ok: true, channel: body.channel, ts: `${nextTs++}.000100` });
			}
			return json({ ok: true, channel: body.channel, ts: body.ts });
		}) as typeof fetch;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser],
		]);
	}

	async function seed(
		options: {
			control?: boolean;
			enableApprovals?: boolean;
			conversation?: boolean;
			mapping?: boolean;
			telegram?: boolean;
			categoryName?: string;
		} = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T294 delivery', $1, $2)`,
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
		if (options.control ?? true) {
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, 'absence', 'slack', $2)`,
				[ids.organization, timestamp],
			);
		}
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't294-requester@example.test', $3, $3),
			 ($2, 'Morgan Manager', 't294-manager@example.test', $3, $3)`,
			[ids.requesterUser, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'Europe/Berlin', '24h', $2)`,
			[ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't294-member-' || user_id, $1, user_id, 'member', 'approved', $2
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
			 values ($1, $2, 'vacation', $3, true, true, true, $4)`,
			[ids.category, ids.organization, options.categoryName ?? "Vacation", timestamp],
		);
		await admin.query(
			`insert into slack_workspace_config
			 (organization_id, slack_team_id, slack_team_name, bot_access_token, bot_user_id,
			  setup_status, enable_approvals, enable_escalations, updated_at)
			 values ($1, $2, 'T294 workspace', 'vault:managed', 'B294BOT', 'active', $3, false, $4)`,
			[ids.organization, SLACK_TEAM_ID, options.enableApprovals ?? true, timestamp],
		);
		if (options.mapping ?? true) {
			await admin.query(
				`insert into slack_user_mapping
				 (user_id, organization_id, slack_user_id, slack_team_id, is_active, updated_at)
				 values ($1, $2, $3, $4, true, $5)`,
				[ids.managerUser, ids.organization, MANAGER_SLACK_ID, SLACK_TEAM_ID, timestamp],
			);
		}
		if (options.conversation ?? true) {
			await admin.query(
				`insert into slack_conversation
				 (organization_id, user_id, channel_id, channel_type, is_active, updated_at)
				 values ($1, $2, $3, 'im', true, $4)`,
				[ids.organization, ids.managerUser, MANAGER_DM, timestamp],
			);
		}
		if (options.telegram) {
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
				`insert into telegram_bot_config
				 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
				  enable_approvals, enable_escalations, updated_at)
				 values ($1, 'vault:managed', 't294_bot', 't294-secret', 'active', true, false, $2)`,
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
				[ids.organization, ids.managerUser, String(MANAGER_TELEGRAM_CHAT), timestamp],
			);
		}
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
			provider: string;
			effect: string;
			status: string;
			retry_count: number;
			attempt_count: number;
			last_outcome: string | null;
			available_at: Date;
		}>(
			`select id, provider, effect, status, retry_count, attempt_count, last_outcome, available_at
			 from approval_delivery_work where workflow_id = $1 order by created_at, provider, effect`,
			[workflowId],
		);
		return rows;
	}

	async function messages(workflowId: string, provider = "slack") {
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
			`select * from approval_delivery_message where workflow_id = $1 and provider = $2
			 order by remote_message_id`,
			[workflowId, provider],
		);
		return rows;
	}

	async function workflowStatus(workflowId: string) {
		const { rows } = await admin.query<{ status: string; version: number }>(
			"select status, version from approval_workflow where id = $1",
			[workflowId],
		);
		return only(rows);
	}

	async function openAttention(reason: string) {
		const { rows } = await admin.query<{ id: string; delivery_channel: string | null }>(
			`select id, delivery_channel from approval_escalation_attention
			 where organization_id = $1 and reason = $2 and status = 'open'`,
			[ids.organization, reason],
		);
		return rows;
	}

	const slackCalls = (method: string) =>
		calls.filter((call) => call.provider === "slack" && call.method === method);
	const posts = () => slackCalls("chat.postMessage");
	const updates = () => slackCalls("chat.update");
	const blocksOf = (call: ProviderCall) => call.body.blocks as SlackBlock[];
	const blockText = (call: ProviderCall) =>
		blocksOf(call)
			.map((block) => block.text?.text ?? "")
			.join("\n");
	const actionIdsOf = (call: ProviderCall) =>
		blocksOf(call)
			.flatMap((block) => block.elements ?? [])
			.map((element) => element.action_id);

	async function slackBot() {
		const bot = await getBotConfigByOrganization(ids.organization);
		if (!bot) throw new Error("Expected the seeded Slack installation");
		return bot;
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
			throw new Error("Slack approval delivery PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
		harness.kicks.length = 0;
		calls.length = 0;
		duringPost = null;
		for (const key of Object.keys(script)) delete script[key];
		installTransport();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
	});

	it("sends one review-only card with the submitted facts and records its full identity", async () => {
		await seed();
		const { workflowId, assignmentId, requestId } = await submit();
		expect(harness.kicks).toEqual([{ organizationId: ids.organization, workflowId }]);
		expect(posts()).toHaveLength(0);

		const summary = await deliver();
		expect(summary.outcomes).toEqual({ delivered: 1 });
		const card = only(posts());
		expect(card.body.channel).toBe(MANAGER_DM);
		const text = blockText(card);
		expect(text).toContain("Absence approval request");
		expect(text).toContain("Employee: Avery Requester");
		expect(text).toContain("Category: Vacation");
		expect(text).toContain("It cannot be decided from this message.");
		expect(text).not.toContain("Private note");
		// The only control opens the exact item; nothing can decide.
		expect(actionIdsOf(card)).toEqual(["approval_review"]);
		const [link] = blocksOf(card).flatMap((block) => block.elements ?? []);
		expect(link?.url).toContain(requestId);
		expect(link?.url?.startsWith("https://t294.example.test/")).toBe(true);

		expect(only(await messages(workflowId))).toMatchObject({
			assignment_id: assignmentId,
			approval_request_id: requestId,
			recipient_employee_id: ids.manager,
			recipient_user_id: ids.managerUser,
			receiver_scope: RECEIVER_SCOPE,
			destination_id: MANAGER_DM,
			remote_message_id: `${nextTs - 1}.000100`,
			binding_id: null,
			controls: "none",
			state: "current",
			status_version: (await workflowStatus(workflowId)).version,
		});
		// A review-only card issues no binding.
		const { rows: bindings } = await admin.query(
			"select id from approval_review_binding where assignment_id = $1",
			[assignmentId],
		);
		expect(bindings).toHaveLength(0);
		expect(only(await work(workflowId))).toMatchObject({
			provider: "slack",
			effect: "initial",
			status: "delivered",
			attempt_count: 1,
		});

		await deliver(minutes(60));
		expect(posts()).toHaveLength(1);
	});

	it("sends a review notice without facts when the summary would exceed Slack's limits", async () => {
		await seed({ categoryName: `Vacation ${"x".repeat(3000)}` });
		const { workflowId } = await submit();
		await deliver();
		const text = blockText(only(posts()));
		expect(text).toContain("Review required");
		expect(text).not.toContain("Category:");
		expect(only(await messages(workflowId))).toMatchObject({ controls: "none" });
	});

	it("updates the card after a web decision with the committed actor and time", async () => {
		await seed();
		const submitted = await submit();
		const { workflowId } = submitted;
		await deliver();
		const message = only(await messages(workflowId));

		await approveOnWeb(submitted);
		await deliver(minutes(1));

		const update = only(updates());
		expect(update.body).toMatchObject({ channel: MANAGER_DM, ts: message.remote_message_id });
		const { rows } = await admin.query<{ decided_at: Date }>(
			"select decided_at from approval_decision_evidence where workflow_id = $1",
			[workflowId],
		);
		const decidedAt = Temporal.Instant.from(only(rows).decided_at.toISOString());
		const time = formatInstant(
			decidedAt,
			{ locale: "en", timezone: "Europe/Berlin", timeFormat: "24h" },
			"dateTimeMedium",
		);
		expect(blockText(update)).toContain("Request approved");
		expect(blockText(update)).toContain(`Approved by Morgan Manager on ${time} (Europe/Berlin)`);
		expect(actionIdsOf(update)).toEqual(["approval_review"]);
		expect(only(await messages(workflowId))).toMatchObject({
			controls: "none",
			state: "retired",
			status_version: (await workflowStatus(workflowId)).version,
		});

		await deliver(minutes(10));
		expect(updates()).toHaveLength(1);
		expect(posts()).toHaveLength(1);
	});

	it("updates the Slack card when the request is decided on Telegram", async () => {
		await seed({ telegram: true });
		const { workflowId } = await submit();
		await deliver();
		const telegramCard = only(
			calls.filter((call) => call.provider === "telegram" && call.method === "sendMessage"),
		);
		const telegramMessage = only(await messages(workflowId, "telegram"));
		const slackMessage = only(await messages(workflowId));
		const approve = (
			telegramCard.body.reply_markup as {
				inline_keyboard: Array<Array<{ callback_data?: string }>>;
			}
		).inline_keyboard
			.flat()
			.find((button) => button.callback_data?.includes('"ba"'))?.callback_data;

		await handleTelegramUpdate(
			{
				update_id: 7001,
				callback_query: {
					id: "t294-q-1",
					from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Morgan" },
					message: {
						message_id: Number(telegramMessage.remote_message_id),
						date: 1_790_000_000,
						chat: { id: MANAGER_TELEGRAM_CHAT, type: "private" as const },
					},
					data: approve ?? "",
				},
			},
			{
				organizationId: ids.organization,
				botToken: TELEGRAM_BOT_TOKEN,
				botUsername: "t294_bot",
				webhookSecret: "t294-secret",
				setupStatus: "active",
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: false,
				enableEscalations: false,
				digestTime: "09:00",
				digestTimezone: "UTC",
				escalationTimeoutHours: 24,
			},
		);
		expect((await workflowStatus(workflowId)).status).toBe("approved");

		await deliver(minutes(1));
		const update = only(updates());
		expect(update.body.ts).toBe(slackMessage.remote_message_id);
		expect(blockText(update)).toContain("Approved by Morgan Manager");
		expect(only(await messages(workflowId))).toMatchObject({ state: "retired" });
		expect(only(await messages(workflowId, "telegram"))).toMatchObject({ state: "retired" });
	});

	it("keeps fresh Slack presses review-only: no action_ts or card value decides", async () => {
		await seed();
		const { workflowId, requestId } = await submit();
		// A legacy card for the same request, sent before the owner took over.
		await admin.query(
			`insert into slack_approval_message
			 (approval_request_id, organization_id, recipient_user_id, channel_id, message_ts, status, updated_at)
			 values ($1, $2, $3, $4, '1780000000.000100', 'sent', now())`,
			[requestId, ids.organization, ids.managerUser, MANAGER_DM],
		);
		const bot = await slackBot();
		for (const actionTs of ["1790000100.000200", "1790000100.000200", "1790000101.000300"]) {
			await handleInteraction(
				{
					type: "block_actions",
					user: { id: MANAGER_SLACK_ID },
					team: { id: SLACK_TEAM_ID },
					channel: { id: MANAGER_DM },
					message: { ts: "1780000000.000100" },
					actions: [
						{
							action_id: "approval_approve",
							block_id: "approval",
							value: requestId,
							type: "button",
							action_ts: actionTs,
						},
					],
				},
				bot,
			);
		}
		expect(await workflowStatus(workflowId)).toMatchObject({ status: "pending" });
		const { rows: invocations } = await admin.query(
			"select id from approval_invocation where organization_id = $1",
			[ids.organization],
		);
		expect(invocations).toHaveLength(0);
		// Each press turns the legacy card into authenticated review, nothing else.
		expect(updates()).toHaveLength(3);
		for (const update of updates()) {
			expect(update.body.ts).toBe("1780000000.000100");
			expect(blockText(update)).toContain("Review required");
			expect(actionIdsOf(update)).toEqual(["approval_review"]);
		}
	});

	it("retries 503 and rate limits on the owner's schedule, exhausts visibly and recovers on request", async () => {
		await seed();
		const { workflowId } = await submit();
		script["chat.postMessage"] = [
			{ kind: "rate_limited" },
			...Array.from({ length: 5 }, () => ({ kind: "http" as const, status: 503 })),
		];

		let now = T0;
		await deliver(now);
		// The client neither retried nor waited out the rate limit.
		expect(posts()).toHaveLength(1);
		expect(only(await work(workflowId))).toMatchObject({
			status: "pending",
			last_outcome: "retryable:slack_rate_limited",
		});
		for (const [index, wait] of [1, 5, 30, 120, 720].entries()) {
			const [row] = await work(workflowId);
			expect(row).toMatchObject({ status: "pending", retry_count: index + 1 });
			expect(Temporal.Instant.from(row?.available_at.toISOString() ?? "")).toEqual(
				now.add({ minutes: wait }),
			);
			await deliver(now.add({ minutes: wait }).subtract({ seconds: 1 }));
			expect(posts()).toHaveLength(index + 1);
			now = now.add({ minutes: wait });
			await deliver(now);
		}
		expect(posts()).toHaveLength(6);
		expect(only(await work(workflowId))).toMatchObject({
			status: "exhausted",
			last_outcome: "ambiguous:slack_http_503",
		});
		const [incident] = await openAttention("delivery_exhausted");
		expect(incident).toMatchObject({ delivery_channel: "slack" });

		await deliver(now.add({ hours: 24 }));
		expect(posts()).toHaveLength(6);
		const recovered = await recoverApprovalDeliveryForAttention({
			organizationId: ids.organization,
			attentionId: incident?.id ?? "",
			actorUserId: ids.managerUser,
			now: now.add({ hours: 25 }),
		});
		expect(recovered.kind).toBe("rearmed");
		await deliver(now.add({ hours: 25 }));
		expect(posts()).toHaveLength(7);
		expect(only(await work(workflowId))).toMatchObject({ status: "delivered" });
		expect(await openAttention("delivery_exhausted")).toHaveLength(0);
	});

	it("waits for an unlinked recipient and delivers once they link their Slack account", async () => {
		await seed({ conversation: false, mapping: false, telegram: true });
		const { workflowId } = await submit();
		// Telegram delivers the same assignment only after Slack failed.
		await expandApprovalDeliveryIntents({ organizationId: ids.organization, limit: 10 });
		await admin.query(
			`update approval_delivery_work set available_at = $2
			 where workflow_id = $1 and provider = 'telegram'`,
			[workflowId, new Date(minutes(1).epochMilliseconds)],
		);
		await deliver();
		expect(posts()).toHaveLength(0);
		const slackWork = () =>
			work(workflowId).then((rows) => rows.filter((row) => row.provider === "slack"));
		expect(only(await slackWork())).toMatchObject({
			status: "awaiting_repair",
			retry_count: 0,
			last_outcome: "destination_invalid:destination_missing",
		});
		await deliver(minutes(1));
		expect((await work(workflowId)).find((row) => row.provider === "telegram")).toMatchObject({
			status: "delivered",
		});
		// Telegram's success does not close Slack's incident.
		expect(only(await openAttention("delivery_unavailable"))).toMatchObject({
			delivery_channel: "slack",
		});

		// Repairing another provider's destination does not re-arm Slack work.
		await telegramConversations.saveConversation(
			String(MANAGER_TELEGRAM_CHAT),
			"private",
			ids.managerUser,
			ids.organization,
		);
		expect(only(await slackWork()).status).toBe("awaiting_repair");

		await admin.query(
			`insert into slack_link_code (user_id, organization_id, code, expires_at, status)
			 values ($1, $2, 'T294LINK', now() + interval '15 minutes', 'pending')`,
			[ids.managerUser, ids.organization],
		);
		await expect(
			claimLinkCode("T294LINK", MANAGER_SLACK_ID, SLACK_TEAM_ID, ids.organization),
		).resolves.toMatchObject({ status: "success" });
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		await deliver(minutes(2));
		expect(slackCalls("conversations.open")).toHaveLength(1);
		expect(only(posts()).body.channel).toBe(OPENED_DM);
		expect(only(await slackWork()).status).toBe("delivered");
		expect(only(await messages(workflowId))).toMatchObject({ destination_id: OPENED_DM });
		expect(await openAttention("delivery_unavailable")).toHaveLength(0);
	});

	it("waits for a closed DM and re-arms when the recipient writes to the bot again", async () => {
		await seed();
		const { workflowId } = await submit();
		script["chat.postMessage"] = [{ kind: "platform", error: "channel_not_found" }];
		await deliver();
		expect(only(await work(workflowId))).toMatchObject({
			status: "awaiting_repair",
			last_outcome: "destination_invalid:slack_channel_not_found",
		});
		await saveConversation(MANAGER_DM, "im", ids.managerUser, ids.organization);
		await deliver(minutes(1));
		expect(posts()).toHaveLength(2);
		expect(only(await work(workflowId)).status).toBe("delivered");
		expect(await openAttention("delivery_unavailable")).toHaveLength(0);
	});

	it("reports a revoked installation as unavailable without spending retries", async () => {
		await seed();
		const { workflowId } = await submit();
		script["chat.postMessage"] = [{ kind: "platform", error: "token_revoked" }];
		await deliver();
		expect(only(await work(workflowId))).toMatchObject({
			status: "awaiting_repair",
			retry_count: 0,
			last_outcome: "unavailable:slack_token_revoked",
		});
		const [incident] = await openAttention("delivery_unavailable");
		expect(incident).toMatchObject({ delivery_channel: "slack" });
	});

	it("honors recipient preferences and integration enablement before sending", async () => {
		await seed();
		await admin.query(
			`insert into notification_preference (user_id, notification_type, channel, enabled, updated_at)
			 values ($1, 'approval_request_submitted', 'slack', false, now())`,
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
		expect(posts()).toHaveLength(0);
	});

	it("tracks a card that went stale while in flight and retires it", async () => {
		await seed();
		const submitted = await submit();
		const { workflowId } = submitted;
		duringPost = () => approveOnWeb(submitted);

		await deliver();
		const message = only(await messages(workflowId));
		expect(message.status_version).toBeLessThan((await workflowStatus(workflowId)).version);

		await deliver(minutes(1));
		expect(only(updates()).body.ts).toBe(message.remote_message_id);
		expect(only(await messages(workflowId))).toMatchObject({ state: "retired" });
	});

	it("keeps a committed decision when updating its card fails, then retries", async () => {
		await seed();
		const submitted = await submit();
		const { workflowId, absenceId } = submitted;
		await deliver();
		script["chat.update"] = [{ kind: "network" }];
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
		expect(updates()).toHaveLength(2);
		expect(only(await messages(workflowId))).toMatchObject({ state: "retired" });
	});

	it("marks a card deleted in Slack as gone", async () => {
		await seed();
		const submitted = await submit();
		await deliver();
		script["chat.update"] = [{ kind: "platform", error: "message_not_found" }];
		await approveOnWeb(submitted);
		await deliver(minutes(1));
		expect(only(await messages(submitted.workflowId))).toMatchObject({ state: "gone" });
		expect(
			(await work(submitted.workflowId)).find((row) => row.effect === "refresh"),
		).toMatchObject({ status: "delivered", last_outcome: "gone:message_not_editable" });
	});

	it("never updates a card through a replaced workspace installation", async () => {
		await seed();
		const submitted = await submit();
		await deliver();
		await admin.query(
			"update slack_workspace_config set slack_team_id = 'T294OTHER' where organization_id = $1",
			[ids.organization],
		);
		await approveOnWeb(submitted);
		await deliver(minutes(1));
		expect(updates()).toHaveLength(0);
		expect(only(await messages(submitted.workflowId))).toMatchObject({ state: "gone" });
	});

	it("delivers once when workers run concurrently", async () => {
		await seed();
		const { workflowId } = await submit();
		await Promise.all([deliver(), deliver(), deliver()]);
		expect(posts()).toHaveLength(1);
		expect(await messages(workflowId)).toHaveLength(1);
	});

	it("leaves the existing Slack path alone without a control, and silences it with one", async () => {
		await seed({ control: false });
		const inactive = await submit();
		await deliver();
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
		await sendSlackNotification(legacyNotice);
		expect(posts()).toHaveLength(1);

		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ($1, 'absence', 'slack', '2026-07-01T00:00:00Z')`,
			[ids.organization],
		);
		await sendSlackNotification(legacyNotice);
		await sendSlackNotification({
			...legacyNotice,
			entityType: "approval_request",
			entityId: inactive.requestId,
		});
		expect(posts()).toHaveLength(1);
	});

	it("privileged cleanup removes and reports Slack work and messages", async () => {
		await seed();
		const { workflowId } = await submit();
		await deliver();
		const message = only(await messages(workflowId));
		const [deliveryWork] = await work(workflowId);

		const deleted = await deleteApproval(db, ids.organization, workflowId);
		expect(deleted.delivery).toEqual({ work: [deliveryWork?.id], messages: [message.id] });
		expect(await messages(workflowId)).toHaveLength(0);
		expect(await work(workflowId)).toHaveLength(0);
	});
});
