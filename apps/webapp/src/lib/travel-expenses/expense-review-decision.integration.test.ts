/**
 * #296 / T32 runtime evidence: expense review, decisions and delivery through
 * shared presentation under legacy authority.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real draft/upload/submit server actions freeze the claim (#295). The
 * real inbox detail, expense decision actions and inbox handler, the real
 * delivery owner, Telegram card preparation and webhook, and privileged
 * maintenance run against that database. Only the session, e-mail/
 * notification fan-out, object storage (an in-memory bucket), the vault, the
 * post-commit fast path (so each test drives the owner explicitly) and the
 * Telegram HTTP transport (fetch) are replaced.
 */

import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalInboxDetailResult } from "@/lib/approvals/inbox/types";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	notifications: [] as string[],
	kicks: [] as Array<{ organizationId: string; workflowId?: string | null }>,
	privateObjects: new Map<string, { bytes: Buffer; versionId: string }>(),
	publicObjects: new Map<string, Uint8Array>(),
	versionCounter: 0,
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

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => undefined,
}));

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

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t296.example.test",
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return {
		...original,
		onTravelExpenseApproved: async () => {
			harness.notifications.push("approved");
		},
		onTravelExpenseRejected: async () => {
			harness.notifications.push("rejected");
		},
	};
});

vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t296-public",
	s3Client: {
		send: async (command: { constructor: { name: string }; input: { Key: string } }) => {
			const key = command.input.Key;
			if (command.constructor.name === "GetObjectCommand") {
				const bytes = harness.publicObjects.get(key);
				if (!bytes) throw new Error(`NoSuchKey ${key}`);
				return {
					ContentLength: bytes.length,
					Body: { transformToByteArray: async () => bytes },
				};
			}
			if (command.constructor.name === "DeleteObjectCommand") {
				harness.publicObjects.delete(key);
				return {};
			}
			throw new Error(`Unexpected public storage command ${command.constructor.name}`);
		},
	},
}));

vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadPrivateObject: async (_organizationId: string, key: string, data: Buffer) => {
		harness.versionCounter += 1;
		const versionId = `v${harness.versionCounter}`;
		harness.privateObjects.set(key, { bytes: Buffer.from(data), versionId });
		return { bucket: "t296-private", versionId };
	},
	deletePrivateObject: async (input: { key: string }) => {
		harness.privateObjects.delete(input.key);
	},
}));

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async () => "296296296:AAT296-expense_cards_test",
}));

// The best-effort fast path only runs the owner sooner; recording the calls
// keeps each test's delivery passes explicit and deterministic.
vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
		harness.kicks.push(input);
	},
}));

const BOT_TOKEN = "296296296:AAT296-expense_cards_test";
const RECEIVER_SCOPE = "telegram-bot:296296296";

