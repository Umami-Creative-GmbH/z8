/**
 * #408 runtime evidence: replacement cards and "Reassigned" retirement of the
 * former holder's cards for legacy-authoritative escalation transfers of
 * absences (#299/#384) and travel expenses (#326/#296).
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Real callers run against that database: legacy absence submission
 * (`requestAbsenceEffect`) and the travel expense draft/upload/submit actions,
 * the delivery owner (`processApprovalDeliveries`), scheduled escalation
 * (`processDueEscalations`), the management transfer action, escalation's
 * replacement pass (`processEscalationReplacementDeliveries`), the Telegram
 * webhook (`handleTelegramUpdate`), the absence and expense decision owners,
 * the old notification path (`sendApprovalMessageToManager`), delivery
 * recovery and approval maintenance. Only the session, billing guard, e-mail
 * and notification fan-out, object storage, calendar queue, work-balance
 * marking, the vault, the post-commit fast path and the Telegram HTTP
 * transport (fetch) are replaced.
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

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t408.example.test",
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

vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t408-public",
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
	uploadPrivateObject: async () => {
		harness.versionCounter += 1;
		return { bucket: "t408-private", versionId: `v${harness.versionCounter}` };
	},
	deletePrivateObject: async () => undefined,
}));

vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	getOrgSecret: async () => "408408408:AAT408-legacy_replacement_test",
}));

// The best-effort fast path only runs the passes sooner; recording the calls
// keeps each test's delivery passes explicit and deterministic.
vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
		harness.kicks.push(input);
	},
}));

const BOT_TOKEN = "408408408:AAT408-legacy_replacement_test";
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { cancelAbsenceRequest } = await import("@/app/[locale]/(app)/absences/mutations");
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");
const { createTravelExpenseDraft, submitTravelExpenseClaim, approveTravelExpenseClaim } =
	await import("@/app/[locale]/(app)/travel-expenses/actions");
const { POST: processUpload } = await import("@/app/api/upload/travel-expense/process/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { transferApprovalEscalationAssignment } = await import(
	"@/app/[locale]/(app)/settings/approval-escalation/actions"
);
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { db } = await import("@/db");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { recoverApprovalDeliveryForAttention } = await import("@/lib/approvals/delivery/recovery");
const { telegramApprovalDeliveryAdapter } = await import("@/lib/telegram/approval-delivery");
const { sendApprovalMessageToManager } = await import("@/lib/telegram/approval-handler");
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
	describe.skip(`Legacy replacement delivery PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const TELEGRAM = { manager: 40_801, backup: 40_802, third: 40_803 } as const;
const CHAT = { manager: 408_111, backup: 408_222, third: 408_333 } as const;
// Pinned pass time. Submissions use the database's real time, so the pinned
// clock lies after it and every request is overdue for the one-hour window.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t408-legacy-org",
	otherOrganization: "t408-other-org",
	requesterUser: "t408-requester-user",
	managerUser: "t408-manager-user",
	backupUser: "t408-backup-user",
	thirdUser: "t408-third-user",
	adminUser: "t408-admin-user",
	requester: "e4080000-0000-4000-8000-000000000001",
	manager: "e4080000-0000-4000-8000-000000000002",
	backup: "e4080000-0000-4000-8000-000000000003",
	third: "e4080000-0000-4000-8000-000000000004",
	admin: "e4080000-0000-4000-8000-000000000005",
	managerLink: "e4081000-0000-4000-8000-000000000001",
	backupLink: "e4081000-0000-4000-8000-000000000002",
	thirdLink: "e4081000-0000-4000-8000-000000000003",
	category: "e4082000-0000-4000-8000-000000000001",
} as const;

type Subject = "absence" | "travel_expense";
type RolloutMode = "legacy" | "shadow" | "ready" | "canonical";

interface TelegramCall {
	method: string;
	body: Record<string, unknown>;
	messageId?: number;
}

type TransportResponse =
	| { kind: "ok" }
	| { kind: "error"; status: number; errorCode: number; description: string }
	| { kind: "network" };

interface Submitted {
	subject: Subject;
	sourceId: string;
	requestId: string;
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

describeIntegration("legacy escalation replacement delivery (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 3 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 40_800;
	const originalFetch = globalThis.fetch;
	/** Per-method scripted responses; anything unscripted succeeds. */
	const script: Record<string, TransportResponse[]> = {};
	/** Runs while a sendMessage is in flight, before Telegram "answers". */
	let duringSend: (() => Promise<void>) | null = null;

	function actAs(userId: string | null) {
		harness.userId = userId;
		harness.organizationId = userId ? ids.organization : null;
	}

	/** The Telegram Bot API transport; everything above it is real. */
	function installTelegramTransport() {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const match = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
			if (!match) throw new Error(`Unexpected fetch in test: ${url}`);
			const method = match[1] ?? "";
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
			const scripted = script[method]?.shift() ?? { kind: "ok" };
			const messageId =
				method === "sendMessage" && scripted.kind === "ok" ? nextMessageId++ : undefined;
			calls.push({ method, body, ...(messageId === undefined ? {} : { messageId }) });
			if (method === "sendMessage" && duringSend) {
				const hook = duringSend;
				duringSend = null;
				await hook();
			}
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
		await admin.query(
			"delete from travel_expense_receipt_upload where organization_id = any($1::text[])",
			[[ids.organization, ids.otherOrganization]],
		);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser],
		]);
	}

	async function seed(
		options: {
			mode?: RolloutMode;
			enableEscalations?: boolean;
			/** Kinds with a Telegram delivery control (default: both). */
			delivery?: Subject[];
			presentation?: "actionable" | "review_only";
		} = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const mode = options.mode ?? "legacy";
		await admin.query(
			`insert into organization (id, name, slug, created_at, timezone) values
			 ($1, 'T408 legacy', $1, $3, 'Europe/Berlin'), ($2, 'T408 other', $2, $3, 'Europe/Berlin')`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', $2, $3, $4, $4)`,
			[ids.organization, mode, mode === "canonical" ? "canonical" : "legacy", timestamp],
		);
		for (const kind of ["absence", "travel_expense"] as const) {
			await admin.query(
				`insert into approval_evidence_control (organization_id, workflow_type, mode)
				 values ($1, $2, 'capture')`,
				[ids.organization, kind],
			);
			await admin.query(
				`insert into approval_presentation_control
				 (organization_id, workflow_type, provider, mode) values ($1, $2, 'telegram', $3)`,
				[ids.organization, kind, options.presentation ?? "actionable"],
			);
		}
		for (const kind of options.delivery ?? (["absence", "travel_expense"] as const)) {
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, $2, 'telegram', $3)`,
				[ids.organization, kind, timestamp],
			);
		}
		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t408"}'::jsonb)`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't408-requester@example.test', $6, $6),
			 ($2, 'Morgan Manager', 't408-manager@example.test', $6, $6),
			 ($3, 'Blake Backup', 't408-backup@example.test', $6, $6),
			 ($4, 'Taylor Third', 't408-third@example.test', $6, $6),
			 ($5, 'Ada Admin', 't408-admin@example.test', $6, $6)`,
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'Europe/Berlin', '24h', $2 from unnest($1::text[]) as user_id`,
			[[ids.managerUser, ids.backupUser, ids.thirdUser], timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't408-member-' || user_id, $1, user_id,
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
		// The primary manager receives the request; the next direct manager is
		// the deterministic backup, the third one a management choice.
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
			 values ($1, 'vault:managed', 't408_bot', 't408-secret', 'active', true, $2, $3)`,
			[ids.organization, options.enableEscalations ?? true, timestamp],
		);
		await admin.query(
			`insert into telegram_user_mapping
			 (user_id, organization_id, telegram_user_id, is_active, updated_at) values
			 ($1, $4, $5, true, $8), ($2, $4, $6, true, $8), ($3, $4, $7, true, $8)`,
			[
				ids.managerUser,
				ids.backupUser,
				ids.thirdUser,
				ids.organization,
				String(TELEGRAM.manager),
				String(TELEGRAM.backup),
				String(TELEGRAM.third),
				timestamp,
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
				ids.backupUser,
				ids.thirdUser,
				String(CHAT.manager),
				String(CHAT.backup),
				String(CHAT.third),
				timestamp,
			],
		);
	}

	async function pendingRequest(entityId: string) {
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where organization_id = $1 and entity_id = $2 and status = 'pending'`,
			[ids.organization, entityId],
		);
		return only(rows).id;
	}

	async function submitAbsence(): Promise<Submitted> {
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
		actAs(null);
		if (!result.success) throw new Error(`Submission failed: ${result.error}`);
		const sourceId = result.data.absenceId;
		return { subject: "absence", sourceId, requestId: await pendingRequest(sourceId) };
	}

	/** Draft, one receipt upload and submission through the real actions. */
	async function submitClaim(): Promise<Submitted> {
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
			notes: "T408",
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
		actAs(null);
		if (!submitted.success) throw new Error(`Submission failed: ${submitted.error}`);
		return { subject: "travel_expense", sourceId: claimId, requestId: await pendingRequest(claimId) };
	}

	function submitSubject(subject: Subject) {
		return subject === "absence" ? submitAbsence() : submitClaim();
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

	/** Submitted, the manager's card delivered and the request transferred to the backup. */
	async function transferred(subject: Subject) {
		const submitted = await submitSubject(subject);
		await deliver();
		const managerCard = only(sendsTo(CHAT.manager));
		const summary = await escalate();
		expect(summary.transferred).toBe(1);
		const transfer = only(await transfers(submitted.requestId));
		expect(await approverOf(submitted.requestId)).toBe(ids.backup);
		return { ...submitted, managerCard, transfer };
	}

	async function approverOf(requestId: string) {
		const { rows } = await admin.query<{ approver_id: string; status: string }>(
			"select approver_id, status from approval_request where id = $1",
			[requestId],
		);
		return only(rows).approver_id;
	}

	async function requestStatus(requestId: string) {
		const { rows } = await admin.query<{ status: string }>(
			"select status from approval_request where id = $1",
			[requestId],
		);
		return rows[0]?.status ?? "deleted";
	}

	async function transfers(requestId: string) {
		const { rows } = await admin.query<{
			id: string;
			legacy_source_sequence: number;
			source_approver_employee_id: string;
			replacement_approver_employee_id: string;
		}>(
			`select id, legacy_source_sequence, source_approver_employee_id,
			        replacement_approver_employee_id
			 from approval_escalation_transfer
			 where organization_id = $1 and legacy_approval_request_id = $2
			 order by legacy_source_sequence`,
			[ids.organization, requestId],
		);
		return rows;
	}

	async function transferEvent(transferId: string) {
		const { rows } = await admin.query<{ expansion_status: string }>(
			"select expansion_status from approval_escalation_transfer_event where transfer_id = $1",
			[transferId],
		);
		return only(rows);
	}

	async function work(requestId: string) {
		const { rows } = await admin.query<{
			id: string;
			lifecycle: string;
			workflow_id: string | null;
			assignment_id: string | null;
			effect: string;
			status: string;
			recipient_employee_id: string;
			escalation_transfer_id: string | null;
			legacy_cycle_id: string | null;
			retry_count: number;
			last_outcome: string | null;
			available_at: Date;
			message_id: string | null;
			dedupe_key: string;
		}>(
			`select id, lifecycle, workflow_id, assignment_id, effect, status, recipient_employee_id,
			        escalation_transfer_id, legacy_cycle_id, retry_count, last_outcome, available_at,
			        message_id, dedupe_key
			 from approval_delivery_work
			 where organization_id = $1 and legacy_approval_request_id = $2
			 order by created_at, array_position(array['initial', 'replacement', 'refresh'], effect), id`,
			[ids.organization, requestId],
		);
		return rows;
	}

	async function replacementWork(requestId: string) {
		return (await work(requestId)).filter((row) => row.effect === "replacement");
	}

	async function messages(requestId: string) {
		const { rows } = await admin.query<{
			id: string;
			lifecycle: string;
			workflow_id: string | null;
			recipient_employee_id: string;
			destination_id: string;
			remote_message_id: string;
			binding_id: string | null;
			controls: string;
			state: string;
			status_version: number;
			legacy_cycle_id: string | null;
		}>(
			`select id, lifecycle, workflow_id, recipient_employee_id, destination_id,
			        remote_message_id, binding_id, controls, state, status_version, legacy_cycle_id
			 from approval_delivery_message
			 where organization_id = $1 and legacy_approval_request_id = $2
			 order by remote_message_id::bigint`,
			[ids.organization, requestId],
		);
		return rows;
	}

	async function openAttention(reason?: string) {
		const { rows } = await admin.query<{
			id: string;
			reason: string;
			approval_request_id: string | null;
			current_approver_employee_id: string | null;
		}>(
			`select id, reason, approval_request_id, current_approver_employee_id
			 from approval_escalation_attention
			 where organization_id = $1 and status = 'open' ${reason ? "and reason = $2" : ""}
			 order by first_raised_at, id`,
			reason ? [ids.organization, reason] : [ids.organization],
		);
		return rows;
	}

	const sends = () => calls.filter((call) => call.method === "sendMessage");
	const sendsTo = (chatId: number) =>
		sends().filter((call) => call.body.chat_id === String(chatId));
	const edits = () => calls.filter((call) => call.method === "editMessageText");
	const editsOf = (messageId: string | number | undefined) =>
		edits().filter((call) => call.body.message_id === Number(messageId));
	const answers = () => calls.filter((call) => call.method === "answerCallbackQuery");
	const buttonsOf = (call: TelegramCall) =>
		(
			(call.body.reply_markup as
				| { inline_keyboard: Array<Array<{ callback_data?: string; url?: string }>> }
				| undefined)?.inline_keyboard ?? []
		).flat();
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
			botUsername: "t408_bot",
			webhookSecret: "t408-secret",
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
		who: keyof typeof TELEGRAM,
		messageId: number | string | undefined,
		data: string,
		queryId: string,
	) {
		const before = calls.length;
		await handleTelegramUpdate(
			{
				update_id: 8000 + calls.length,
				callback_query: {
					id: queryId,
					from: { id: TELEGRAM[who], is_bot: false, first_name: "Approver" },
					message: {
						message_id: Number(messageId),
						date: 1_790_000_000,
						chat: { id: CHAT[who], type: "private" as const },
					},
					data,
				},
			},
			botConfig(),
		);
		const after = calls.slice(before);
		return {
			edits: after.filter((call) => call.method === "editMessageText"),
			answers: after.filter((call) => call.method === "answerCallbackQuery"),
		};
	}

	/** Every lifecycle row a decision could write, for "nothing decided" checks. */
	async function decisionState(submitted: Submitted) {
		const sourceTable = submitted.subject === "absence" ? "absence_entry" : "travel_expense_claim";
		const { rows } = await admin.query<Record<string, string>>(
			`select
			   (select status::text from ${sourceTable} where id = $1) as source,
			   (select string_agg(status::text || ':' || approver_id, ',' order by created_at)
			     from approval_request where entity_id = $1) as requests,
			   (select count(*) from approval_decision_evidence
			     where legacy_approval_request_id = $2) as decisions,
			   (select count(*) from approval_invocation
			     where legacy_approval_request_id = $2) as invocations`,
			[submitted.sourceId, submitted.requestId],
		);
		return only(rows);
	}

	async function decideOnWeb(userId: string, submitted: Submitted) {
		actAs(userId);
		const result =
			submitted.subject === "absence"
				? await approveAbsenceEffect(submitted.sourceId, {
						approvalRequestId: submitted.requestId,
					})
				: await approveTravelExpenseClaim({ claimId: submitted.sourceId });
		actAs(null);
		return result;
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
			throw new Error("Legacy replacement delivery PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		actAs(null);
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
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	for (const subject of ["absence", "travel_expense"] as const) {
		it(`sends one bound replacement card and retires the former card for a legacy ${subject} transfer`, async () => {
			await seed();
			const submitted = await transferred(subject);
			const { transfer, managerCard } = submitted;
			const [managerMessage] = await messages(submitted.requestId);
			expect(controlsOf(managerCard)).toHaveLength(2);
			// The transfer committed its event and asked for a fast pass only.
			expect(await transferEvent(transfer.id)).toMatchObject({ expansion_status: "pending" });
			expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
			expect(sends()).toHaveLength(1);

			// Pausing automation stops new transfers, never committed delivery.
			await admin.query(
				"update approval_escalation_control set automation_paused = true where organization_id = $1",
				[ids.organization],
			);
			const summary = await replace();
			expect(summary).toMatchObject({ expanded: 1, planned: 2, outcomes: { delivered: 2 } });

			const replacementCard = only(sendsTo(CHAT.backup));
			expect(controlsOf(replacementCard)).toHaveLength(2);
			expect(String(replacementCard.body.text)).not.toContain("Private note");
			const retirement = only(edits());
			expect(retirement.body.message_id).toBe(Number(managerMessage?.remote_message_id));
			expect(String(retirement.body.text)).toContain("Reassigned");
			expect(String(retirement.body.text)).not.toContain("Blake");
			expect(controlsOf(retirement)).toHaveLength(0);

			const { rows: bindings } = await admin.query<{ id: string; recipient_employee_id: string }>(
				`select id, recipient_employee_id from approval_review_binding
				 where legacy_approval_request_id = $1 order by created_at`,
				[submitted.requestId],
			);
			expect(bindings.map((binding) => binding.recipient_employee_id)).toEqual([
				ids.manager,
				ids.backup,
			]);
			const cycleId = subject === "absence" ? submitted.requestId : null;
			expect(await messages(submitted.requestId)).toMatchObject([
				{
					lifecycle: "legacy",
					workflow_id: null,
					recipient_employee_id: ids.manager,
					controls: "none",
					state: "retired",
					status_version: 2,
					legacy_cycle_id: cycleId,
				},
				{
					lifecycle: "legacy",
					workflow_id: null,
					recipient_employee_id: ids.backup,
					destination_id: String(CHAT.backup),
					binding_id: bindings[1]?.id,
					controls: "actionable",
					state: "current",
					status_version: 2,
					legacy_cycle_id: cycleId,
				},
			]);
			expect(
				(await work(submitted.requestId)).map((row) => [
					row.effect,
					row.status,
					row.escalation_transfer_id,
					row.recipient_employee_id,
				]),
			).toEqual([
				["initial", "delivered", null, ids.manager],
				["replacement", "delivered", transfer.id, ids.backup],
				["refresh", "delivered", transfer.id, ids.manager],
			]);
			expect((await replacementWork(submitted.requestId))[0]?.dedupe_key).toBe(
				`approval-delivery:v1:replacement:${transfer.id}:telegram`,
			);
			expect((await transferEvent(transfer.id)).expansion_status).toBe("expanded");

			// Reruns of both passes plan and send nothing more.
			await deliver(minutes(1));
			await replace(minutes(2));
			expect(sends()).toHaveLength(2);
			expect(edits()).toHaveLength(1);
			expect(await work(submitted.requestId)).toHaveLength(3);
		});

		it(`lets the ${subject} replacement decide from its card; the former card stays Reassigned`, async () => {
			await seed();
			const submitted = await transferred(subject);
			const [managerMessage] = await messages(submitted.requestId);

			// The former holder presses before the retirement reaches Telegram.
			const before = await decisionState(submitted);
			const former = await press(
				"manager",
				managerMessage?.remote_message_id,
				approveData(submitted.managerCard),
				`t408-${subject}-former`,
			);
			expect(await decisionState(submitted)).toEqual(before);
			expect(only(former.answers).body.text).toBe("Reassigned");
			// The owner, not the webhook, edits the former card.
			expect(former.edits).toEqual([]);

			await replace();
			const replacementCard = only(sendsTo(CHAT.backup));
			const replacementMessage = (await messages(submitted.requestId))[1];
			const decided = await press(
				"backup",
				replacementMessage?.remote_message_id,
				approveData(replacementCard),
				`t408-${subject}-replacement`,
			);
			expect(only(decided.answers).body.text).toBe("Request approved");
			expect(await decisionState(submitted)).toMatchObject({
				source: "approved",
				requests: `approved:${ids.backup}`,
				decisions: "1",
				invocations: "1",
			});
			// A second press on the retired former card still decides nothing.
			const late = await press(
				"manager",
				managerMessage?.remote_message_id,
				approveData(submitted.managerCard),
				`t408-${subject}-former-late`,
			);
			expect(late.edits).toEqual([]);
			expect(await decisionState(submitted)).toMatchObject({ decisions: "1" });

			// The decision's intent refreshes every tracked card from the delivery
			// owner; the former card stays Reassigned and controls never return.
			await deliver(minutes(1));
			await replace(minutes(1));
			const replacementEdit = only(editsOf(replacementMessage?.remote_message_id));
			expect(String(replacementEdit.body.text)).toContain("Approved by Blake Backup");
			const managerEdits = editsOf(managerMessage?.remote_message_id);
			expect(managerEdits).toHaveLength(2);
			expect(managerEdits.every((call) => String(call.body.text).includes("Reassigned"))).toBe(
				true,
			);
			expect(managerEdits.some((call) => String(call.body.text).includes("Approved"))).toBe(false);
			expect(edits().every((call) => controlsOf(call).length === 0)).toBe(true);
			// submitted/claim, transfer, decision
			for (const message of await messages(submitted.requestId)) {
				expect(message).toMatchObject({ controls: "none", status_version: 3 });
			}
			await deliver(minutes(2));
			await replace(minutes(2));
			expect(edits()).toHaveLength(3);
		});

		it(`adopts and retires the old path's ${subject} card of the former holder`, async () => {
			// The kind has no delivery control at submission: the old path sends the
			// manager's card and tracks it in its own table.
			await seed({ delivery: subject === "absence" ? ["travel_expense"] : ["absence"] });
			const submitted = await submitSubject(subject);
			await sendApprovalMessageToManager(
				submitted.requestId,
				ids.manager,
				ids.organization,
				BOT_TOKEN,
			);
			const oldCard = only(sendsTo(CHAT.manager));
			expect(controlsOf(oldCard)).toHaveLength(2);
			// The kind's delivery control is activated before the transfer.
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, $2, 'telegram', now())`,
				[ids.organization, subject],
			);
			expect((await escalate()).transferred).toBe(1);
			expect(await messages(submitted.requestId)).toEqual([]);

			await replace();
			expect(controlsOf(only(sendsTo(CHAT.backup)))).toHaveLength(2);
			const retirement = only(edits());
			expect(retirement.body).toMatchObject({
				chat_id: String(CHAT.manager),
				message_id: oldCard.messageId,
			});
			expect(String(retirement.body.text)).toContain("Reassigned");
			const [adopted, replacement] = await messages(submitted.requestId);
			expect(adopted).toMatchObject({
				recipient_employee_id: ids.manager,
				destination_id: String(CHAT.manager),
				remote_message_id: String(oldCard.messageId),
				controls: "none",
				state: "retired",
			});
			expect(replacement).toMatchObject({ recipient_employee_id: ids.backup, state: "current" });

			// A press on the old card decides nothing and is acknowledged as Reassigned.
			const before = await decisionState(submitted);
			const pressed = await press(
				"manager",
				oldCard.messageId,
				approveData(oldCard),
				`t408-${subject}-old-path`,
			);
			expect(await decisionState(submitted)).toEqual(before);
			expect(only(pressed.answers).body.text).toBe("Reassigned");
			expect(pressed.edits).toEqual([]);
			// So does a pre-binding (unbound) press; it never overwrites the notice.
			const unbound = await press(
				"manager",
				oldCard.messageId,
				JSON.stringify({ a: "ap", id: submitted.requestId }),
				`t408-${subject}-old-path-unbound`,
			);
			expect(await decisionState(submitted)).toEqual(before);
			expect(only(unbound.answers).body.text).toBe("Reassigned");
			expect(unbound.edits).toEqual([]);
			// Reruns adopt and retire nothing again.
			await replace(minutes(1));
			expect(edits()).toHaveLength(1);
			expect(await messages(submitted.requestId)).toHaveLength(2);
		});
	}

	it("tracks a former card that landed after the transfer and retires it as Reassigned", async () => {
		// The transfer commits while Telegram is accepting the manager's card;
		// escalation expands it after the card landed.
		await seed();
		const first = await submitAbsence();
		duringSend = async () => {
			expect((await escalate()).transferred).toBe(1);
		};
		await deliver();
		const [landed] = await messages(first.requestId);
		expect(landed).toMatchObject({ recipient_employee_id: ids.manager, controls: "actionable" });
		await replace();
		expect(sendsTo(CHAT.backup)).toHaveLength(1);
		expect(String(only(editsOf(landed?.remote_message_id)).body.text)).toContain("Reassigned");
		const [firstTransfer] = await transfers(first.requestId);
		expect(
			(await work(first.requestId)).map((row) => [
				row.effect,
				row.status,
				row.escalation_transfer_id,
			]),
		).toEqual([
			["initial", "delivered", null],
			["replacement", "delivered", firstTransfer?.id],
			["refresh", "delivered", firstTransfer?.id],
		]);

		// Escalation already expanded the transfer (and planned the retirement of
		// every card it knew) while the card was in flight: the late card is stale
		// on arrival, and its retirement is planned at once.
		await seed();
		calls.length = 0;
		const second = await submitAbsence();
		duringSend = async () => {
			expect((await escalate()).transferred).toBe(1);
			await expandEscalationTransferEvents({ organizationId: ids.organization, limit: 10 });
		};
		await deliver();
		const [late] = await messages(second.requestId);
		expect(late).toMatchObject({ recipient_employee_id: ids.manager, status_version: 1 });
		const [secondTransfer] = await transfers(second.requestId);
		expect(
			(await work(second.requestId)).map((row) => [
				row.effect,
				row.status,
				row.escalation_transfer_id,
			]),
		).toEqual([
			["initial", "delivered", null],
			["replacement", "pending", secondTransfer?.id],
			["refresh", "pending", null],
		]);
		await replace(minutes(1));
		await deliver(minutes(1));
		expect(sendsTo(CHAT.backup)).toHaveLength(1);
		expect(String(only(editsOf(late?.remote_message_id)).body.text)).toContain("Reassigned");
		expect(only(await messages(second.requestId).then((rows) => rows.slice(0, 1)))).toMatchObject({
			controls: "none",
			state: "retired",
			status_version: 2,
		});
	});

	it("retires every duplicate of a replaced holder's card and delivers a second transfer to the new holder", async () => {
		await seed();
		const submitted = await transferred("absence");
		const [managerMessage] = await messages(submitted.requestId);
		// A worker whose lease expired mid-send still records its late card, so
		// the replacement holds two identities of one card.
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
		const workerA = replace(T0);
		await inFlight;
		const workerB = await replace(minutes(3));
		expect(workerB.outcomes.delivered).toBeGreaterThanOrEqual(1);
		release();
		expect((await workerA).outcomes.lease_lost).toBeGreaterThanOrEqual(1);
		expect(sendsTo(CHAT.backup)).toHaveLength(2);
		const backupMessages = (await messages(submitted.requestId)).filter(
			(message) => message.recipient_employee_id === ids.backup,
		);
		expect(backupMessages).toHaveLength(2);

		// Management moves the request on to the third manager (lineage position 1).
		actAs(ids.adminUser);
		expect(
			await transferApprovalEscalationAssignment({
				approvalRequestId: submitted.requestId,
				recipientEmployeeId: ids.third,
				idempotencyKey: "e4088000-0000-4000-8000-000000000001",
				reason: "Blake is travelling",
			}),
		).toEqual({ success: true, data: { replayed: false } });
		actAs(null);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		const [, second] = await transfers(submitted.requestId);
		expect(second).toMatchObject({
			legacy_source_sequence: 1,
			source_approver_employee_id: ids.backup,
			replacement_approver_employee_id: ids.third,
		});

		const editsBefore = edits().length;
		await replace(minutes(10));
		const thirdCard = only(sendsTo(CHAT.third));
		expect(controlsOf(thirdCard)).toHaveLength(2);
		const retired = edits().slice(editsBefore);
		expect(retired.map((call) => call.body.message_id).sort()).toEqual(
			backupMessages.map((message) => Number(message.remote_message_id)).sort(),
		);
		expect(retired.every((call) => String(call.body.text).includes("Reassigned"))).toBe(true);
		// The first holder's card was already retired and is not edited again.
		expect(editsOf(managerMessage?.remote_message_id)).toHaveLength(1);
		expect(
			(await replacementWork(submitted.requestId)).map((row) => [
				row.recipient_employee_id,
				row.status,
				row.escalation_transfer_id,
			]),
		).toEqual([
			[ids.backup, "delivered", submitted.transfer.id],
			[ids.third, "delivered", second?.id],
		]);

		// Neither replaced holder can decide; the new holder does.
		const pressed = await press(
			"backup",
			backupMessages[0]?.remote_message_id,
			approveData(only(sendsTo(CHAT.backup).slice(0, 1))),
			"t408-second-former",
		);
		expect(only(pressed.answers).body.text).toBe("Reassigned");
		const thirdMessage = (await messages(submitted.requestId)).find(
			(message) => message.recipient_employee_id === ids.third,
		);
		await press("third", thirdMessage?.remote_message_id, approveData(thirdCard), "t408-third");
		expect(await decisionState(submitted)).toMatchObject({
			source: "approved",
			requests: `approved:${ids.third}`,
		});
		await deliver(minutes(11));
		await replace(minutes(11));
		for (const message of await messages(submitted.requestId)) {
			expect(message.controls).toBe("none");
		}
		const finalTexts = (await messages(submitted.requestId)).map((message) => [
			message.recipient_employee_id,
			String(editsOf(message.remote_message_id).at(-1)?.body.text ?? ""),
		]);
		for (const [recipient, text] of finalTexts) {
			expect(text).toContain(recipient === ids.third ? "Approved by Taylor Third" : "Reassigned");
		}
	});

	it("sends nothing when a recheck fails right before the send; the work cancels or holds truthfully", async () => {
		const cases: Array<{
			name: string;
			subject: Subject;
			arrange: (submitted: Submitted) => Promise<void>;
			expected: { status: string; last_outcome: string };
		}> = [
			{
				name: "decided",
				subject: "absence",
				arrange: async (submitted) => {
					expect((await decideOnWeb(ids.backupUser, submitted)).success).toBe(true);
				},
				expected: { status: "cancelled", last_outcome: "obsolete" },
			},
			{
				name: "transferred again",
				subject: "travel_expense",
				arrange: async (submitted) => {
					actAs(ids.adminUser);
					const moved = await transferApprovalEscalationAssignment({
						approvalRequestId: submitted.requestId,
						recipientEmployeeId: ids.third,
						idempotencyKey: "e4088000-0000-4000-8000-000000000002",
						reason: "Blake is travelling",
					});
					actAs(null);
					expect(moved.success).toBe(true);
				},
				expected: { status: "cancelled", last_outcome: "obsolete" },
			},
			{
				name: "recipient inactive",
				subject: "absence",
				arrange: async () => {
					await admin.query("update employee set is_active = false where id = $1", [ids.backup]);
				},
				expected: { status: "cancelled", last_outcome: "recipient_inactive" },
			},
			{
				name: "preference off",
				subject: "travel_expense",
				arrange: async () => {
					await admin.query(
						`insert into notification_preference (user_id, notification_type, channel, enabled, updated_at)
						 values ($1, 'approval_request_submitted', 'telegram', false, now())`,
						[ids.backupUser],
					);
				},
				expected: { status: "suppressed", last_outcome: "preference_disabled" },
			},
			{
				name: "escalation delivery disabled",
				subject: "absence",
				arrange: async () => {
					await admin.query(
						"update telegram_bot_config set enable_escalations = false where organization_id = $1",
						[ids.organization],
					);
				},
				expected: { status: "suppressed", last_outcome: "escalations_disabled" },
			},
			{
				name: "not entitled",
				subject: "travel_expense",
				arrange: async () => {
					await admin.query("delete from member where organization_id = $1 and user_id = $2", [
						ids.organization,
						ids.backupUser,
					]);
				},
				expected: { status: "suppressed", last_outcome: "not_entitled" },
			},
		];
		for (const testCase of cases) {
			await seed();
			calls.length = 0;
			const submitted = await transferred(testCase.subject);
			await expandEscalationTransferEvents({ organizationId: ids.organization, limit: 10 });
			const [replacement] = await replacementWork(submitted.requestId);
			expect(replacement, testCase.name).toMatchObject({ status: "pending" });
			await testCase.arrange(submitted);
			await replace();
			expect(sendsTo(CHAT.backup), testCase.name).toEqual([]);
			expect(
				(await replacementWork(submitted.requestId)).find((row) => row.id === replacement?.id),
				testCase.name,
			).toMatchObject(testCase.expected);
			// The former card is retired regardless.
			const [former] = await messages(submitted.requestId);
			expect(former, testCase.name).toMatchObject({ controls: "none", state: "retired" });
		}
	});

	it("freezes channels at the first expansion; the delivery owner never claims transfer-linked work", async () => {
		await seed({ enableEscalations: false });
		const off = await transferred("travel_expense");
		expect(await replace()).toMatchObject({ expanded: 1, planned: 1 });
		expect(await replacementWork(off.requestId)).toEqual([]);
		expect(only(edits()).body.message_id).toBe(off.managerCard.messageId);
		// Enabling escalations later adds no channel to an expanded transfer.
		await admin.query(
			"update telegram_bot_config set enable_escalations = true where organization_id = $1",
			[ids.organization],
		);
		await replace(minutes(1));
		expect(await replacementWork(off.requestId)).toEqual([]);
		expect(sendsTo(CHAT.backup)).toEqual([]);

		// Expanded but unclaimed: the delivery owner's pass leaves it alone.
		await seed();
		calls.length = 0;
		const on = await transferred("absence");
		await expandEscalationTransferEvents({ organizationId: ids.organization, limit: 10 });
		const owner = await deliver(minutes(1));
		expect(owner.claimed).toBe(0);
		expect(sendsTo(CHAT.backup)).toEqual([]);
		expect(edits()).toEqual([]);
		expect((await work(on.requestId)).map((row) => row.status)).toEqual([
			"delivered",
			"pending",
			"pending",
		]);
		await replace(minutes(1));
		expect(sendsTo(CHAT.backup)).toHaveLength(1);

		// A kind without a delivery control owns no card: its event expands to nothing.
		await seed({ delivery: ["absence"] });
		calls.length = 0;
		const unowned = await submitClaim();
		expect((await escalate()).transferred).toBe(1);
		const [transfer] = await transfers(unowned.requestId);
		expect(await replace()).toMatchObject({ expanded: 1, planned: 0 });
		expect((await transferEvent(transfer?.id ?? "")).expansion_status).toBe("expanded");
		expect(await work(unowned.requestId)).toEqual([]);
		const { rows: intents } = await admin.query(
			"select count(*)::int as count from approval_delivery_intent where legacy_approval_request_id = $1",
			[unowned.requestId],
		);
		expect(only(intents)).toEqual({ count: 0 });
	});

	it("re-expands once after a crash during expansion, without a second transfer or duplicate work", async () => {
		await seed();
		const submitted = await transferred("travel_expense");
		vi.spyOn(telegramApprovalDeliveryAdapter, "acceptsEscalationDelivery").mockRejectedValueOnce(
			new Error("t408 injected expansion crash"),
		);
		await expect(replace()).rejects.toThrow("t408 injected expansion crash");
		expect(await transferEvent(submitted.transfer.id)).toMatchObject({
			expansion_status: "pending",
		});
		expect(await work(submitted.requestId)).toHaveLength(1);
		const { rows: noIntent } = await admin.query(
			"select count(*)::int as count from approval_delivery_intent where escalation_transfer_id = $1",
			[submitted.transfer.id],
		);
		expect(only(noIntent)).toEqual({ count: 0 });

		// Scheduled escalation never repeats the committed transfer.
		expect((await escalate(minutes(1))).transferred).toBe(0);
		expect(await transfers(submitted.requestId)).toHaveLength(1);

		// Concurrent passes expand the waiting event once and send one card.
		await Promise.all([replace(minutes(1)), replace(minutes(1)), replace(minutes(1))]);
		expect(sendsTo(CHAT.backup)).toHaveLength(1);
		expect(edits()).toHaveLength(1);
		expect(await work(submitted.requestId)).toHaveLength(3);
		const { rows: intents } = await admin.query(
			`select event, escalation_transfer_id, expansion_status from approval_delivery_intent
			 where legacy_approval_request_id = $1 order by created_at`,
			[submitted.requestId],
		);
		expect(intents).toEqual([
			{ event: "submitted", escalation_transfer_id: null, expansion_status: "expanded" },
			{
				event: "transferred",
				escalation_transfer_id: submitted.transfer.id,
				expansion_status: "expanded",
			},
		]);
	});

	it("retries, exhausts visibly on the legacy subject, recovers once and closes incidents when the request settles", async () => {
		await seed();
		const submitted = await transferred("absence");
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
			const [row] = await replacementWork(submitted.requestId);
			expect(row).toMatchObject({ status: "pending", retry_count: index + 1 });
			expect(Temporal.Instant.from(row?.available_at.toISOString() ?? "")).toEqual(
				now.add({ minutes: wait }),
			);
			await replace(now.add({ minutes: wait }).subtract({ seconds: 1 }));
			expect(sendsTo(CHAT.backup)).toHaveLength(index + 1);
			now = now.add({ minutes: wait });
			await replace(now);
		}
		expect(only(await replacementWork(submitted.requestId))).toMatchObject({
			status: "exhausted",
			last_outcome: "ambiguous:telegram_502",
		});
		const incident = only(await openAttention("delivery_exhausted"));
		expect(incident).toMatchObject({
			approval_request_id: submitted.requestId,
			current_approver_employee_id: ids.backup,
		});
		// Delivery failure never undoes or repeats the transfer.
		expect(await approverOf(submitted.requestId)).toBe(ids.backup);
		expect((await escalate(now)).transferred).toBe(0);

		const recovered = await recoverApprovalDeliveryForAttention({
			organizationId: ids.organization,
			attentionId: incident.id,
			actorUserId: ids.adminUser,
			now: now.add({ hours: 1 }),
		});
		expect(recovered.kind).toBe("rearmed");
		// The delivery owner never executes escalation work; escalation sends once.
		await deliver(now.add({ hours: 1 }));
		expect(sendsTo(CHAT.backup)).toHaveLength(6);
		await replace(now.add({ hours: 1 }));
		expect(sendsTo(CHAT.backup)).toHaveLength(7);
		expect(await openAttention("delivery_exhausted")).toEqual([]);
		await replace(now.add({ hours: 2 }));
		expect(sendsTo(CHAT.backup)).toHaveLength(7);

		// An expense replacement exhausted, then decided: the obsolete work is
		// cancelled and the incident closes through the attention recheck.
		await seed();
		calls.length = 0;
		const claim = await transferred("travel_expense");
		script.sendMessage = [
			{ kind: "error", status: 400, errorCode: 400, description: "Bad Request: invalid markup" },
		];
		await replace();
		expect(only(await replacementWork(claim.requestId))).toMatchObject({
			status: "failed",
			last_outcome: "permanent:telegram_400",
		});
		expect(only(await openAttention("delivery_exhausted"))).toMatchObject({
			approval_request_id: claim.requestId,
		});
		expect((await decideOnWeb(ids.backupUser, claim)).success).toBe(true);
		expect((await replace(minutes(1))).cancelled).toBe(1);
		expect(only(await replacementWork(claim.requestId))).toMatchObject({
			status: "cancelled",
			last_outcome: "obsolete",
		});
		const { recheckEscalationAttention } = await import("./attention-store");
		await recheckEscalationAttention({ organizationId: ids.organization });
		expect(await openAttention()).toEqual([]);
	});

	it("raises attention at once without a destination and delivers after repair", async () => {
		await seed();
		await admin.query("delete from telegram_conversation where user_id = $1", [ids.backupUser]);
		const submitted = await transferred("travel_expense");
		await replace();
		expect(sendsTo(CHAT.backup)).toEqual([]);
		expect(only(await replacementWork(submitted.requestId))).toMatchObject({
			status: "awaiting_repair",
			retry_count: 0,
			last_outcome: "destination_invalid:destination_missing",
		});
		expect(only(await openAttention("delivery_unavailable"))).toMatchObject({
			approval_request_id: submitted.requestId,
			current_approver_employee_id: ids.backup,
		});
		await saveConversation(String(CHAT.backup), "private", ids.backupUser, ids.organization);
		expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
		await replace(minutes(1));
		expect(sendsTo(CHAT.backup)).toHaveLength(1);
		expect(only(await replacementWork(submitted.requestId)).status).toBe("delivered");
		expect(await openAttention("delivery_unavailable")).toEqual([]);
	});

	it("sends a review-only replacement card when the actionable gates do not hold", async () => {
		for (const subject of ["absence", "travel_expense"] as const) {
			await seed({ presentation: "review_only" });
			calls.length = 0;
			const submitted = await transferred(subject);
			await replace();
			const card = only(sendsTo(CHAT.backup));
			expect(controlsOf(card), subject).toEqual([]);
			expect(buttonsOf(card).map((button) => button.url), subject).toEqual([
				`https://t408.example.test/approvals/review/${ids.organization}/compatibility/${submitted.requestId}`,
			]);
			expect(only(await replacementWork(submitted.requestId)).status, subject).toBe("delivered");
			const { rows } = await admin.query(
				"select count(*)::int as count from approval_review_binding where legacy_approval_request_id = $1",
				[submitted.requestId],
			);
			expect(only(rows), subject).toEqual({ count: 0 });
		}
	});

	for (const mode of ["shadow", "ready"] as const) {
		it(`delivers and decides a ${mode}-mode absence replacement under legacy authority`, async () => {
			await seed({ mode });
			const submitted = await transferred("absence");
			await replace();
			const card = only(sendsTo(CHAT.backup));
			const replacementMessage = (await messages(submitted.requestId))[1];
			const pressed = await press(
				"backup",
				replacementMessage?.remote_message_id,
				approveData(card),
				`t408-${mode}`,
			);
			expect(only(pressed.answers).body.text).toBe("Request approved");
			expect(await decisionState(submitted)).toMatchObject({
				source: "approved",
				decisions: "1",
			});
			// The shadow observation mirrored the decision; it never became authority.
			const { rows } = await admin.query(
				`select workflow_id, observed_workflow_id is not null as observed
				 from approval_decision_evidence where legacy_approval_request_id = $1`,
				[submitted.requestId],
			);
			expect(only(rows)).toEqual({ workflow_id: null, observed: true });
			const { rows: work } = await admin.query(
				`select count(*)::int as count from approval_delivery_work
				 where organization_id = $1 and (workflow_id is not null or assignment_id is not null)`,
				[ids.organization],
			);
			expect(only(work)).toEqual({ count: 0 });
		});
	}

	it("acts under neither authority after a cutover between transfer, planning and send", async () => {
		// Canonical authority before expansion: the event waits.
		await seed();
		const waiting = await transferred("absence");
		await admin.query(
			`update approval_workflow_rollout set lifecycle_mode = 'canonical', side_effect_mode = 'canonical'
			 where organization_id = $1 and workflow_type = 'absence'`,
			[ids.organization],
		);
		expect(await replace()).toMatchObject({ expanded: 0, planned: 0 });
		expect(await transferEvent(waiting.transfer.id)).toMatchObject({
			expansion_status: "pending",
		});
		expect(sendsTo(CHAT.backup)).toEqual([]);
		// Back under legacy authority, it expands once.
		await admin.query(
			`update approval_workflow_rollout set lifecycle_mode = 'legacy', side_effect_mode = 'legacy'
			 where organization_id = $1 and workflow_type = 'absence'`,
			[ids.organization],
		);
		expect(await replace(minutes(1))).toMatchObject({ expanded: 1 });
		expect(sendsTo(CHAT.backup)).toHaveLength(1);

		// Canonical authority between planning and send: nothing is sent or edited.
		await seed();
		calls.length = 0;
		const planned = await transferred("absence");
		await expandEscalationTransferEvents({ organizationId: ids.organization, limit: 10 });
		await admin.query(
			`update approval_workflow_rollout set lifecycle_mode = 'canonical', side_effect_mode = 'canonical'
			 where organization_id = $1 and workflow_type = 'absence'`,
			[ids.organization],
		);
		await replace();
		expect(sendsTo(CHAT.backup)).toEqual([]);
		expect(edits()).toEqual([]);
		expect(
			(await work(planned.requestId))
				.filter((row) => row.escalation_transfer_id)
				.map((row) => [row.effect, row.status, row.last_outcome]),
		).toEqual([
			["replacement", "cancelled", "authority_changed"],
			["refresh", "cancelled", "authority_changed"],
		]);
	});

	it("withdraws the replacement's card when the absence is cancelled; the former card stays Reassigned", async () => {
		await seed();
		const submitted = await transferred("absence");
		await replace();
		const [managerMessage, backupMessage] = await messages(submitted.requestId);
		actAs(ids.requesterUser);
		expect(await cancelAbsenceRequest(submitted.sourceId)).toMatchObject({ success: true });
		actAs(null);
		expect(await requestStatus(submitted.requestId)).toBe("deleted");
		await deliver(minutes(1));
		await replace(minutes(1));
		expect(String(only(editsOf(backupMessage?.remote_message_id)).body.text)).toContain(
			"withdrawn",
		);
		const managerEdits = editsOf(managerMessage?.remote_message_id);
		expect(managerEdits.every((call) => String(call.body.text).includes("Reassigned"))).toBe(true);
		for (const message of await messages(submitted.requestId)) {
			// submitted, transferred, withdrawn
			expect(message).toMatchObject({ controls: "none", status_version: 3 });
		}

		// A replacement still unsent at cancellation is cancelled as obsolete.
		await seed();
		calls.length = 0;
		const unsent = await transferred("absence");
		await expandEscalationTransferEvents({ organizationId: ids.organization, limit: 10 });
		actAs(ids.requesterUser);
		expect(await cancelAbsenceRequest(unsent.sourceId)).toMatchObject({ success: true });
		actAs(null);
		expect((await replace()).cancelled).toBe(1);
		expect(sendsTo(CHAT.backup)).toEqual([]);
		expect(only(await replacementWork(unsent.requestId))).toMatchObject({
			status: "cancelled",
			last_outcome: "obsolete",
		});
	});

	it("purges and reports exactly the lifecycle's replacement work, messages and intents; late sends recreate nothing", async () => {
		await seed();
		const kept = await transferred("travel_expense");
		await replace();
		calls.length = 0;
		const submitted = await transferred("absence");
		await replace();
		const deliveryWork = (await work(submitted.requestId)).map((row) => row.id).sort();
		const deliveryMessages = (await messages(submitted.requestId)).map((row) => row.id).sort();
		expect(deliveryWork).toHaveLength(3);
		expect(deliveryMessages).toHaveLength(2);
		const { rows: intentRows } = await admin.query<{ id: string }>(
			"select id from approval_delivery_intent where legacy_approval_request_id = $1",
			[submitted.requestId],
		);
		expect(intentRows).toHaveLength(2);
		const keptBefore = {
			work: await work(kept.requestId),
			messages: await messages(kept.requestId),
		};

		const deleted = await deleteApproval(db as never, ids.organization, submitted.requestId);
		expect(deleted.delivery).toEqual({
			work: deliveryWork,
			messages: deliveryMessages,
			intents: intentRows.map((row) => row.id).sort(),
		});
		expect(deleted.escalationTransfers).toEqual([submitted.transfer.id]);
		expect(await work(submitted.requestId)).toEqual([]);
		expect(await messages(submitted.requestId)).toEqual([]);
		// The other lifecycle is untouched.
		expect(await work(kept.requestId)).toEqual(keptBefore.work);
		expect(await messages(kept.requestId)).toEqual(keptBefore.messages);

		// A replacement card still in flight when the lifecycle is purged is not
		// recorded afterwards.
		await seed();
		calls.length = 0;
		const racing = await transferred("absence");
		duringSend = async () => {
			await deleteApproval(db as never, ids.organization, racing.requestId);
		};
		await replace();
		expect(sendsTo(CHAT.backup)).toHaveLength(1);
		expect(await messages(racing.requestId)).toEqual([]);
		expect(await work(racing.requestId)).toEqual([]);
		const { rows: leftovers } = await admin.query(
			`select
			   (select count(*)::int from approval_delivery_intent where legacy_approval_request_id = $1) as intents,
			   (select count(*)::int from approval_escalation_transfer where legacy_approval_request_id = $1) as transfers`,
			[racing.requestId],
		);
		expect(only(leftovers)).toEqual({ intents: 0, transfers: 0 });
	});
});
