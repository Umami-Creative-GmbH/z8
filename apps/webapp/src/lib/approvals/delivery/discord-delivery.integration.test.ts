/**
 * #292 / T28 runtime evidence: Discord reviewed decisions and delivery through
 * the shared approval delivery owner.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * A real canonical absence submission commits its lifecycle intents with the
 * workflow. The real delivery owner prepares the shared presentation, opens
 * the recipient's DM and records the actual Discord message; real interaction
 * handling decides through the authoritative bound decision, keyed by the
 * application-scoped interaction ID. Only the request/session, billing guard,
 * e-mail and notification fan-out, calendar queue, work-balance marking, the
 * vault, the post-commit fast path (so each test drives the owner explicitly)
 * and the Discord and Telegram HTTP transports (fetch) are replaced.
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
	getOrganizationBaseUrl: async () => "https://t292.example.test",
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
		key.startsWith("discord/") ? "t292-discord-bot-token" : "292292292:AAT292-cross_platform",
}));

// The best-effort fast path only runs the owner sooner; recording the calls
// keeps each test's delivery passes explicit and deterministic.
vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
		harness.kicks.push(input);
	},
}));

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { db } = await import("@/db");
const { processApprovalDeliveries } = await import("./owner");
const { handleDiscordInteraction } = await import("@/lib/discord/bot-handler");
const { saveConversation } = await import("@/lib/discord/conversation-manager");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { sendDiscordNotification } = await import("@/lib/notifications/discord-channel");

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
	describe.skip(`Discord approval delivery PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const APPLICATION_ID = "1292000000000000001";
const OTHER_APPLICATION_ID = "1292000000000000099";
const RECEIVER_SCOPE = `discord-app:${APPLICATION_ID}`;
const MANAGER_DISCORD_ID = "4292000000000000001";
const DM_CHANNEL_ID = "5292000000000000001";
const SERVER_CHANNEL_ID = "5292000000000000999";
const MANAGER_TELEGRAM_ID = 29_201;
const MANAGER_CHAT_ID = 292_555;
// Pinned pass time. New work becomes due at the database's now(), so the
// pinned clock must lie after the real time the test runs at.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t292-delivery-org",
	requesterUser: "t292-requester-user",
	managerUser: "t292-manager-user",
	requester: "e2920000-0000-4000-8000-000000000001",
	manager: "e2920000-0000-4000-8000-000000000002",
	managerLink: "e2921000-0000-4000-8000-000000000001",
	category: "e2922000-0000-4000-8000-000000000001",
} as const;

interface ProviderCall {
	provider: "discord" | "telegram";
	/** Discord: route kind; Telegram: Bot API method. */
	kind: string;
	path: string;
	body: Record<string, unknown>;
}