const {
	approveTravelExpenseClaim,
	createTravelExpenseDraft,
	rejectTravelExpenseClaim,
	submitTravelExpenseClaim,
} = await import("@/app/[locale]/(app)/travel-expenses/actions");
const { POST: processUpload } = await import("@/app/api/upload/travel-expense/process/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { GET: getApprovalDetail } = await import("@/app/api/approvals/inbox/[id]/route");
const { resolveApprovalReviewArrival } = await import("@/lib/approvals/presentation/review-arrival");
const { parseApprovalReviewTarget } = await import(
	"@/lib/approvals/presentation/review-navigation"
);
const { TravelExpenseClaimHandler } = await import(
	"@/lib/approvals/handlers/travel-expense-claim.handler"
);
const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { attemptBoundBotApproval } = await import("@/lib/bot-platform/approval-decision");
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
	describe.skip(`expense review and decisions PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const MANAGER_TELEGRAM_ID = 29_601;
const MANAGER_CHAT_ID = 296_555;
// Pinned pass time. New work becomes due at the database's now(), so the
// pinned clock must lie after the real time the test runs at.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t296-expense-org",
	otherOrganization: "t296-other-org",
	requesterUser: "t296-requester-user",
	managerUser: "t296-manager-user",
	otherUser: "t296-other-user",
	requester: "e2960000-0000-4000-8000-000000000001",
	manager: "e2960000-0000-4000-8000-000000000002",
	otherEmployee: "e2960000-0000-4000-8000-000000000003",
	backupManager: "e2960000-0000-4000-8000-000000000004",
	backupUser: "t296-backup-user",
	managerLink: "e2961000-0000-4000-8000-000000000001",
	policy: "e2962000-0000-4000-8000-000000000001",
	firstStage: "e2962000-0000-4000-8000-000000000002",
	secondStage: "e2962000-0000-4000-8000-000000000003",
} as const;

const BACKUP_TELEGRAM_ID = 29_602;
const BACKUP_CHAT_ID = 296_556;

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

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

describeIntegration("expense review, decisions and cards (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 9600;
	const originalFetch = globalThis.fetch;

	function actAs(userId: string | null, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = userId ? organizationId : null;
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
		await admin.query(
			"delete from travel_expense_receipt_upload where organization_id = any($1::text[])",
			[[ids.organization, ids.otherOrganization]],
		);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.otherUser, ids.backupUser],
		]);
	}

	async function seed(
		options: {
			capture?: boolean;
			presentation?: boolean;
			delivery?: boolean;
			twoStageChain?: boolean;
		} = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at, timezone) values
			 ($1, 'T296 expenses', $1, $3, 'Europe/Berlin'), ($2, 'T296 other', $2, $3, 'UTC')`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't296-requester@example.test', $5, $5),
			 ($2, 'Morgan Manager', 't296-manager@example.test', $5, $5),
			 ($3, 'Olive Other', 't296-other@example.test', $5, $5),
			 ($4, 'Blake Backup', 't296-backup@example.test', $5, $5)`,
			[ids.requesterUser, ids.managerUser, ids.otherUser, ids.backupUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'Europe/Berlin', '24h', $2)`,
			[ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't296-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.requesterUser, ids.managerUser, ids.backupUser]],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t296-member-other', $1, $2, 'member', 'approved', $3)`,
			[ids.otherOrganization, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'employee', $10), ($3, $4, $9, 'manager', $10),
			 ($5, $6, $11, 'manager', $10), ($7, $8, $9, 'manager', $10)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.backupManager,
				ids.backupUser,
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
		if (options.capture ?? true) await setCapture(true);
		if (options.presentation ?? true) {
			await admin.query(
				`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
				 values ($1, 'travel_expense', 'telegram', 'actionable')`,
				[ids.organization],
			);
		}
		if (options.delivery ?? true) {
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, 'travel_expense', 'telegram', $2)`,
				[ids.organization, timestamp],
			);
		}
		await admin.query(
			`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't296_bot', 't296-secret', 'active', true, false, $2)`,
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
		if (options.twoStageChain) {
			await admin.query(
				`insert into approval_policy
				 (id, organization_id, name, is_active, priority, created_by, updated_at)
				 values ($1, $2, 'T296 two stages', true, 1, $3, $4)`,
				[ids.policy, ids.organization, ids.managerUser, timestamp],
			);
			await admin.query(
				`insert into approval_policy_stage
				 (id, organization_id, policy_id, step_order, label, approver_type,
				  approver_employee_id, fallback_behavior, updated_at) values
				 ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', $6),
				 ($2, $3, $4, 2, 'Finance', 'specific_employee', $5, 'fail', $6)`,
				[
					ids.firstStage,
					ids.secondStage,
					ids.organization,
					ids.policy,
					ids.backupManager,
					timestamp,
				],
			);
			await admin.query(
				`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
				 values ($1, 'de', 'Europe/Berlin', '24h', $2)`,
				[ids.backupUser, timestamp],
			);
			await admin.query(
				`insert into telegram_user_mapping
				 (user_id, organization_id, telegram_user_id, is_active, updated_at)
				 values ($1, $2, $3, true, $4)`,
				[ids.backupUser, ids.organization, String(BACKUP_TELEGRAM_ID), timestamp],
			);
			await admin.query(
				`insert into telegram_conversation
				 (organization_id, user_id, chat_id, chat_type, is_active, updated_at)
				 values ($1, $2, $3, 'private', true, $4)`,
				[ids.organization, ids.backupUser, String(BACKUP_CHAT_ID), timestamp],
			);
		}
	}

	async function setCapture(active: boolean) {
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'travel_expense', $2)
			 on conflict (organization_id, workflow_type) do update set mode = excluded.mode`,
			[ids.organization, active ? "capture" : "inactive"],
		);
	}

	/** Draft, one receipt upload and submission through the real actions. */
	async function submitClaim(): Promise<{ claimId: string; requestId: string }> {
		actAs(ids.requesterUser);
		const draft = await createTravelExpenseDraft({
			type: "receipt",
			tripStart: "2026-03-29",
			tripEnd: "2026-03-31",
			destinationCity: "Hamburg",
			destinationCountry: "DE",
			originalCurrency: "EUR",
			originalAmount: "120.50",
			calculatedCurrency: "EUR",
			calculatedAmount: "120.50",
			notes: "Private note that stays in authenticated review",
		});
		if (!draft.success) throw new Error(`Draft failed: ${draft.error}`);
		const claimId = draft.data.id;
		const tusFileKey = createOwnedTusFileKey(ids.requesterUser);
		harness.publicObjects.set(tusFileKey, new Uint8Array(PDF_BYTES));
		const uploaded = await processUpload({
			json: async () => ({ tusFileKey, claimId, fileName: "hotel-invoice.pdf" }),
		} as never);
		if (uploaded.status !== 200) throw new Error(`Upload failed: ${uploaded.status}`);
		const submitted = await submitTravelExpenseClaim({ claimId });
		if (!submitted.success) throw new Error(`Submission failed: ${submitted.error}`);
		actAs(null);
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where organization_id = $1 and entity_type = 'travel_expense_claim'
			   and entity_id = $2 and status = 'pending'`,
			[ids.organization, claimId],
		);
		return { claimId, requestId: only(rows).id };
	}

	function deliver(now: Temporal.Instant = T0) {
		return processApprovalDeliveries({ organizationId: ids.organization, now });
	}

	function botConfig() {
		return {
			organizationId: ids.organization,
			botToken: BOT_TOKEN,
			botUsername: "t296_bot",
			webhookSecret: "t296-secret",
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

	let updateCounter = 7000;
	async function press(messageId: number, data: string, queryId: string) {
		updateCounter += 1;
		await handleTelegramUpdate(
			{
				update_id: updateCounter,
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

	/** A bound press through the shared attempt, as a webhook delivers it. */
	function attempt(input: {
		bindingId: string;
		queryId: string;
		action?: "approve" | "reject";
		organizationId?: string;
		actorEmployeeId?: string;
		actorUserId?: string;
	}) {
		return attemptBoundBotApproval({
			organizationId: input.organizationId ?? ids.organization,
			actorEmployeeId: input.actorEmployeeId ?? ids.manager,
			actorUserId: input.actorUserId ?? ids.managerUser,
			bindingId: input.bindingId,
			action: input.action ?? "approve",
			platform: "telegram",
			invocation: {
				scheme: "telegram_callback_query",
				receiverScope: RECEIVER_SCOPE,
				invocationId: input.queryId,
				deliveryId: null,
				providerActorId: String(MANAGER_TELEGRAM_ID),
			},
		});
	}

	const sends = () => calls.filter((call) => call.method === "sendMessage");
	const edits = () => calls.filter((call) => call.method === "editMessageText");
	const answers = () => calls.filter((call) => call.method === "answerCallbackQuery");
	const buttonsOf = (call: TelegramCall) =>
		(
			call.body.reply_markup as {
				inline_keyboard: Array<Array<{ callback_data?: string; url?: string }>>;
			}
		).inline_keyboard.flat();
	const approveData = (card: TelegramCall) =>
		buttonsOf(card).find((button) => button.callback_data?.includes('"ba"'))?.callback_data ?? "";
	const rejectData = (card: TelegramCall) =>
		buttonsOf(card).find((button) => button.callback_data?.includes('"br"'))?.callback_data ?? "";

	async function claimStatus(claimId: string): Promise<string> {
		const { rows } = await admin.query<{ status: string }>(
			"select status from travel_expense_claim where id = $1",
			[claimId],
		);
		return only(rows).status;
	}

	async function decisions(claimId: string) {
		const { rows } = await admin.query(
			`select d.* from approval_decision_evidence d
			 join approval_submitted_revision s
			   on s.id = d.submitted_revision_id and s.organization_id = d.organization_id
			 where s.organization_id = $1 and s.source_id = $2 and d.operation_kind = 'command'
			 order by d.decided_at, d.id`,
			[ids.organization, claimId],
		);
		return rows;
	}

	async function invocations() {
		const { rows } = await admin.query(
			"select * from approval_invocation where organization_id = $1 order by created_at, id",
			[ids.organization],
		);
		return rows;
	}

	async function bindings() {
		const { rows } = await admin.query(
			"select * from approval_review_binding where organization_id = $1 order by created_at, id",
			[ids.organization],
		);
		return rows;
	}

	async function messages(claimId: string) {
		const { rows } = await admin.query(
			`select * from approval_delivery_message
			 where organization_id = $1 and legacy_source_id = $2 order by remote_message_id`,
			[ids.organization, claimId],
		);
		return rows;
	}

	async function revisionId(claimId: string): Promise<string> {
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_submitted_revision
			 where organization_id = $1 and source_type = 'travel_expense_claim' and source_id = $2`,
			[ids.organization, claimId],
		);
		return only(rows).id;
	}

	/**
	 * The exact-item review (#289) as the manager: the arrival rechecks access,
	 * then the review panel loads the inbox detail API.
	 */
	async function detail(requestId: string): Promise<ApprovalInboxDetailResult> {
		const previous = { userId: harness.userId, organizationId: harness.organizationId };
		actAs(ids.managerUser);
		try {
			const arrival = await resolveApprovalReviewArrival({
				userId: ids.managerUser,
				activeOrganizationId: ids.organization,
				target: parseApprovalReviewTarget({
					organizationId: ids.organization,
					kind: "compatibility",
					id: requestId,
				}),
			});
			expect(arrival.status).toBe("ready");
			const response = await getApprovalDetail({} as NextRequest, {
				params: Promise.resolve({ id: requestId }),
			});
			expect(response.status).toBe(200);
			return (await response.json()) as ApprovalInboxDetailResult;
		} finally {
			harness.userId = previous.userId;
			harness.organizationId = previous.organizationId;
		}
	}

	function submittedRows(result: ApprovalInboxDetailResult) {
		const section = result.sections.find(
			(candidate) =>
				candidate.type === "key_value" &&
				typeof candidate.title === "object" &&
				candidate.title.fallback === "Submitted claim",
		);
		if (section?.type !== "key_value") return null;
		return Object.fromEntries(
			section.rows.map((row) => [
				typeof row.label === "string" ? row.label : row.label.fallback,
				typeof row.value === "string"
					? row.value
					: "fallback" in row.value
						? row.value.fallback
						: "change",
			]),
		);
	}

	/** Makes the claim's live receipt differ from the frozen manifest. */
	async function changeReceiptContent(claimId: string) {
		await admin.query(
			"update travel_expense_attachment set checksum_sha256 = $2 where claim_id = $1",
			[claimId, "f".repeat(64)],
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
			throw new Error("Expense review and decisions PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		actAs(null);
		harness.notifications = [];
		harness.kicks.length = 0;
		harness.privateObjects.clear();
		harness.publicObjects.clear();
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

	it("reviews the exact claim from its frozen submission and holds changed or unevidenced claims", async () => {
		await seed({ presentation: false, delivery: false });
		const { claimId, requestId } = await submitClaim();

		const current = await detail(requestId);
		expect(submittedRows(current)).toEqual({
			Employee: "Avery Requester",
			"Claim type": "Receipt",
			"Trip dates": "2026-03-29 – 2026-03-31",
			"Dates entered in": "Europe/Berlin",
			"Claim amount": "120.50 EUR",
			Destination: "Hamburg, DE",
			Receipts: "1: hotel-invoice.pdf",
		});
		expect(current.actions.canApprove).toBe(true);
		expect(current.item.summary.subtitle).toBe("Hamburg - Mar 29-31, 2026");
		expect(JSON.stringify(current.sections)).not.toContain("Private note");

		// A changed receipt set is a material change: shown and held.
		await changeReceiptContent(claimId);
		const changed = await detail(requestId);
		expect(changed.sections).toContainEqual(
			expect.objectContaining({ type: "callout", title: "Claim changed after submission" }),
		);
		expect(changed.actions).toMatchObject({ canApprove: false, canReject: false });
		actAs(ids.managerUser);
		const held = await approveTravelExpenseClaim({ claimId });
		expect(held.success).toBe(false);
		expect(await claimStatus(claimId)).toBe("submitted");
		expect(await decisions(claimId)).toHaveLength(0);

		// A claim submitted before capture has no frozen submission: held while
		// capture is active, never reconstructed from live rows.
		await setCapture(false);
		const legacy = await submitClaim();
		await setCapture(true);
		const unevidenced = await detail(legacy.requestId);
		expect(submittedRows(unevidenced)).toBeNull();
		expect(unevidenced.sections).toContainEqual(
			expect.objectContaining({ type: "callout", title: "Submitted facts unavailable" }),
		);
		expect(unevidenced.actions.canApprove).toBe(false);
		actAs(ids.managerUser);
		const required = await approveTravelExpenseClaim({ claimId: legacy.claimId });
		expect(required).toMatchObject({ success: false });
		expect(await claimStatus(legacy.claimId)).toBe("submitted");
	});

	it("records web decision evidence from the persisted rows and replays only the exact retry", async () => {
		await seed({ presentation: false, delivery: false });
		const { claimId, requestId } = await submitClaim();
		actAs(ids.managerUser);
		const approved = await approveTravelExpenseClaim({ claimId });
		expect(approved).toEqual({ success: true, data: { status: "approved" } });
		expect(harness.notifications).toEqual(["approved"]);

		const decision = only(await decisions(claimId));
		const { rows: requestRows } = await admin.query<{ approved_at: Date }>(
			"select approved_at from approval_request where id = $1",
			[requestId],
		);
		expect(decision).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			legacy_approval_request_id: requestId,
			submitted_revision_id: await revisionId(claimId),
			action: "approve",
			assignment_outcome: "approved",
			request_outcome: "approved",
			actor_kind: "employee",
			actor_employee_id: ids.manager,
			actor_user_id: ids.managerUser,
			reviewed_binding_id: null,
			labels: { actorName: "Morgan Manager" },
			result: {
				claimStatus: "approved",
				legacyRequestStatus: "approved",
				decidedAtSource: "approval_request.approved_at",
				actorAuthority: "assigned_approver",
			},
		});
		expect(decision.decided_at.toISOString()).toBe(only(requestRows).approved_at.toISOString());
		expect(decision.receipt_idempotency_key).toMatch(
			new RegExp(`^travel_expense_claim:${claimId}:${requestId}:approve:[0-9a-f]{64}$`),
		);

		// The exact authenticated retry (inbox handler, same request) replays:
		// no mutation, evidence or notification.
		const replay = await Effect.runPromise(
			TravelExpenseClaimHandler.approve(claimId, ids.manager, {
				approvalRequestId: requestId,
			}).pipe(Effect.provide(DatabaseServiceLive), Effect.either),
		);
		expect(replay._tag).toBe("Right");
		expect(await decisions(claimId)).toHaveLength(1);
		expect(harness.notifications).toEqual(["approved"]);

		// A different command is not a replay and the decided request refuses it.
		const different = await Effect.runPromise(
			TravelExpenseClaimHandler.reject(claimId, ids.manager, "Too late", {
				approvalRequestId: requestId,
			}).pipe(Effect.provide(DatabaseServiceLive), Effect.either),
		);
		expect(different._tag).toBe("Left");
		expect(await decisions(claimId)).toHaveLength(1);
		expect(await claimStatus(claimId)).toBe("approved");

		// The historical outcome survives later source edits.
		await admin.query(
			"update travel_expense_claim set calculated_amount = '999.99' where id = $1",
			[claimId],
		);
		const history = await detail(requestId);
		expect(submittedRows(history)?.["Claim amount"]).toBe("120.50 EUR");
		const timeline = history.sections.find(
			(section) => section.type === "timeline" && section.title === "Evidence history",
		);
		expect(timeline?.type === "timeline" && timeline.events.map((event) => event.label)).toEqual(
			["Submitted", "Claim approved"],
		);
	});

	it("records a rejection at its persisted time and never stores the reason", async () => {
		await seed({ presentation: false, delivery: false });
		const { claimId, requestId } = await submitClaim();
		actAs(ids.managerUser);
		const rejected = await rejectTravelExpenseClaim({
			claimId,
			reason: "Hotel exceeds the travel policy",
		});
		expect(rejected).toEqual({ success: true, data: { status: "rejected" } });
		const decision = only(await decisions(claimId));
		const { rows } = await admin.query<{ updated_at: Date }>(
			"select updated_at from approval_request where id = $1",
			[requestId],
		);
		expect(decision).toMatchObject({
			action: "reject",
			assignment_outcome: "rejected",
			request_outcome: "rejected",
			result: { decidedAtSource: "approval_request.updated_at", claimStatus: "rejected" },
		});
		expect(decision.decided_at.toISOString()).toBe(only(rows).updated_at.toISOString());
		expect(JSON.stringify(decision)).not.toContain("Hotel exceeds");
	});

	it("keeps expense cards unsent without a delivery control and review-only until every gate holds", async () => {
		// No delivery control: no intent, nothing owned or sent.
		await seed({ delivery: false });
		await submitClaim();
		const { rows: noIntents } = await admin.query(
			"select id from approval_delivery_intent where organization_id = $1",
			[ids.organization],
		);
		expect(noIntents).toHaveLength(0);
		expect(harness.kicks).toEqual([]);
		await deliver();
		expect(sends()).toHaveLength(0);

		// Delivery control but no card admission: a review-only notice, no binding.
		await seed({ presentation: false });
		const reviewOnly = await submitClaim();
		await deliver();
		const notice = only(sends());
		expect(buttonsOf(notice).some((button) => button.callback_data)).toBe(false);
		expect(String(notice.body.text)).toContain("Review required");
		expect(String(notice.body.text)).not.toContain("120.50");
		expect(only(await messages(reviewOnly.claimId))).toMatchObject({
			lifecycle: "legacy",
			controls: "none",
			binding_id: null,
		});
		expect(await bindings()).toHaveLength(0);

		// Admission without capture is not enough either.
		await seed({ capture: false });
		calls.length = 0;
		await submitClaim();
		await deliver();
		expect(buttonsOf(only(sends())).some((button) => button.callback_data)).toBe(false);
		expect(await bindings()).toHaveLength(0);
	});

	it("sends one bound card with the frozen facts through the committed intent (commit before send)", async () => {
		await seed();
		const { claimId, requestId } = await submitClaim();
		expect(harness.kicks).toEqual([{ organizationId: ids.organization }]);
		expect(sends()).toHaveLength(0);
		const { rows: intents } = await admin.query(
			"select * from approval_delivery_intent where organization_id = $1",
			[ids.organization],
		);
		expect(only(intents)).toMatchObject({
			workflow_type: "travel_expense",
			source_type: "travel_expense_claim",
			source_id: claimId,
			legacy_approval_request_id: requestId,
			event: "submitted",
			expansion_status: "pending",
		});

		const summary = await deliver();
		expect(summary.outcomes).toEqual({ delivered: 1 });
		const card = only(sends());
		const text = String(card.body.text);
		expect(card.body.chat_id).toBe(String(MANAGER_CHAT_ID));
		expect(text).toContain("Travel expense approval request");
		expect(text).toContain("Employee: Avery Requester");
		expect(text).toContain("Claim type: Receipt");
		expect(text).toContain("Trip dates: Mar 29, 2026 – Mar 31, 2026");
		expect(text).toContain("Claim amount: 120.50 EUR");
		expect(text).toContain("Receipts: 1 attached");
		expect(text).not.toContain("Private note");
		expect(text).not.toContain("hotel-invoice");
		const review = buttonsOf(card).find((button) => button.url);
		expect(review?.url).toBe(
			`https://t296.example.test/approvals/review/${ids.organization}/compatibility/${requestId}`,
		);

		const binding = only(await bindings());
		expect(binding).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			stage_id: null,
			assignment_id: null,
			legacy_approval_request_id: requestId,
			recipient_employee_id: ids.manager,
			submitted_revision_id: await revisionId(claimId),
		});
		expect(only(await messages(claimId))).toMatchObject({
			lifecycle: "legacy",
			workflow_id: null,
			workflow_type: "travel_expense",
			legacy_source_type: "travel_expense_claim",
			legacy_approval_request_id: requestId,
			approval_request_id: requestId,
			recipient_employee_id: ids.manager,
			receiver_scope: RECEIVER_SCOPE,
			destination_id: String(MANAGER_CHAT_ID),
			binding_id: binding.id,
			controls: "actionable",
			state: "current",
			status_version: 1,
		});
		const { rows: expanded } = await admin.query<{ expansion_status: string }>(
			"select expansion_status from approval_delivery_intent where organization_id = $1",
			[ids.organization],
		);
		expect(only(expanded).expansion_status).toBe("expanded");

		// Re-running the owner never sends the same effect again.
		await deliver(T0.add({ hours: 1 }));
		expect(sends()).toHaveLength(1);
	});

	it("decides from Telegram with an atomic invocation, replays the exact press and refreshes the card", async () => {
		await seed();
		const { claimId, requestId } = await submitClaim();
		await deliver();
		const card = only(sends());
		const message = only(await messages(claimId));

		await press(Number(message.remote_message_id), approveData(card), "t296-q-1");
		expect(await claimStatus(claimId)).toBe("approved");
		expect(harness.notifications).toEqual(["approved"]);
		expect(only(answers()).body.text).toBe("Request approved");
		// The decided card is left to the owner, its only writer.
		expect(edits()).toHaveLength(0);

		const decision = only(await decisions(claimId));
		const invocation = only(await invocations());
		expect(decision).toMatchObject({
			authority: "legacy",
			legacy_approval_request_id: requestId,
			reviewed_binding_id: message.binding_id,
			actor_employee_id: ids.manager,
			request_outcome: "approved",
		});
		expect(decision.receipt_idempotency_key).toMatch(
			/^approval-invocation:v1:telegram_callback_query:/,
		);
		expect(invocation).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			legacy_approval_request_id: requestId,
			reviewed_binding_id: message.binding_id,
			decision_evidence_id: decision.id,
			receipt_idempotency_key: decision.receipt_idempotency_key,
			receiver_scope: RECEIVER_SCOPE,
			invocation_id: "t296-q-1",
			provider_actor_id: String(MANAGER_TELEGRAM_ID),
			action: "approve",
		});
		expect(invocation.delivery_id).toMatch(/^\d+$/);

		// The same query again (a redelivery) replays the original result.
		await press(Number(message.remote_message_id), approveData(card), "t296-q-1");
		expect(answers()[1]?.body.text).toBe("Request approved");
		expect(await decisions(claimId)).toHaveLength(1);
		expect(await invocations()).toHaveLength(1);
		expect(harness.notifications).toEqual(["approved"]);

		// The same query with a different command is a conflict; a new query
		// after the decision decides nothing.
		const conflict = await attempt({
			bindingId: message.binding_id,
			queryId: "t296-q-1",
			action: "reject",
		});
		expect(conflict).toEqual({ status: "conflict" });
		const fresh = await attempt({ bindingId: message.binding_id, queryId: "t296-q-2" });
		expect(fresh).toEqual({ status: "review_required" });
		expect(await decisions(claimId)).toHaveLength(1);

		// The committed intent brings the card to its current status, without controls.
		await deliver(T0.add({ minutes: 1 }));
		const edit = only(edits());
		expect(edit.body.message_id).toBe(Number(message.remote_message_id));
		expect(String(edit.body.text)).toContain("Request approved");
		expect(String(edit.body.text)).toContain("Approved by Morgan Manager");
		expect(buttonsOf(edit).every((button) => !button.callback_data)).toBe(true);
		expect(only(await messages(claimId))).toMatchObject({
			controls: "none",
			state: "retired",
			status_version: 2,
		});

		// After a later source edit the committed press still replays its original.
		await admin.query(
			"update travel_expense_claim set calculated_amount = '999.99' where id = $1",
			[claimId],
		);
		const replay = await attempt({ bindingId: message.binding_id, queryId: "t296-q-1" });
		expect(replay).toMatchObject({ status: "decided", replayed: true });
		expect(replay.status === "decided" && replay.evidence.id).toBe(decision.id);
	});

	it("carries a two-stage chain: an intermediate outcome, the next stage's card and the final status", async () => {
		await seed({ twoStageChain: true });
		const { claimId, requestId } = await submitClaim();
		await deliver();
		const firstCard = only(sends());
		const firstMessage = only(await messages(claimId));

		// Stage one decides from Telegram: recorded, not final.
		await press(Number(firstMessage.remote_message_id), approveData(firstCard), "t296-q-stage-1");
		expect(await claimStatus(claimId)).toBe("submitted");
		expect(only(answers()).body.text).toBe("Approval recorded");
		expect(harness.notifications).toEqual([]);
		const stageOne = only(await decisions(claimId));
		expect(stageOne).toMatchObject({
			legacy_approval_request_id: requestId,
			assignment_outcome: "approved",
			request_outcome: "pending",
			result: {
				claimStatus: "submitted",
				decidedAtSource: "approval_chain_stage_instance.decided_at",
			},
		});
		expect(stageOne.legacy_chain_stage_id).toBeTruthy();

		// The owner sends stage two its own bound card (recipient locale) and
		// brings stage one's card to its committed step outcome.
		await deliver(T0.add({ minutes: 1 }));
		const secondCard = only(sends().filter((call) => call.body.chat_id === String(BACKUP_CHAT_ID)));
		expect(String(secondCard.body.text)).toContain("120,50 EUR");
		const { rows: stageTwoRows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where entity_id = $1 and status = 'pending' and approver_id = $2`,
			[claimId, ids.backupManager],
		);
		const stageTwoRequest = only(stageTwoRows).id;
		const stageTwoMessage = (await messages(claimId)).find(
			(message) => message.legacy_approval_request_id === stageTwoRequest,
		);
		expect(stageTwoMessage).toMatchObject({ controls: "actionable", status_version: 2 });
		const firstEdit = only(edits());
		expect(String(firstEdit.body.text)).toContain("Approval recorded");
		expect(String(firstEdit.body.text)).toContain("still awaits further approval");

		// Stage two decides on the web: the claim is approved.
		actAs(ids.backupUser);
		const approved = await approveTravelExpenseClaim({ claimId });
		expect(approved.success).toBe(true);
		expect(await claimStatus(claimId)).toBe("approved");
		const [, stageTwo] = await decisions(claimId);
		expect(stageTwo).toMatchObject({
			legacy_approval_request_id: stageTwoRequest,
			actor_employee_id: ids.backupManager,
			request_outcome: "approved",
		});

		// Both cards reach the final status; stage one keeps its own outcome.
		await deliver(T0.add({ minutes: 2 }));
		const finalEdits = edits().slice(1);
		expect(finalEdits).toHaveLength(2);
		const stageOneFinal = finalEdits.find(
			(edit) => edit.body.message_id === Number(firstMessage.remote_message_id),
		);
		expect(String(stageOneFinal?.body.text)).toContain("Approval recorded");
		expect(String(stageOneFinal?.body.text)).toContain("Current request status: approved.");
		const stageTwoFinal = finalEdits.find(
			(edit) => edit.body.message_id === Number(stageTwoMessage?.remote_message_id),
		);
		if (!stageTwoFinal) throw new Error("stage two card was not refreshed");
		expect(buttonsOf(stageTwoFinal).every((button) => !button.callback_data)).toBe(true);
		expect((await messages(claimId)).map((message) => message.status_version)).toEqual([3, 3]);

		// The review history separates the step from the claim outcome.
		const history = await detail(requestId);
		const timeline = history.sections.find(
			(section) => section.type === "timeline" && section.title === "Evidence history",
		);
		expect(timeline?.type === "timeline" && timeline.events.map((event) => event.label)).toEqual(
			["Submitted", "Approval recorded — awaiting further approval", "Claim approved"],
		);
	});

	it("refreshes a delivered card after a web rejection", async () => {
		await seed();
		const { claimId } = await submitClaim();
		await deliver();
		const message = only(await messages(claimId));
		actAs(ids.managerUser);
		const rejected = await rejectTravelExpenseClaim({ claimId, reason: "Duplicate" });
		expect(rejected.success).toBe(true);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		await deliver(T0.add({ minutes: 1 }));
		const edit = only(edits());
		expect(edit.body.message_id).toBe(Number(message.remote_message_id));
		expect(String(edit.body.text)).toContain("Request rejected");
		expect(String(edit.body.text)).not.toContain("Duplicate");
		expect(buttonsOf(edit).every((button) => !button.callback_data)).toBe(true);
	});

	it("decides nothing from a changed, paused, reassigned, foreign or someone else's card", async () => {
		await seed();
		const first = await submitClaim();
		await deliver();
		const firstCard = only(sends());
		const firstMessage = only(await messages(first.claimId));

		// Receipt set changed after the card was rendered: nothing decided, and the
		// still-pending card becomes a review notice without controls.
		await changeReceiptContent(first.claimId);
		await press(Number(firstMessage.remote_message_id), approveData(firstCard), "t296-q-changed");
		expect(await claimStatus(first.claimId)).toBe("submitted");
		expect(await decisions(first.claimId)).toHaveLength(0);
		expect(only(answers()).body.text).toBe("Review required");
		expect(String(only(edits()).body.text)).toContain("No decision was made");
		expect(only(await messages(first.claimId))).toMatchObject({ controls: "none" });

		// Paused admission: a fresh press on a sent card decides nothing.
		const second = await submitClaim();
		await deliver(T0.add({ minutes: 1 }));
		const secondMessage = only(await messages(second.claimId));
		await admin.query(
			`update approval_presentation_control set mode = 'review_only'
			 where organization_id = $1 and workflow_type = 'travel_expense'`,
			[ids.organization],
		);
		expect(
			await attempt({ bindingId: secondMessage.binding_id, queryId: "t296-q-paused" }),
		).toEqual({ status: "review_required" });
		await admin.query(
			`update approval_presentation_control set mode = 'actionable'
			 where organization_id = $1 and workflow_type = 'travel_expense'`,
			[ids.organization],
		);

		// The request moved to another approver: the former holder's card is stale.
		await admin.query("update approval_request set approver_id = $2 where id = $1", [
			second.requestId,
			ids.backupManager,
		]);
		expect(
			await attempt({ bindingId: secondMessage.binding_id, queryId: "t296-q-moved" }),
		).toEqual({ status: "review_required" });
		await admin.query("update approval_request set approver_id = $2 where id = $1", [
			second.requestId,
			ids.manager,
		]);

		// Another tenant's context and another member never reach the binding.
		expect(
			await attempt({
				bindingId: secondMessage.binding_id,
				queryId: "t296-q-foreign",
				organizationId: ids.otherOrganization,
				actorEmployeeId: ids.otherEmployee,
				actorUserId: ids.otherUser,
			}),
		).toEqual({ status: "not_found" });
		expect(
			await attempt({
				bindingId: secondMessage.binding_id,
				queryId: "t296-q-backup",
				actorEmployeeId: ids.backupManager,
				actorUserId: ids.backupUser,
			}),
		).toEqual({ status: "not_found" });
		expect(await claimStatus(second.claimId)).toBe("submitted");
		expect(await decisions(second.claimId)).toHaveLength(0);
		expect(await invocations()).toHaveLength(0);

		// The same card still decides once everything matches again.
		expect(
			await attempt({ bindingId: secondMessage.binding_id, queryId: "t296-q-ok", action: "reject" }),
		).toMatchObject({ status: "decided", replayed: false });
		expect(await claimStatus(second.claimId)).toBe("rejected");
	});

	it("rolls back the whole decision when its invocation cannot be recorded, then decides freshly", async () => {
		await seed();
		const { claimId } = await submitClaim();
		await deliver();
		const message = only(await messages(claimId));
		await admin.query(`
			create or replace function t296_fail_invocation() returns trigger language plpgsql as $$
			begin
				raise exception 't296 injected invocation failure';
			end;
			$$;
		`);
		await admin.query(`
			create trigger t296_fail_invocation before insert on approval_invocation
			for each row execute function t296_fail_invocation();
		`);
		try {
			await expect(
				attempt({ bindingId: message.binding_id, queryId: "t296-q-rollback" }),
			).rejects.toThrow();
		} finally {
			await admin.query("drop trigger if exists t296_fail_invocation on approval_invocation");
			await admin.query("drop function if exists t296_fail_invocation()");
		}
		expect(await claimStatus(claimId)).toBe("submitted");
		expect(await decisions(claimId)).toHaveLength(0);
		const { rows: requests } = await admin.query<{ status: string }>(
			"select status from approval_request where entity_id = $1",
			[claimId],
		);
		expect(only(requests).status).toBe("pending");
		expect(harness.notifications).toEqual([]);

		expect(
			await attempt({ bindingId: message.binding_id, queryId: "t296-q-rollback" }),
		).toMatchObject({ status: "decided", replayed: false });
		expect(await claimStatus(claimId)).toBe("approved");
	});

	it("serializes concurrent deliveries of one press into one decision", async () => {
		await seed();
		const { claimId } = await submitClaim();
		await deliver();
		const message = only(await messages(claimId));
		const results = await Promise.all(
			[1, 2, 3].map(() => attempt({ bindingId: message.binding_id, queryId: "t296-q-race" })),
		);
		expect(results.every((result) => result.status === "decided")).toBe(true);
		expect(
			results.filter((result) => result.status === "decided" && !result.replayed),
		).toHaveLength(1);
		expect(await decisions(claimId)).toHaveLength(1);
		expect(await invocations()).toHaveLength(1);
		expect(harness.notifications).toEqual(["approved"]);
	});

	it("purges one lifecycle's evidence, bindings, invocations and delivery, and a late press recreates nothing", async () => {
		await seed();
		const kept = await submitClaim();
		const { claimId, requestId } = await submitClaim();
		await deliver();
		const message = only(await messages(claimId));
		await attempt({ bindingId: message.binding_id, queryId: "t296-q-purge" });
		await deliver(T0.add({ minutes: 1 }));
		const revision = await revisionId(claimId);
		const decision = only(await decisions(claimId));
		const invocation = only(await invocations());
		const { rows: workRows } = await admin.query<{ id: string }>(
			"select id from approval_delivery_work where legacy_source_id = $1 order by id",
			[claimId],
		);
		const { rows: intentRows } = await admin.query<{ id: string }>(
			"select id from approval_delivery_intent where source_id = $1 order by id",
			[claimId],
		);

		const deleted = await deleteApproval(db, ids.organization, requestId);
		expect(deleted.legacyRequests).toEqual([requestId]);
		expect(deleted.evidence).toMatchObject({
			submittedRevisions: [revision],
			decisionEvidence: [decision.id],
			reviewBindings: [message.binding_id],
			invocations: [invocation.id],
		});
		expect(deleted.delivery).toEqual({
			work: workRows.map((row) => row.id).sort(),
			messages: [message.id],
			intents: intentRows.map((row) => row.id).sort(),
		});
		expect(await claimStatus(claimId)).toBe("approved");
		expect(await messages(claimId)).toHaveLength(0);
		expect(await invocations()).toHaveLength(0);

		// The other claim's lifecycle is untouched.
		expect(await revisionId(kept.claimId)).toBeTruthy();
		expect(only(await messages(kept.claimId))).toMatchObject({ controls: "actionable" });

		// A late redelivery of the purged press finds nothing and recreates nothing.
		expect(await attempt({ bindingId: message.binding_id, queryId: "t296-q-purge" })).toEqual({
			status: "not_found",
		});
		expect(await invocations()).toHaveLength(0);
		expect(await decisions(claimId)).toHaveLength(0);
	});
});
