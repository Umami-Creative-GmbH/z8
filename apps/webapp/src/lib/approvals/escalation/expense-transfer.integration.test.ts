/**
 * #326 / T61 runtime evidence: escalation transfers legacy-authoritative
 * travel expense requests and only the replacement (or explicit organization
 * management) decides them afterwards.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Real callers run against that database: the draft/upload/submit expense
 * actions, `processDueEscalations`, the escalation settings actions, the
 * inbox approve route with the real CASL abilities, the expense page
 * decision action, the approval delivery owner and Telegram webhook, and
 * approval maintenance. Only the session, e-mail/notification fan-out, object
 * storage (an in-memory bucket), the vault, the post-commit fast path and the
 * Telegram HTTP transport (fetch) are replaced.
 */

import { NextRequest } from "next/server";
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
	publicObjects: new Map<string, Uint8Array>(),
	privateObjects: new Map<string, { bytes: Buffer; versionId: string }>(),
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
			max: 8,
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

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t326e.example.test",
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

vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t326-public",
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
		return { bucket: "t326-private", versionId };
	},
	deletePrivateObject: async (input: { key: string }) => {
		harness.privateObjects.delete(input.key);
	},
}));

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async () => "326326327:AAT326-escalated_expenses",
}));

// The best-effort fast path only runs the owner sooner; each test runs it explicitly.
vi.mock("@/lib/approvals/delivery/kick", () => ({ kickApprovalDelivery: () => undefined }));

const BOT_TOKEN = "326326327:AAT326-escalated_expenses";

const { approveTravelExpenseClaim, createTravelExpenseDraft, submitTravelExpenseClaim } =
	await import("@/app/[locale]/(app)/travel-expenses/actions");