type TransportResponse =
	| { kind: "ok" }
	| { kind: "error"; status: number; code: number }
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

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describeIntegration("Discord approval decisions and delivery (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });
	const calls: ProviderCall[] = [];
	let nextMessageId = 6_292_000_000_000_000_001n;
	const originalFetch = globalThis.fetch;
	/** Per-route scripted Discord responses; anything unscripted succeeds. */
	const script: Record<string, TransportResponse[]> = {};
	/** Runs while a Discord message is being created, before Discord "answers". */
	let duringSend: (() => Promise<void>) | null = null;
	/** Workflow status observed when each interaction was acknowledged. */
	const statusAtAcknowledgment: string[] = [];
	let acknowledgedWorkflowId: string | null = null;

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	function discordRoute(method: string, path: string): string {
		if (method === "POST" && path === "/users/@me/channels") return "dm";
		if (method === "POST" && /^\/channels\/\d+\/messages$/.test(path)) return "send";
		if (method === "PATCH" && /^\/channels\/\d+\/messages\/\d+$/.test(path)) return "edit";
		if (method === "POST" && /^\/interactions\/[^/]+\/[^/]+\/callback$/.test(path)) {
			return "acknowledge";
		}
		if (method === "POST" && /^\/webhooks\/\d+\/[^/]+$/.test(path)) return "followup";
		throw new Error(`Unexpected Discord call in test: ${method} ${path}`);
	}

	/** The Discord REST and Telegram Bot API transports; everything above them is real. */
	function installTransports() {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
			const telegram = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
			if (telegram) {
				const method = telegram[1] ?? "";
				calls.push({ provider: "telegram", kind: method, path: method, body });
				const result =
					method === "sendMessage"
						? {
								message_id: Number(nextMessageId++ % 1_000_000n),
								date: 1_790_000_000,
								chat: { id: Number(body.chat_id), type: "private" },
								text: body.text,
							}
						: true;
				return json({ ok: true, result });
			}
			const discord = /^https:\/\/discord\.com\/api\/v10(\/.*)$/.exec(url);
			if (!discord) throw new Error(`Unexpected fetch in test: ${url}`);
			const method = init?.method ?? "GET";
			const path = discord[1] ?? "";
			const kind = discordRoute(method, path);
			calls.push({ provider: "discord", kind, path, body });
			if (kind === "acknowledge" && acknowledgedWorkflowId) {
				const { rows } = await admin.query<{ status: string }>(
					"select status from approval_workflow where id = $1",
					[acknowledgedWorkflowId],
				);
				statusAtAcknowledgment.push(rows[0]?.status ?? "missing");
			}
			if (kind === "send" && duringSend) {
				const hook = duringSend;
				duringSend = null;
				await hook();
			}
			const scripted = script[kind]?.shift() ?? { kind: "ok" };
			if (scripted.kind === "network") throw new TypeError("fetch failed");
			if (scripted.kind === "error") {
				return json({ code: scripted.code, message: "scripted failure" }, scripted.status);
			}
			const channelId = /^\/channels\/(\d+)\//.exec(path)?.[1] ?? DM_CHANNEL_ID;
			switch (kind) {
				case "dm":
					return json({ id: DM_CHANNEL_ID, type: 1 });
				case "send":
					return json({ id: String(nextMessageId++), channel_id: channelId });
				case "edit":
					return json({ id: path.split("/").pop(), channel_id: channelId });
				case "acknowledge":
					return new Response(null, { status: 204 });
				default:
					return json({ id: String(nextMessageId++), channel_id: DM_CHANNEL_ID });
			}
		}) as typeof fetch;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser],
		]);
	}

	async function seed(options: { control?: boolean; telegram?: boolean; link?: boolean } = {}) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T292 delivery', $1, $2)`,
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
		const providers = options.telegram ? ["discord", "telegram"] : ["discord"];
		await admin.query(
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 select $1, 'absence', provider, 'actionable' from unnest($2::text[]) as provider`,
			[ids.organization, providers],
		);
		if (options.control ?? true) {
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 select $1, 'absence', provider, $2 from unnest($3::text[]) as provider`,
				[ids.organization, timestamp, providers],
			);
		}
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't292-requester@example.test', $3, $3),
			 ($2, 'Morgan Manager', 't292-manager@example.test', $3, $3)`,
			[ids.requesterUser, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'Europe/Berlin', '24h', $2)`,
			[ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't292-member-' || user_id, $1, user_id, 'member', 'approved', $2
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
			`insert into discord_bot_config
			 (organization_id, bot_token, application_id, public_key, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', $2, 't292-public-key', 't292-secret', 'active', true, false, $3)`,
			[ids.organization, APPLICATION_ID, timestamp],
		);
		if (options.link ?? true) await linkDiscordAccount();
		// A server channel stored as the conversation must never receive a card.
		await admin.query(
			`insert into discord_conversation (organization_id, user_id, channel_id, is_active, updated_at)
			 values ($1, $2, $3, true, $4)`,
			[ids.organization, ids.managerUser, SERVER_CHANNEL_ID, timestamp],
		);
		if (options.telegram) {
			await admin.query(
				`insert into telegram_bot_config
				 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
				  enable_approvals, enable_escalations, updated_at)
				 values ($1, 'vault:managed', 't292_bot', 't292-telegram-secret', 'active', true, false, $2)`,
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
	}

	async function linkDiscordAccount() {
		await admin.query(
			`insert into discord_user_mapping
			 (user_id, organization_id, discord_user_id, discord_username, is_active, updated_at)
			 values ($1, $2, $3, 'morgan', true, now())`,
			[ids.managerUser, ids.organization, MANAGER_DISCORD_ID],
		);
	}

	async function submit(dates = { start: "2026-10-05", end: "2026-10-06" }): Promise<{
		absenceId: string;
		requestId: string;
		workflowId: string;
		assignmentId: string;
	}> {
		actAs(ids.requesterUser);
		const result = await requestAbsenceEffect({
			categoryId: ids.category,
			startDate: dates.start,
			endDate: dates.end,
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
		acknowledgedWorkflowId = request.workflow_id;
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
			provider: string;
			status: string;
			retry_count: number;
			attempt_count: number;
			last_outcome: string | null;
			available_at: Date;
		}>(
			`select id, effect, provider, status, retry_count, attempt_count, last_outcome, available_at
			 from approval_delivery_work where workflow_id = $1 order by created_at, provider, effect`,
			[workflowId],
		);
		return rows;
	}

	async function messages(workflowId: string, provider = "discord") {
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

	async function invocations(workflowId: string) {
		const { rows } = await admin.query<{
			scheme: string;
			receiver_scope: string;
			invocation_id: string;
			delivery_id: string | null;
			provider_actor_id: string;
			action: string;
		}>(
			`select scheme, receiver_scope, invocation_id, delivery_id, provider_actor_id, action
			 from approval_invocation where workflow_id = $1 order by created_at`,
			[workflowId],
		);
		return rows;
	}

	async function decisionCount(workflowId: string): Promise<number> {
		const { rows } = await admin.query<{ count: string }>(
			"select count(*) from approval_decision_evidence where workflow_id = $1",
			[workflowId],
		);
		return Number(only(rows).count);
	}

	async function openAttention(reason: string) {
		const { rows } = await admin.query<{ id: string; delivery_channel: string | null }>(
			`select id, delivery_channel from approval_escalation_attention
			 where organization_id = $1 and reason = $2 and status = 'open'`,
			[ids.organization, reason],
		);
		return rows;
	}

	const discordCalls = (kind: string) =>
		calls.filter((call) => call.provider === "discord" && call.kind === kind);
	const sends = () => discordCalls("send");
	const edits = () => discordCalls("edit");
	const followups = () => discordCalls("followup");
	const telegramCalls = (method: string) =>
		calls.filter((call) => call.provider === "telegram" && call.kind === method);
	const buttonsOf = (call: ProviderCall) =>
		(
			(call.body.components ?? []) as Array<{
				components: Array<{ custom_id?: string; url?: string; label: string }>;
			}>
		).flatMap((row) => row.components);
	const customIdOf = (call: ProviderCall, action: "ba" | "br") =>
		buttonsOf(call).find((button) => button.custom_id?.includes(`"${action}"`))?.custom_id ?? "";

	function bot() {
		return {
			organizationId: ids.organization,
			botToken: "t292-discord-bot-token",
			applicationId: APPLICATION_ID,
			publicKey: "t292-public-key",
			webhookSecret: "t292-secret",
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

	/** One authenticated message-component interaction on a delivered card. */
	async function press(
		interactionId: string,
		messageId: string,
		customId: string,
		applicationId = APPLICATION_ID,
	) {
		await handleDiscordInteraction(
			{
				id: interactionId,
				application_id: applicationId,
				type: 3,
				token: `t292-token-${interactionId}`,
				data: { custom_id: customId, component_type: 2 },
				user: { id: MANAGER_DISCORD_ID, username: "morgan" },
				channel_id: DM_CHANNEL_ID,
				message: { id: messageId, channel_id: DM_CHANNEL_ID },
			},
			bot(),
		);
	}

	function lastFollowup(): string {
		const followup = followups().at(-1);
		if (!followup) throw new Error("Expected a follow-up");
		return String(followup.body.content);
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
			throw new Error("Discord approval delivery PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
		harness.kicks.length = 0;
		calls.length = 0;
		duringSend = null;
		statusAtAcknowledgment.length = 0;
		acknowledgedWorkflowId = null;
		for (const key of Object.keys(script)) delete script[key];
		installTransports();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
	});

	it("routes a real submission to one bound card in the recipient's DM (commit before send)", async () => {
		await seed();
		const { workflowId, assignmentId, requestId } = await submit();

		// The submission committed its intents and only asked for a fast pass.
		expect(harness.kicks).toEqual([{ organizationId: ids.organization, workflowId }]);
		expect(sends()).toHaveLength(0);

		const summary = await deliver();
		expect(summary.outcomes).toEqual({ delivered: 1 });
		// The DM is opened from the linked account, never the stored server channel.
		expect(only(discordCalls("dm")).body).toEqual({ recipient_id: MANAGER_DISCORD_ID });
		const card = only(sends());
		expect(card.path).toBe(`/channels/${DM_CHANNEL_ID}/messages`);
		expect(String(card.body.content)).toContain("Absence approval request");
		expect(String(card.body.content)).not.toContain("Private note");
		expect(card.body.allowed_mentions).toEqual({ parse: [] });
		expect(customIdOf(card, "ba")).not.toBe("");
		expect(customIdOf(card, "br")).not.toBe("");
		expect(buttonsOf(card).find((button) => button.url)?.url).toBe(
			`https://t292.example.test/approvals/review/${ids.organization}/compatibility/${requestId}`,
		);

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
			destination_id: DM_CHANNEL_ID,
			remote_message_id: String(nextMessageId - 1n),
			binding_id: only(bindings).id,
			controls: "actionable",
			state: "current",
			status_version: (await workflowStatus(workflowId)).version,
		});
		expect(only(await work(workflowId))).toMatchObject({
			effect: "initial",
			provider: "discord",
			status: "delivered",
			attempt_count: 1,
		});

		// Re-running the owner never sends the same effect again.
		await deliver(minutes(60));
		expect(sends()).toHaveLength(1);
	});

	it("decides from the interaction ID, acknowledges before deciding, and leaves the card to the owner", async () => {
		await seed();
		const { workflowId } = await submit();
		await deliver();
		const card = only(sends());
		const message = only(await messages(workflowId));

		await press("1392000000000000001", message.remote_message_id, customIdOf(card, "ba"));

		// Protocol acknowledgment first (deferred, ephemeral), before anything committed.
		const acknowledgment = only(discordCalls("acknowledge"));
		expect(acknowledgment.body).toEqual({ type: 5, data: { flags: 64 } });
		expect(statusAtAcknowledgment).toEqual(["pending"]);
		expect((await workflowStatus(workflowId)).status).toBe("approved");
		expect(only(await invocations(workflowId))).toEqual({
			scheme: "discord_interaction",
			receiver_scope: RECEIVER_SCOPE,
			invocation_id: "1392000000000000001",
			delivery_id: null,
			provider_actor_id: MANAGER_DISCORD_ID,
			action: "approve",
		});
		// The ephemeral follow-up reports the committed outcome.
		const followup = only(followups());
		expect(followup.path).toBe(`/webhooks/${APPLICATION_ID}/t292-token-1392000000000000001`);
		expect(followup.body.flags).toBe(64);
		expect(lastFollowup()).toContain("Request approved");
		expect(lastFollowup()).toContain("Approved by Morgan Manager");
		// The decided card has one writer: the owner.
		expect(edits()).toHaveLength(0);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization, workflowId });

		await deliver(minutes(1));
		const edit = only(edits());
		expect(edit.path).toBe(`/channels/${DM_CHANNEL_ID}/messages/${message.remote_message_id}`);
		expect(String(edit.body.content)).toContain("Request approved");
		expect(buttonsOf(edit).every((button) => !button.custom_id && button.url)).toBe(true);
		expect(only(await messages(workflowId))).toMatchObject({
			controls: "none",
			state: "retired",
			status_version: (await workflowStatus(workflowId)).version,
		});
	});

	it("replays the same interaction, refuses a changed command, and never lets a new interaction inherit a receipt", async () => {
		await seed();
		const { workflowId } = await submit();
		await deliver();
		const card = only(sends());
		const message = only(await messages(workflowId));
		const approve = customIdOf(card, "ba");

		await press("1392000000000000011", message.remote_message_id, approve);
		expect(await decisionCount(workflowId)).toBe(1);

		// Same individual interaction: its original result, nothing new.
		await press("1392000000000000011", message.remote_message_id, approve);
		expect(lastFollowup()).toContain("already recorded");
		expect(lastFollowup()).toContain("Request approved");

		// Same interaction ID with another command is a conflict, not a decision.
		await press("1392000000000000011", message.remote_message_id, customIdOf(card, "br"));
		expect(lastFollowup()).toContain("already recorded with a different action");

		// Same message and custom_id, new interaction: fresh checks, nothing decided.
		await press("1392000000000000012", message.remote_message_id, approve);
		expect(lastFollowup()).toContain("No decision was made");

		expect(await decisionCount(workflowId)).toBe(1);
		expect(only(await invocations(workflowId)).invocation_id).toBe("1392000000000000011");
		expect((await workflowStatus(workflowId)).status).toBe("approved");
	});

	it("decides nothing for an interaction addressed to another application", async () => {
		await seed();
		const { workflowId } = await submit();
		await deliver();
		const card = only(sends());
		const message = only(await messages(workflowId));

		await press(
			"1392000000000000021",
			message.remote_message_id,
			customIdOf(card, "ba"),
			OTHER_APPLICATION_ID,
		);
		expect((await workflowStatus(workflowId)).status).toBe("pending");
		expect(await invocations(workflowId)).toHaveLength(0);
		expect(lastFollowup()).toContain("No decision was made");
	});

	it("turns a still-pending card whose press decided nothing into a review notice", async () => {
		await seed();
		const { workflowId } = await submit();
		await deliver();
		const card = only(sends());
		const message = only(await messages(workflowId));
		// Actionable cards are paused after sending: a fresh press decides nothing.
		await admin.query(
			`update approval_presentation_control set mode = 'review_only' where organization_id = $1`,
			[ids.organization],
		);

		await press("1392000000000000031", message.remote_message_id, customIdOf(card, "ba"));
		expect((await workflowStatus(workflowId)).status).toBe("pending");
		const edit = only(edits());
		expect(String(edit.body.content)).toContain("Review required");
		expect(buttonsOf(edit).every((button) => !button.custom_id)).toBe(true);
		expect(only(await messages(workflowId))).toMatchObject({ controls: "none" });
		// The owner leaves a pending card alone.
		await deliver(minutes(1));
		expect(edits()).toHaveLength(1);
	});

	it("keeps legacy unbound buttons historical-only", async () => {
		await seed();
		const { workflowId, requestId } = await submit();
		await deliver();

		await handleDiscordInteraction(
			{
				id: "1392000000000000041",
				application_id: APPLICATION_ID,
				type: 3,
				token: "t292-token-legacy",
				data: { custom_id: JSON.stringify({ a: "ap", id: requestId }), component_type: 2 },
				user: { id: MANAGER_DISCORD_ID, username: "morgan" },
				channel_id: DM_CHANNEL_ID,
			},
			bot(),
		);
		const reply = only(discordCalls("acknowledge"));
		expect(JSON.stringify(reply.body)).toContain("No decision was made");
		expect((await workflowStatus(workflowId)).status).toBe("pending");
		expect(await invocations(workflowId)).toHaveLength(0);
	});

	it("retries after 1m, 5m, 30m, 2h and 12h and exhausts visibly", async () => {
		await seed();
		const { workflowId } = await submit();
		script.send = [
			{ kind: "error", status: 429, code: 0 },
			...Array.from({ length: 5 }, () => ({ kind: "error" as const, status: 502, code: 0 })),
		];

		let now = T0;
		await deliver(now);
		expect(only(await work(workflowId)).last_outcome).toBe("retryable:discord_429");
		for (const [index, wait] of [1, 5, 30, 120, 720].entries()) {
			const [row] = await work(workflowId);
			expect(row).toMatchObject({ status: "pending", retry_count: index + 1 });
			expect(Temporal.Instant.from(row?.available_at.toISOString() ?? "")).toEqual(
				now.add({ minutes: wait }),
			);
			await deliver(now.add({ minutes: wait }).subtract({ seconds: 1 }));
			expect(sends()).toHaveLength(index + 1);
			now = now.add({ minutes: wait });
			await deliver(now);
		}
		expect(sends()).toHaveLength(6);
		expect(only(await work(workflowId))).toMatchObject({
			status: "exhausted",
			last_outcome: "ambiguous:discord_502",
		});
		expect(only(await openAttention("delivery_exhausted"))).toMatchObject({
			delivery_channel: "discord",
		});
	});

	it("waits for destination repair and re-arms when the recipient reaches the bot", async () => {
		await seed({ link: false });
		const first = await submit();
		await deliver();
		expect(sends()).toHaveLength(0);
		expect(only(await work(first.workflowId))).toMatchObject({
			status: "awaiting_repair",
			last_outcome: "destination_invalid:destination_missing",
		});
		expect(await openAttention("delivery_unavailable")).toHaveLength(1);

		await linkDiscordAccount();
		await saveConversation(DM_CHANNEL_ID, ids.managerUser, ids.organization);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		await deliver(minutes(1));
		expect(only(sends()).path).toBe(`/channels/${DM_CHANNEL_ID}/messages`);
		expect(only(await work(first.workflowId)).status).toBe("delivered");
		expect(await openAttention("delivery_unavailable")).toHaveLength(0);

		// DMs closed: an invalid destination, not a transient failure.
		await seed();
		const second = await submit();
		script.send = [{ kind: "error", status: 403, code: 50007 }];
		await deliver(minutes(2));
		expect(only(await work(second.workflowId))).toMatchObject({
			status: "awaiting_repair",
			retry_count: 0,
			last_outcome: "destination_invalid:discord_403_50007",
		});
	});

	it("re-arms only the provider whose destination was repaired", async () => {
		await seed({ telegram: true });
		await admin.query("delete from telegram_conversation where organization_id = $1", [
			ids.organization,
		]);
		const { workflowId } = await submit();
		await deliver();
		const telegramWork = () =>
			work(workflowId).then((rows) => only(rows.filter((row) => row.provider === "telegram")));
		expect(await telegramWork()).toMatchObject({
			status: "awaiting_repair",
			last_outcome: "destination_invalid:destination_missing",
		});

		// Reaching the Discord bot says nothing about the Telegram chat.
		await saveConversation(DM_CHANNEL_ID, ids.managerUser, ids.organization);
		expect(await telegramWork()).toMatchObject({ status: "awaiting_repair" });
	});

	it("tracks a card that went stale while in flight and retires it", async () => {
		await seed();
		const submitted = await submit();
		const { workflowId } = submitted;
		duringSend = () => approveOnWeb(submitted);

		await deliver();
		const message = only(await messages(workflowId));
		expect(message).toMatchObject({ controls: "actionable" });
		expect(message.status_version).toBeLessThan((await workflowStatus(workflowId)).version);

		await deliver(minutes(1));
		expect(only(edits()).path).toBe(
			`/channels/${DM_CHANNEL_ID}/messages/${message.remote_message_id}`,
		);
		expect(only(await messages(workflowId))).toMatchObject({ controls: "none", state: "retired" });
	});

	it("updates every card of the lifecycle across platforms", async () => {
		await seed({ telegram: true });
		const fromTelegram = await submit();
		await deliver();
		expect(sends()).toHaveLength(1);
		const telegramCard = only(telegramCalls("sendMessage"));
		const telegramMessage = only(await messages(fromTelegram.workflowId, "telegram"));
		const approveData =
			(
				telegramCard.body.reply_markup as {
					inline_keyboard: Array<Array<{ callback_data?: string }>>;
				}
			).inline_keyboard
				.flat()
				.find((button) => button.callback_data?.includes('"ba"'))?.callback_data ?? "";

		// Decided on Telegram: the Discord card is refreshed by the owner too.
		await handleTelegramUpdate(
			{
				update_id: 7001,
				callback_query: {
					id: "t292-q-1",
					from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Morgan" },
					message: {
						message_id: Number(telegramMessage.remote_message_id),
						date: 1_790_000_000,
						chat: { id: MANAGER_CHAT_ID, type: "private" as const },
					},
					data: approveData,
				},
			},
			{
				organizationId: ids.organization,
				botToken: "292292292:AAT292-cross_platform",
				botUsername: "t292_bot",
				webhookSecret: "t292-telegram-secret",
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
		expect((await workflowStatus(fromTelegram.workflowId)).status).toBe("approved");
		await deliver(minutes(1));
		expect(String(only(edits()).body.content)).toContain("Request approved");
		expect(telegramCalls("editMessageText")).toHaveLength(1);
		expect(only(await messages(fromTelegram.workflowId))).toMatchObject({ controls: "none" });

		// Decided on Discord: the Telegram card is refreshed as well.
		calls.length = 0;
		const fromDiscord = await submit({ start: "2026-10-12", end: "2026-10-13" });
		await deliver(minutes(2));
		const discordCard = only(sends());
		const discordMessage = only(await messages(fromDiscord.workflowId));
		await press(
			"1392000000000000051",
			discordMessage.remote_message_id,
			customIdOf(discordCard, "br"),
		);
		expect((await workflowStatus(fromDiscord.workflowId)).status).toBe("rejected");
		await deliver(minutes(3));
		expect(String(only(telegramCalls("editMessageText")).body.text)).toContain("Request rejected");
		expect(only(await messages(fromDiscord.workflowId, "telegram"))).toMatchObject({
			controls: "none",
			state: "retired",
		});
	});

	it("leaves the existing path alone without a control, and silences it with one", async () => {
		await seed({ control: false });
		const inactive = await submit();
		await deliver();
		expect(await work(inactive.workflowId)).toHaveLength(0);
		const legacyCard = {
			userId: ids.managerUser,
			organizationId: ids.organization,
			type: "approval_request_submitted" as const,
			title: "New absence request",
			message: "Avery Requester requested Vacation.",
			entityType: "approval_request",
			entityId: inactive.requestId,
		};
		await sendDiscordNotification(legacyCard);
		// The existing path sends the shared presentation to the DM, never the server channel.
		expect(only(sends()).path).toBe(`/channels/${DM_CHANNEL_ID}/messages`);

		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ($1, 'absence', 'discord', '2026-07-01T00:00:00Z')`,
			[ids.organization],
		);
		await sendDiscordNotification(legacyCard);
		await sendDiscordNotification({
			...legacyCard,
			entityType: "absence_entry",
			entityId: inactive.absenceId,
		});
		expect(sends()).toHaveLength(1);
	});

	it("privileged cleanup removes and reports Discord work, messages and invocations", async () => {
		await seed();
		const { workflowId } = await submit();
		await deliver();
		const card = only(sends());
		const message = only(await messages(workflowId));
		await press("1392000000000000061", message.remote_message_id, customIdOf(card, "ba"));
		await deliver(minutes(1));
		const deliveryWork = await work(workflowId);
		expect(deliveryWork).toHaveLength(2);

		const deleted = await deleteApproval(db, ids.organization, workflowId);
		expect(deleted.delivery).toEqual({
			work: deliveryWork.map((row) => row.id).sort(),
			messages: [message.id],
		});
		expect(deleted.evidence.invocations).toHaveLength(1);
		expect(await messages(workflowId)).toHaveLength(0);
		expect(await invocations(workflowId)).toHaveLength(0);
	});
});