const { POST: processUpload } = await import("@/app/api/upload/travel-expense/process/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
await import("@/lib/approvals/init");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { listApprovalEscalationCandidates, transferApprovalEscalationAssignment } = await import(
	"@/app/[locale]/(app)/settings/approval-escalation/actions"
);
const { processDueEscalations } = await import("./transfer");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { parseInstant } = await import("@/lib/datetime/temporal-core");
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
	describe.skip(`escalated expenses PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const MANAGER_TELEGRAM_ID = 32_611;
const MANAGER_CHAT_ID = 326_111;
// Pinned delivery pass time; it must lie after the real time the test runs at.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

const ids = {
	organization: "t326-expense-org",
	requesterUser: "t326e-requester-user",
	managerUser: "t326e-manager-user",
	backupUser: "t326e-backup-user",
	thirdUser: "t326e-third-user",
	adminUser: "t326e-admin-user",
	requester: "e3265000-0000-4000-8000-000000000001",
	manager: "e3265000-0000-4000-8000-000000000002",
	backup: "e3265000-0000-4000-8000-000000000003",
	third: "e3265000-0000-4000-8000-000000000004",
	admin: "e3265000-0000-4000-8000-000000000005",
	managerLink: "e3266000-0000-4000-8000-000000000001",
	backupLink: "e3266000-0000-4000-8000-000000000002",
	thirdLink: "e3266000-0000-4000-8000-000000000003",
	policy: "e3267000-0000-4000-8000-000000000001",
	firstStage: "e3267000-0000-4000-8000-000000000002",
	secondStage: "e3267000-0000-4000-8000-000000000003",
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

describeIntegration("escalated legacy travel expenses (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 32_610;
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

	async function cleanup() {
		await admin.query("delete from travel_expense_receipt_upload where organization_id = $1", [
			ids.organization,
		]);
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser],
		]);
	}

	async function seed(options: { cards?: boolean; twoStageChain?: boolean } = {}) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at, timezone)
			 values ($1, 'T326 expenses', $1, $2, 'Europe/Berlin')`,
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
			 values ($1, true, 1, 1, '{"source":"t326"}'::jsonb)`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'travel_expense', 'capture')`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't326e-requester@example.test', $6, $6),
			 ($2, 'Morgan Manager', 't326e-manager@example.test', $6, $6),
			 ($3, 'Blake Backup', 't326e-backup@example.test', $6, $6),
			 ($4, 'Taylor Third', 't326e-third@example.test', $6, $6),
			 ($5, 'Ada Admin', 't326e-admin@example.test', $6, $6)`,
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'Europe/Berlin', '24h', $2)`,
			[ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't326e-member-' || user_id, $1, user_id,
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
		if (options.cards) {
			await admin.query(
				`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
				 values ($1, 'travel_expense', 'telegram', 'actionable')`,
				[ids.organization],
			);
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, 'travel_expense', 'telegram', $2)`,
				[ids.organization, timestamp],
			);
			await admin.query(
				`insert into telegram_bot_config
				 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
				  enable_approvals, enable_escalations, updated_at)
				 values ($1, 'vault:managed', 't326e_bot', 't326e-secret', 'active', true, true, $2)`,
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
		if (options.twoStageChain) {
			await admin.query(
				`insert into approval_policy
				 (id, organization_id, name, is_active, priority, created_by, updated_at)
				 values ($1, $2, 'T326 two stages', true, 1, $3, $4)`,
				[ids.policy, ids.organization, ids.managerUser, timestamp],
			);
			await admin.query(
				`insert into approval_policy_stage
				 (id, organization_id, policy_id, step_order, label, approver_type,
				  approver_employee_id, fallback_behavior, updated_at) values
				 ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', $6),
				 ($2, $3, $4, 2, 'Finance', 'specific_employee', $5, 'fail', $6)`,
				[ids.firstStage, ids.secondStage, ids.organization, ids.policy, ids.admin, timestamp],
			);
		}
	}

	/** Draft, one receipt upload and submission through the real actions. */
	async function submitClaim(): Promise<{ claimId: string; requestId: string; createdAt: Date }> {
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
			notes: "T326",
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
		const { rows } = await admin.query<{ id: string; created_at: Date }>(
			// Legacy timestamps are UTC wall time without a zone.
			`select id, created_at at time zone 'UTC' as created_at from approval_request
			 where organization_id = $1 and entity_type = 'travel_expense_claim'
			   and entity_id = $2 and status = 'pending'`,
			[ids.organization, claimId],
		);
		const request = only(rows);
		return { claimId, requestId: request.id, createdAt: request.created_at };
	}

	function processAt(createdAt: Date, plusMinutes: number) {
		return processDueEscalations({
			organizationId: ids.organization,
			now: parseInstant(new Date(createdAt.getTime() + plusMinutes * 60_000).toISOString()),
		});
	}

	async function request(requestId: string) {
		const { rows } = await admin.query(
			"select approver_id, status, metadata from approval_request where id = $1",
			[requestId],
		);
		return only(rows);
	}

	async function claimStatus(claimId: string) {
		const { rows } = await admin.query<{ status: string }>(
			"select status from travel_expense_claim where id = $1",
			[claimId],
		);
		return only(rows).status;
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

	async function approveAs(userId: string, approvalId: string) {
		actAs(userId);
		const response = await approveRoute(
			new NextRequest(`http://t326e.example.test/api/approvals/inbox/${approvalId}/approve`, {
				method: "POST",
			}),
			{ params: Promise.resolve({ id: approvalId }) },
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
			throw new Error("Escalated expenses PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		actAs(null);
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

	it("transfers a due expense request at its exact deadline; only the replacement decides it", async () => {
		await seed();
		const { claimId, requestId, createdAt } = await submitClaim();
		expect((await request(requestId)).approver_id).toBe(ids.manager);

		// Not even discovered one minute before the deadline.
		const early = await processAt(createdAt, 59);
		expect(early).toMatchObject({
			authorities: { travel_expense: "legacy" },
			examined: 0,
			transferred: 0,
		});
		const due = await processAt(createdAt, 60);
		expect(due).toMatchObject({ status: "processed", transferred: 1, failed: 0 });

		const moved = await request(requestId);
		expect(moved).toMatchObject({ approver_id: ids.backup, status: "pending" });
		expect(moved.metadata.escalation).toMatchObject({
			version: 1,
			transfers: [
				{
					sequence: 0,
					fromApproverEmployeeId: ids.manager,
					toApproverEmployeeId: ids.backup,
					initiator: "scheduled",
					actorEmployeeId: null,
				},
			],
		});
		const transfer = only(await journal());
		expect(transfer).toMatchObject({
			authority_mode: "legacy",
			initiator: "scheduled",
			workflow_type: "travel_expense",
			workflow_id: null,
			legacy_approval_request_id: requestId,
			legacy_source_sequence: 0,
			observed_workflow_id: null,
			source_approver_employee_id: ids.manager,
			replacement_approver_employee_id: ids.backup,
			requester_employee_id: ids.requester,
			actionable_evidence: "legacy_request_created_at",
			actor_kind: "system",
			actor_system_id: "approval-escalation",
			actor_user_id: null,
			operation_key: `escalation:auto:legacy:v1:${requestId}:0:${ids.manager}`,
		});
		expect(transfer.receipt_command_fingerprint).toMatch(/^travel_expense-legacy-transfer:v1:/);
		expect(transfer.deadline_at.getTime()).toBe(createdAt.getTime() + 3_600_000);
		const { rows: events } = await admin.query(
			"select expansion_status, payload from approval_escalation_transfer_event where transfer_id = $1",
			[transfer.id],
		);
		// Legacy replacement delivery is separate work (#408): the event waits.
		expect(only(events)).toMatchObject({
			expansion_status: "pending",
			payload: {
				authorityMode: "legacy",
				workflowType: "travel_expense",
				sourceType: "travel_expense_claim",
				sourceId: claimId,
			},
		});

		// The former holder stays an eligible manager, but neither the inbox nor
		// the expense page lets eligibility bypass the replacement.
		const stale = await approveAs(ids.managerUser, requestId);
		expect(stale.status).toBe(409);
		expect(String(stale.body.error)).toContain("reassigned");
		actAs(ids.managerUser);
		const page = await approveTravelExpenseClaim({ claimId });
		actAs(null);
		expect(page.success).toBe(false);
		expect(JSON.stringify(page)).toContain("reassigned");
		const other = await approveAs(ids.thirdUser, requestId);
		expect(other.status).toBe(409);
		expect(await claimStatus(claimId)).toBe("submitted");

		const decided = await approveAs(ids.backupUser, requestId);
		expect(decided).toMatchObject({ status: 200, body: { success: true } });
		expect(await claimStatus(claimId)).toBe("approved");
		const { rows: evidence } = await admin.query(
			`select actor_employee_id, legacy_approval_request_id from approval_decision_evidence
			 where organization_id = $1`,
			[ids.organization],
		);
		expect(only(evidence)).toMatchObject({
			actor_employee_id: ids.backup,
			legacy_approval_request_id: requestId,
		});
	});

	it("never transfers a lineage twice automatically", async () => {
		await seed();
		const { requestId, createdAt } = await submitClaim();
		await processAt(createdAt, 60);
		const transferredAt = only(await journal()).transferred_at as Date;

		const rerun = await processDueEscalations({
			organizationId: ids.organization,
			now: parseInstant(new Date(transferredAt.getTime() + 3_600_000).toISOString()),
		});

		expect(rerun).toMatchObject({ transferred: 0, held: { replacement_overdue: 1 } });
		expect(await journal()).toHaveLength(1);
		expect((await request(requestId)).approver_id).toBe(ids.backup);
		expect(only(await openAttention())).toMatchObject({
			reason: "replacement_overdue",
			approval_type: "travel_expense",
		});
	});

	it("decides nothing from the former holder's card after a transfer", async () => {
		await seed({ cards: true });
		const { claimId, requestId, createdAt } = await submitClaim();
		await processApprovalDeliveries({ organizationId: ids.organization, now: T0 });
		const card = only(calls.filter((call) => call.method === "sendMessage"));
		expect((await processAt(createdAt, 60)).transferred).toBe(1);

		const data =
			(
				card.body.reply_markup as {
					inline_keyboard: Array<Array<{ callback_data?: string }>>;
				}
			).inline_keyboard
				.flat()
				.find((button) => button.callback_data?.includes('"ba"'))?.callback_data ?? "";
		await handleTelegramUpdate(
			{
				update_id: 32_600,
				callback_query: {
					id: "t326e-q-former",
					from: { id: MANAGER_TELEGRAM_ID, is_bot: false, first_name: "Morgan" },
					message: {
						message_id: card.messageId ?? 0,
						date: 1_790_000_000,
						chat: { id: MANAGER_CHAT_ID, type: "private" as const },
					},
					data,
				},
			},
			{
				organizationId: ids.organization,
				botToken: BOT_TOKEN,
				botUsername: "t326e_bot",
				webhookSecret: "t326e-secret",
				setupStatus: "active",
				enableApprovals: true,
				enableCommands: true,
				enableDailyDigest: false,
				enableEscalations: true,
				digestTime: "09:00",
				digestTimezone: "UTC",
				escalationTimeoutHours: 24,
			},
		);

		expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
		expect(await request(requestId)).toMatchObject({ approver_id: ids.backup, status: "pending" });
		expect(await claimStatus(claimId)).toBe("submitted");
		const { rows: invocations } = await admin.query(
			"select id from approval_invocation where organization_id = $1",
			[ids.organization],
		);
		expect(invocations).toEqual([]);
	});

	it("transfers through the management action with audit and replay; explicit management decides", async () => {
		await seed();
		const { claimId, requestId, createdAt } = await submitClaim();

		actAs(ids.adminUser);
		const candidates = await listApprovalEscalationCandidates({ approvalRequestId: requestId });
		expect(candidates).toMatchObject({
			success: true,
			data: {
				currentApprover: { employeeId: ids.manager },
				candidates: [
					{ employeeId: ids.backup, recommended: true },
					{ employeeId: ids.third, recommended: false },
				],
			},
		});
		const transferRequest = {
			approvalRequestId: requestId,
			recipientEmployeeId: ids.third,
			idempotencyKey: "e3268000-0000-4000-8000-000000000001",
			reason: "Morgan is travelling",
		};
		expect(await transferApprovalEscalationAssignment(transferRequest)).toEqual({
			success: true,
			data: { replayed: false },
		});
		expect(await transferApprovalEscalationAssignment(transferRequest)).toEqual({
			success: true,
			data: { replayed: true },
		});
		actAs(null);
		const transfer = only(await journal());
		expect(transfer).toMatchObject({
			initiator: "human",
			authority_mode: "legacy",
			workflow_type: "travel_expense",
			actor_user_id: ids.adminUser,
			replacement_approver_employee_id: ids.third,
		});
		const { rows: audits } = await admin.query(
			"select action from audit_log where organization_id = $1 and entity_id = $2",
			[ids.organization, transfer.id],
		);
		expect(only(audits)).toMatchObject({ action: "approval_escalation.transferred" });

		// A human transfer does not consume the automatic allowance: the
		// requester's primary manager is the first eligible candidate again.
		const later = await processDueEscalations({
			organizationId: ids.organization,
			now: parseInstant(
				new Date((transfer.transferred_at as Date).getTime() + 3_600_000).toISOString(),
			),
		});
		expect(later.transferred).toBe(1);
		expect((await request(requestId)).approver_id).toBe(ids.manager);
		expect(createdAt).toBeInstanceOf(Date);

		const managed = await approveAs(ids.adminUser, requestId);
		expect(managed).toMatchObject({ status: 200, body: { success: true } });
		expect(await claimStatus(claimId)).toBe("approved");
	});

	it("serializes simultaneous scheduled attempts into one committed transfer", async () => {
		await seed();
		const { requestId, createdAt } = await submitClaim();

		const results = await Promise.all([processAt(createdAt, 60), processAt(createdAt, 60)]);

		expect(results.reduce((total, result) => total + result.transferred, 0)).toBe(1);
		expect(results.every((result) => result.failed === 0)).toBe(true);
		expect(await journal()).toHaveLength(1);
		expect((await request(requestId)).approver_id).toBe(ids.backup);
	});

	it("lets exactly one of a transfer and a concurrent decision by the current holder win", async () => {
		await seed();
		const { claimId, requestId, createdAt } = await submitClaim();

		const [processed, decision] = await Promise.all([
			processAt(createdAt, 60),
			approveAs(ids.managerUser, requestId),
		]);

		const transfers = await journal();
		if (decision.status === 200) {
			expect(await claimStatus(claimId)).toBe("approved");
			expect(transfers).toEqual([]);
		} else {
			expect(await request(requestId)).toMatchObject({
				status: "pending",
				approver_id: ids.backup,
			});
			expect(transfers).toHaveLength(1);
			expect(processed.transferred).toBe(1);
		}
		expect(processed.failed).toBe(0);
	});

	it("holds an expense chain stage as an unsupported route once due", async () => {
		await seed({ twoStageChain: true });
		const { requestId, createdAt } = await submitClaim();

		expect(await processAt(createdAt, 30)).toMatchObject({ transferred: 0, held: {} });
		expect(await processAt(createdAt, 60)).toMatchObject({
			transferred: 0,
			held: { unsupported_route: 1 },
		});
		expect((await request(requestId)).approver_id).toBe(ids.manager);
		expect(only(await openAttention())).toMatchObject({
			approval_type: "travel_expense",
			evidence: expect.objectContaining({ route: "legacy_chain_stage" }),
		});
	});

	it("holds expenses visibly under a rollout mode without legacy authority", async () => {
		await seed();
		const { requestId, createdAt } = await submitClaim();
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'travel_expense', 'canonical', 'canonical', now(), now())
			 on conflict (organization_id, workflow_type)
			 do update set lifecycle_mode = 'canonical', side_effect_mode = 'canonical'`,
			[ids.organization],
		);

		const due = await processAt(createdAt, 60);
		expect(due).toMatchObject({
			authorities: { travel_expense: "canonical" },
			transferred: 0,
			held: { unsupported_route: 1 },
		});
		expect((await request(requestId)).approver_id).toBe(ids.manager);
		expect(only(await openAttention())).toMatchObject({
			approval_type: "travel_expense",
			evidence: expect.objectContaining({ route: "travel_expense_without_legacy_authority" }),
		});
		// The held request no longer takes a place in later batches.
		expect(await processAt(createdAt, 180)).toMatchObject({ examined: 0 });
	});

	it("removes the expense lifecycle's legacy journal through approval maintenance", async () => {
		await seed();
		const { requestId, createdAt } = await submitClaim();
		await processAt(createdAt, 60);
		const transfer = only(await journal());

		const deleted = await deleteApproval(db as never, ids.organization, requestId);

		expect(deleted.escalationTransfers).toEqual([transfer.id]);
		expect(await journal()).toEqual([]);
	});
});
