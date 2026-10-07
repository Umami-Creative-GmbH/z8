/**
 * #623: expense report reviews through bound cards, escalation, pilot
 * readiness and maintenance, at parity with legacy expense claims.
 *
 * The real report actions and receipt upload route submit frozen reports;
 * the real delivery owner, Telegram card preparation and webhook, the shared
 * bound bot attempt, the inbox decision routes, escalation discovery,
 * transfer and replacement delivery, the pilot readiness report and approval
 * maintenance run against a disposable PostgreSQL database. Only the session,
 * notification fan-out, object storage, the vault, the post-commit fast path
 * (each test drives the owners explicitly) and the Telegram HTTP transport
 * (fetch) are replaced.
 */

import type { NextRequest } from "next/server";
import { Temporal } from "temporal-polyfill";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t623-org" as string | null,
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	notifications: [] as Array<{ action: string; reportId: string }>,
	kicks: [] as Array<{ organizationId: string; workflowId?: string | null }>,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
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
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/app-url", async (original) => ({
	...(await original<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t623.example.test",
}));
vi.mock("@/env", async (original) => ({
	env: {
		...(await original<typeof import("@/env")>()).env,
		TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: "1024",
	},
}));
vi.mock("@/lib/notifications/triggers", async (original) => ({
	...(await original<typeof import("@/lib/notifications/triggers")>()),
	onTravelExpenseReportDecided: async (params: { action: string; reportId: string }) => {
		harness.notifications.push({ action: params.action, reportId: params.reportId });
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t623-public",
	s3Client: {
		async send(command: { input: { Key: string } }) {
			if (command.constructor.name === "DeleteObjectCommand") {
				harness.tus.delete(command.input.Key);
				return {};
			}
			const bytes = harness.tus.get(command.input.Key);
			if (!bytes) throw new Error("NoSuchKey");
			return {
				ContentLength: bytes.length,
				Body: { transformToByteArray: async () => new Uint8Array(bytes) },
			};
		},
	},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject(_organizationId: string, key: string, data: Buffer) {
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t623-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
}));
vi.mock("@/lib/vault", async (original) =>
	(await import("@/test/integration-harness")).vault(
		original,
		async () => "623623623:AAT623-report_cards_test",
	),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(harness.kicks),
);

const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/approvals/inbox/[id]/reject/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
await import("@/lib/approvals/init");
const { processApprovalDeliveries } = await import("@/lib/approvals/delivery/owner");
const { handleTelegramUpdate } = await import("@/lib/telegram/bot-handler");
const { attemptBoundBotApproval } = await import("@/lib/bot-platform/approval-decision");
const { processDueEscalations } = await import("@/lib/approvals/escalation/transfer");
const { processEscalationReplacementDeliveries } = await import(
	"@/lib/approvals/escalation/replacement-delivery"
);
const { assessApprovalPilotReadiness } = await import("@/lib/approvals/pilot/readiness");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { parseInstant } = await import("@/lib/datetime/temporal-core");
const { db } = await import("@/db");

const BOT_TOKEN = "623623623:AAT623-report_cards_test";
const RECEIVER_SCOPE = "telegram-bot:623623623";
const MANAGER_TELEGRAM_ID = 62_301;
const MANAGER_CHAT_ID = 623_555;
const BACKUP_TELEGRAM_ID = 62_302;
const BACKUP_CHAT_ID = 623_556;
// Pinned pass time; it must lie after the real time the test runs at.
const T0 = Temporal.Instant.from("2030-01-07T10:00:00Z");

const ids = {
	organization: "t623-org",
	otherOrganization: "t623-other",
	requester: "e6230000-0000-4000-8000-000000000001",
	manager: "e6230000-0000-4000-8000-000000000002",
	backup: "e6230000-0000-4000-8000-000000000003",
	other: "e6230000-0000-4000-8000-000000000004",
	managerLink: "e6231000-0000-4000-8000-000000000001",
	backupLink: "e6231000-0000-4000-8000-000000000002",
	policy: "e6232000-0000-4000-8000-000000000001",
	firstStage: "e6232000-0000-4000-8000-000000000002",
	secondStage: "e6232000-0000-4000-8000-000000000003",
} as const;
type Person = "requester" | "manager" | "backup" | "other";
const userOf = (person: Person) => `t623-${person}`;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

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

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [
		[ids.organization, ids.otherOrganization],
	]);
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id = any($1::text[])",
		[[ids.organization, ids.otherOrganization]],
	);
	await admin.query('delete from "user" where id like $1', ["t623-%"]);
}

interface SeedOptions {
	presentation?: boolean;
	delivery?: boolean;
	escalation?: boolean;
	twoStageChain?: boolean;
}

async function seed(options: SeedOptions = {}) {
	await cleanup();
	const timestamp = new Date("2026-07-01T00:00:00Z");
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ($1, 'T623 reports', $1, 'Europe/Berlin', $3), ($2, 'T623 other', $2, 'UTC', $3)`,
		[ids.organization, ids.otherOrganization, timestamp],
	);
	const people: Array<[Person, string, string, string, string]> = [
		["requester", ids.requester, ids.organization, "employee", "Avery Requester"],
		["manager", ids.manager, ids.organization, "manager", "Morgan Manager"],
		["backup", ids.backup, ids.organization, "manager", "Blake Backup"],
		["other", ids.other, ids.otherOrganization, "manager", "Olive Other"],
	];
	for (const [person, employeeId, organizationId, role, name] of people) {
		await admin.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $2, $3, $4, $4)',
			[userOf(person), name, `${userOf(person)}@example.test`, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 values ($1, 'en', 'Europe/Berlin', '24h', $2)`,
			[userOf(person), timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, 'member', 'approved', $4)`,
			[`t623-member-${person}`, organizationId, userOf(person), timestamp],
		);
		await admin.query(
			"insert into employee (id, user_id, organization_id, role, updated_at) values ($1, $2, $3, $4, $5)",
			[employeeId, userOf(person), organizationId, role, timestamp],
		);
	}
	await admin.query(
		`insert into employee_managers
		 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at) values
		 ($1, $3, $4, true, 't623-manager', $6, $6), ($2, $3, $5, false, 't623-manager', $6, $6)`,
		[ids.managerLink, ids.backupLink, ids.requester, ids.manager, ids.backup, timestamp],
	);
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
		 values ($1, 'vault:managed', 't623_bot', 't623-secret', 'active', true, true, $2)`,
		[ids.organization, timestamp],
	);
	for (const [person, telegramId, chatId] of [
		["manager", MANAGER_TELEGRAM_ID, MANAGER_CHAT_ID],
		["backup", BACKUP_TELEGRAM_ID, BACKUP_CHAT_ID],
	] as const) {
		await admin.query(
			`insert into telegram_user_mapping
			 (user_id, organization_id, telegram_user_id, is_active, updated_at)
			 values ($1, $2, $3, true, $4)`,
			[userOf(person), ids.organization, String(telegramId), timestamp],
		);
		await admin.query(
			`insert into telegram_conversation
			 (organization_id, user_id, chat_id, chat_type, is_active, updated_at)
			 values ($1, $2, $3, 'private', true, $4)`,
			[ids.organization, userOf(person), String(chatId), timestamp],
		);
	}
	if (options.escalation) {
		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t623"}'::jsonb)`,
			[ids.organization],
		);
	}
	if (options.twoStageChain) {
		await admin.query(
			`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, $2, 'T623 two stages', true, 1, 't623-manager', $3)`,
			[ids.policy, ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_policy_stage (id, organization_id, policy_id, step_order, label, approver_type,
			   approver_employee_id, fallback_behavior, updated_at) values
			 ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', $6),
			 ($2, $3, $4, 2, 'Finance', 'specific_employee', $5, 'fail', $6)`,
			[ids.firstStage, ids.secondStage, ids.organization, ids.policy, ids.backup, timestamp],
		);
	}
}

function signIn(person: Person | null) {
	harness.userId = person ? userOf(person) : null;
	harness.organizationId = person === "other" ? ids.otherOrganization : ids.organization;
}

async function upload(reportId: string, itemId: string) {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey(userOf("requester"));
	harness.tus.set(tusFileKey, pdfBytes);
	const response = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName: "hotel-invoice.pdf" }),
		}) as unknown as NextRequest,
	);
	if (response.status !== 200) throw new Error(`Upload failed: ${response.status}`);
}

/** A complete trip (employee-paid train, company-paid hotel), submitted through the real action. */
async function submitReport(): Promise<{ reportId: string; requestId: string; createdAt: Date }> {
	signIn("requester");
	const created = await actions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	const details = await actions.saveTripDetailsDraftAction({
		reportId,
		expectedVersion: loaded.data.trip?.version ?? 1,
		values: {
			purpose: "Customer workshop",
			startDate: "2026-09-14",
			endDate: "2026-09-16",
			timeZone: "Europe/Berlin",
			destinations: [{ place: "Hamburg", countryCode: "DE" }],
		},
	});
	if (!details.success) throw new Error("details failed");
	for (const values of [
		{ category: "transport", description: "Train to Hamburg", amount: "89.90", paidBy: "employee" },
		{
			category: "accommodation",
			description: "Hotel, two nights",
			amount: "240.00",
			paidBy: "company",
		},
	]) {
		const added = await actions.addTripReportItemAction({ reportId });
		if (!added.success) throw new Error("add failed");
		const saved = await actions.saveReceiptItemDraftAction({
			reportId,
			itemId: added.data.item.id,
			expectedVersion: added.data.item.version,
			values: {
				expenseDate: "2026-09-14",
				currency: "EUR",
				accountingReference: null,
				...values,
			},
		});
		if (!saved.success || saved.data.status !== "saved") throw new Error("save failed");
		await upload(reportId, added.data.item.id);
	}
	signIn("requester");
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	const submitted = await actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.data.trip?.version ?? null,
			items: report.data.items.map((item) => ({
				id: item.id,
				version: item.version,
				receiptIds: item.receipts.map((receipt) => receipt.id),
			})),
		},
	});
	if (!submitted.success || submitted.data.status !== "submitted") {
		throw new Error(`submission failed: ${JSON.stringify(submitted)}`);
	}
	signIn(null);
	const { rows } = await admin.query<{ id: string; created_at: Date }>(
		`select id, created_at at time zone 'UTC' as created_at from approval_request
		 where organization_id = $1 and entity_type = 'travel_expense_report'
		   and entity_id = $2 and status = 'pending'`,
		[ids.organization, reportId],
	);
	const request = only(rows);
	return { reportId, requestId: request.id, createdAt: request.created_at };
}

describe("expense report cards, escalation and readiness (#623, PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const calls: TelegramCall[] = [];
	let nextMessageId = 6230;
	let updateCounter = 62_300;
	const originalFetch = globalThis.fetch;

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

	function deliver(now: Temporal.Instant = T0) {
		return processApprovalDeliveries({ organizationId: ids.organization, now });
	}

	function botConfig() {
		return {
			organizationId: ids.organization,
			botToken: BOT_TOKEN,
			botUsername: "t623_bot",
			webhookSecret: "t623-secret",
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
		messageId: number,
		data: string,
		queryId: string,
		from: { telegramId: number; chatId: number } = {
			telegramId: MANAGER_TELEGRAM_ID,
			chatId: MANAGER_CHAT_ID,
		},
	) {
		updateCounter += 1;
		await handleTelegramUpdate(
			{
				update_id: updateCounter,
				callback_query: {
					id: queryId,
					from: { id: from.telegramId, is_bot: false, first_name: "Reviewer" },
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

	function attempt(input: {
		bindingId: string;
		queryId: string;
		action?: "approve" | "reject";
		organizationId?: string;
		actor?: Person;
	}) {
		const actor = input.actor ?? "manager";
		const employeeIds: Record<Person, string> = {
			requester: ids.requester,
			manager: ids.manager,
			backup: ids.backup,
			other: ids.other,
		};
		return attemptBoundBotApproval({
			organizationId: input.organizationId ?? ids.organization,
			actorEmployeeId: employeeIds[actor],
			actorUserId: userOf(actor),
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

	async function reportStatus(reportId: string) {
		const { rows } = await admin.query<{ status: string }>(
			"select status from travel_expense_report where id = $1",
			[reportId],
		);
		return only(rows).status;
	}

	async function decisions(reportId: string) {
		const { rows } = await admin.query(
			`select d.* from approval_decision_evidence d
			 join approval_submitted_revision s
			   on s.id = d.submitted_revision_id and s.organization_id = d.organization_id
			 where s.organization_id = $1 and s.source_id = $2
			 order by d.decided_at, d.id`,
			[ids.organization, reportId],
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

	async function messages(reportId: string) {
		const { rows } = await admin.query(
			`select * from approval_delivery_message
			 where organization_id = $1 and legacy_source_id = $2 order by remote_message_id`,
			[ids.organization, reportId],
		);
		return rows;
	}

	async function revisionId(reportId: string): Promise<string> {
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_submitted_revision
			 where organization_id = $1 and source_type = 'travel_expense_report' and source_id = $2`,
			[ids.organization, reportId],
		);
		return only(rows).id;
	}

	beforeEach(() => {
		signIn(null);
		harness.tus.clear();
		harness.objects.clear();
		harness.notifications = [];
		harness.kicks.length = 0;
		calls.length = 0;
		installTelegramTransport();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	afterAll(cleanup);

	describe("bound report cards", () => {
		it("sends one bound card with only the frozen report facts through the committed cycle intent", async () => {
			await seed();
			const { reportId, requestId } = await submitReport();
			expect(harness.kicks).toEqual([{ organizationId: ids.organization }]);
			expect(sends()).toHaveLength(0);
			const { rows: intents } = await admin.query(
				"select * from approval_delivery_intent where organization_id = $1",
				[ids.organization],
			);
			expect(only(intents)).toMatchObject({
				workflow_type: "travel_expense",
				source_type: "travel_expense_report",
				source_id: reportId,
				legacy_approval_request_id: requestId,
				// A report resubmits: each submission cycle is its own lifecycle.
				legacy_cycle_id: requestId,
				event: "submitted",
			});

			expect((await deliver()).outcomes).toEqual({ delivered: 1 });
			const card = only(sends());
			const text = String(card.body.text);
			expect(card.body.chat_id).toBe(String(MANAGER_CHAT_ID));
			expect(text).toContain("Expense report approval request");
			expect(text).toContain("Employee: Avery Requester");
			expect(text).toContain("Report: Trip");
			expect(text).toContain("Purpose: Customer workshop");
			expect(text).toContain("Trip dates: Sep 14, 2026 – Sep 16, 2026");
			// Country names in the recipient's language (#687).
			expect(text).toContain("Destination: Hamburg, Germany");
			expect(text).toContain("Expenses: 2");
			expect(text).toContain("Reimbursable to employee: 89.90 EUR");
			expect(text).toContain("Paid by company: 240.00 EUR");
			expect(text).toContain("Receipts: 2 attached");
			// Item descriptions and receipt files stay in authenticated review.
			expect(text).not.toContain("Hotel, two nights");
			expect(text).not.toContain("hotel-invoice");
			expect(buttonsOf(card).find((button) => button.url)?.url).toBe(
				`https://t623.example.test/approvals/review/${ids.organization}/compatibility/${requestId}`,
			);

			const binding = only(await bindings());
			expect(binding).toMatchObject({
				authority: "legacy",
				legacy_approval_request_id: requestId,
				recipient_employee_id: ids.manager,
				submitted_revision_id: await revisionId(reportId),
			});
			expect(only(await messages(reportId))).toMatchObject({
				lifecycle: "legacy",
				workflow_type: "travel_expense",
				legacy_source_type: "travel_expense_report",
				legacy_cycle_id: requestId,
				legacy_approval_request_id: requestId,
				binding_id: binding.id,
				controls: "actionable",
				status_version: 1,
			});
			await deliver(T0.add({ hours: 1 }));
			expect(sends()).toHaveLength(1);
		});

		it("decides from Telegram through the report owner, replays the exact press and refreshes the card", async () => {
			await seed();
			const { reportId, requestId } = await submitReport();
			await deliver();
			const card = only(sends());
			const message = only(await messages(reportId));

			await press(Number(message.remote_message_id), approveData(card), "t623-q-1");
			expect(await reportStatus(reportId)).toBe("approved");
			expect(only(answers()).body.text).toBe("Request approved");
			expect(harness.notifications).toEqual([{ action: "approve", reportId }]);
			const decision = only(await decisions(reportId));
			expect(decision).toMatchObject({
				authority: "legacy",
				legacy_approval_request_id: requestId,
				submitted_revision_id: await revisionId(reportId),
				reviewed_binding_id: message.binding_id,
				actor_employee_id: ids.manager,
				request_outcome: "approved",
				result: expect.objectContaining({ reportStatus: "approved" }),
			});
			expect(decision.receipt_idempotency_key).toMatch(
				/^approval-invocation:v1:telegram_callback_query:/,
			);
			expect(only(await invocations())).toMatchObject({
				authority: "legacy",
				legacy_approval_request_id: requestId,
				reviewed_binding_id: message.binding_id,
				decision_evidence_id: decision.id,
				invocation_id: "t623-q-1",
				action: "approve",
			});
			// The decision's own cycle intent, kicked after commit.
			const { rows: decided } = await admin.query(
				"select legacy_cycle_id from approval_delivery_intent where event = 'decided' and source_id = $1",
				[reportId],
			);
			expect(only(decided).legacy_cycle_id).toBe(requestId);

			// A redelivery of the same query replays without a second effect.
			await press(Number(message.remote_message_id), approveData(card), "t623-q-1");
			expect(answers()[1]?.body.text).toBe("Request approved");
			expect(await decisions(reportId)).toHaveLength(1);
			expect(await invocations()).toHaveLength(1);
			expect(harness.notifications).toHaveLength(1);
			// The same query with another command conflicts; a new press decides nothing.
			expect(
				await attempt({ bindingId: message.binding_id, queryId: "t623-q-1", action: "reject" }),
			).toEqual({ status: "conflict" });
			expect(await attempt({ bindingId: message.binding_id, queryId: "t623-q-2" })).toEqual({
				status: "review_required",
			});

			// The committed intent brings the card to its decided status, without controls.
			await deliver(T0.add({ minutes: 1 }));
			const edit = only(edits());
			expect(edit.body.message_id).toBe(Number(message.remote_message_id));
			expect(String(edit.body.text)).toContain("Request approved");
			expect(String(edit.body.text)).toContain("Approved by Morgan Manager");
			expect(buttonsOf(edit).every((button) => !button.callback_data)).toBe(true);
			expect(only(await messages(reportId))).toMatchObject({
				controls: "none",
				state: "retired",
				status_version: 2,
			});
		});

		it("serializes concurrent deliveries of one press into one decision", async () => {
			await seed();
			const { reportId } = await submitReport();
			await deliver();
			const message = only(await messages(reportId));
			const results = await Promise.all(
				[1, 2, 3].map(() => attempt({ bindingId: message.binding_id, queryId: "t623-q-race" })),
			);
			expect(results.every((result) => result.status === "decided")).toBe(true);
			expect(
				results.filter((result) => result.status === "decided" && !result.replayed),
			).toHaveLength(1);
			expect(await decisions(reportId)).toHaveLength(1);
			expect(await invocations()).toHaveLength(1);
			expect(harness.notifications).toEqual([{ action: "approve", reportId }]);
		});

		it("decides nothing from a changed, paused, reassigned, decided, foreign or someone else's card", async () => {
			await seed();
			const first = await submitReport();
			await deliver();
			const firstCard = only(sends());
			const firstMessage = only(await messages(first.reportId));

			// Live rows no longer match the frozen revision: held, the card loses its controls.
			await admin.query(
				"update travel_expense_report_item set original_amount = '1.00' where report_id = $1 and position = 0",
				[first.reportId],
			);
			await press(Number(firstMessage.remote_message_id), approveData(firstCard), "t623-q-changed");
			expect(only(answers()).body.text).toBe("Review required");
			expect(await reportStatus(first.reportId)).toBe("submitted");
			expect(await decisions(first.reportId)).toHaveLength(0);

			const second = await submitReport();
			await deliver(T0.add({ minutes: 1 }));
			const secondMessage = only(await messages(second.reportId));
			// Paused admission: a fresh press on a sent card decides nothing.
			await admin.query(
				`update approval_presentation_control set mode = 'review_only'
				 where organization_id = $1 and workflow_type = 'travel_expense'`,
				[ids.organization],
			);
			expect(
				await attempt({ bindingId: secondMessage.binding_id, queryId: "t623-q-paused" }),
			).toEqual({ status: "review_required" });
			await admin.query(
				`update approval_presentation_control set mode = 'actionable'
				 where organization_id = $1 and workflow_type = 'travel_expense'`,
				[ids.organization],
			);
			// The request moved to another approver: the former holder's card is stale.
			await admin.query("update approval_request set approver_id = $2 where id = $1", [
				second.requestId,
				ids.backup,
			]);
			expect(
				await attempt({ bindingId: secondMessage.binding_id, queryId: "t623-q-moved" }),
			).toEqual({ status: "review_required" });
			await admin.query("update approval_request set approver_id = $2 where id = $1", [
				second.requestId,
				ids.manager,
			]);
			// Another tenant's context and another member never reach the binding.
			expect(
				await attempt({
					bindingId: secondMessage.binding_id,
					queryId: "t623-q-foreign",
					organizationId: ids.otherOrganization,
					actor: "other",
				}),
			).toEqual({ status: "not_found" });
			expect(
				await attempt({
					bindingId: secondMessage.binding_id,
					queryId: "t623-q-backup",
					actor: "backup",
				}),
			).toEqual({ status: "not_found" });
			expect(await invocations()).toHaveLength(0);

			// A decision on the web supersedes the card: a later press decides nothing.
			signIn("manager");
			const rejected = await rejectRoute(
				new Request(`http://localhost/api/approvals/inbox/${second.requestId}/reject`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ reason: "Duplicate trip" }),
				}) as unknown as NextRequest,
				{ params: Promise.resolve({ id: second.requestId }) },
			);
			signIn(null);
			expect(rejected.status).toBe(200);
			expect(harness.kicks).toContainEqual({ organizationId: ids.organization });
			expect(
				await attempt({ bindingId: secondMessage.binding_id, queryId: "t623-q-late" }),
			).toEqual({ status: "review_required" });
			expect(await reportStatus(second.reportId)).toBe("rejected");
			expect(only(await decisions(second.reportId))).toMatchObject({
				action: "reject",
				reviewed_binding_id: null,
			});
			await deliver(T0.add({ minutes: 2 }));
			const refreshed = edits().find(
				(edit) => edit.body.message_id === Number(secondMessage.remote_message_id),
			);
			expect(String(refreshed?.body.text)).toContain("Request rejected");
			expect(String(refreshed?.body.text)).not.toContain("Duplicate trip");
		});

		it("carries a two-stage chain: the next stage's card, a superseded first card and the final status", async () => {
			await seed({ twoStageChain: true });
			const { reportId, requestId } = await submitReport();
			await deliver();
			const firstCard = only(sends());
			const firstMessage = only(await messages(reportId));
			const { rows: cycles } = await admin.query<{ chain_instance_id: string }>(
				"select chain_instance_id from approval_chain_stage_instance where approval_request_id = $1",
				[requestId],
			);
			const cycleId = only(cycles).chain_instance_id;
			expect(firstMessage.legacy_cycle_id).toBe(cycleId);

			await press(Number(firstMessage.remote_message_id), approveData(firstCard), "t623-q-stage-1");
			expect(only(answers()).body.text).toBe("Approval recorded");
			expect(await reportStatus(reportId)).toBe("submitted");
			expect(harness.notifications).toEqual([]);

			// The owner sends stage two its own bound card of the same cycle.
			await deliver(T0.add({ minutes: 1 }));
			const secondCard = only(
				sends().filter((call) => call.body.chat_id === String(BACKUP_CHAT_ID)),
			);
			const { rows: stageTwo } = await admin.query<{ id: string }>(
				"select id from approval_request where entity_id = $1 and status = 'pending'",
				[reportId],
			);
			const stageTwoMessage = (await messages(reportId)).find(
				(message) => message.legacy_approval_request_id === only(stageTwo).id,
			);
			expect(stageTwoMessage).toMatchObject({ controls: "actionable", legacy_cycle_id: cycleId });
			expect(String(only(edits()).body.text)).toContain("still awaits further approval");
			// The first stage's card is superseded: a fresh press decides nothing.
			expect(
				await attempt({ bindingId: firstMessage.binding_id, queryId: "t623-q-stage-1b" }),
			).toEqual({ status: "review_required" });

			await press(
				Number(stageTwoMessage?.remote_message_id),
				approveData(secondCard),
				"t623-q-stage-2",
				{ telegramId: BACKUP_TELEGRAM_ID, chatId: BACKUP_CHAT_ID },
			);
			expect(await reportStatus(reportId)).toBe("approved");
			expect(harness.notifications).toEqual([{ action: "approve", reportId }]);
			await deliver(T0.add({ minutes: 2 }));
			expect((await messages(reportId)).map((message) => message.status_version)).toEqual([3, 3]);
		});
	});

	describe("escalation", () => {
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

		async function journal() {
			const { rows } = await admin.query(
				"select * from approval_escalation_transfer where organization_id = $1 order by created_at, id",
				[ids.organization],
			);
			return rows;
		}

		async function openAttention() {
			const { rows } = await admin.query(
				`select reason, approval_type, approval_request_id, evidence from approval_escalation_attention
				 where organization_id = $1 and status = 'open' order by first_raised_at, id`,
				[ids.organization],
			);
			return rows;
		}

		function approveAs(person: Person, requestId: string) {
			signIn(person);
			return approveRoute(
				new Request(`http://localhost/api/approvals/inbox/${requestId}/approve`, {
					method: "POST",
				}) as unknown as NextRequest,
				{ params: Promise.resolve({ id: requestId }) },
			).finally(() => signIn(null));
		}

		it("transfers a due report request under legacy authority; only the replacement decides it", async () => {
			await seed({ escalation: true });
			const { reportId, requestId, createdAt } = await submitReport();
			await deliver();
			const formerCard = only(sends());
			const formerMessage = only(await messages(reportId));

			expect(await processAt(createdAt, 59)).toMatchObject({ examined: 0, transferred: 0 });
			expect(await processAt(createdAt, 60)).toMatchObject({ transferred: 1, failed: 0 });
			expect(await request(requestId)).toMatchObject({
				approver_id: ids.backup,
				status: "pending",
			});
			const transfer = only(await journal());
			expect(transfer).toMatchObject({
				authority_mode: "legacy",
				workflow_type: "travel_expense",
				legacy_approval_request_id: requestId,
				source_approver_employee_id: ids.manager,
				replacement_approver_employee_id: ids.backup,
			});
			const { rows: events } = await admin.query(
				"select payload from approval_escalation_transfer_event where transfer_id = $1",
				[transfer.id],
			);
			expect(only(events).payload).toMatchObject({
				sourceType: "travel_expense_report",
				sourceId: reportId,
			});

			// The former holder's card and inbox no longer decide.
			await press(
				Number(formerMessage.remote_message_id),
				approveData(formerCard),
				"t623-q-former",
			);
			expect(only(answers()).body.text).toBe("Reassigned");
			const stale = await approveAs("manager", requestId);
			expect(stale.status).toBe(409);
			expect(await reportStatus(reportId)).toBe("submitted");
			expect(await invocations()).toHaveLength(0);

			// Replacement delivery: the backup gets a bound card of the same cycle,
			// the former holder's card is retired.
			calls.length = 0;
			await processEscalationReplacementDeliveries({ organizationId: ids.organization, now: T0 });
			const replacement = only(sends());
			expect(replacement.body.chat_id).toBe(String(BACKUP_CHAT_ID));
			expect(String(replacement.body.text)).toContain("Expense report approval request");
			expect(buttonsOf(replacement).some((button) => button.callback_data)).toBe(true);
			const retired = only(edits());
			expect(retired.body.message_id).toBe(Number(formerMessage.remote_message_id));
			expect(buttonsOf(retired).every((button) => !button.callback_data)).toBe(true);
			const backupMessage = (await messages(reportId)).find(
				(message) => message.recipient_employee_id === ids.backup,
			);
			expect(backupMessage).toMatchObject({ legacy_cycle_id: requestId, controls: "actionable" });

			await press(
				Number(backupMessage?.remote_message_id),
				approveData(replacement),
				"t623-q-replacement",
				{ telegramId: BACKUP_TELEGRAM_ID, chatId: BACKUP_CHAT_ID },
			);
			expect(await reportStatus(reportId)).toBe("approved");
			expect(only(await decisions(reportId))).toMatchObject({ actor_employee_id: ids.backup });
		});

		it("holds a report chain stage visibly once due", async () => {
			await seed({ escalation: true, twoStageChain: true, delivery: false });
			const { requestId, createdAt } = await submitReport();
			expect(await processAt(createdAt, 30)).toMatchObject({ transferred: 0, held: {} });
			expect(await processAt(createdAt, 60)).toMatchObject({
				transferred: 0,
				held: { unsupported_route: 1 },
			});
			expect((await request(requestId)).approver_id).toBe(ids.manager);
			expect(only(await openAttention())).toMatchObject({
				approval_type: "travel_expense",
				approval_request_id: requestId,
				evidence: expect.objectContaining({ route: "legacy_chain_stage" }),
			});
		});

		it("holds reports visibly under a rollout mode without legacy authority", async () => {
			await seed({ escalation: true, delivery: false });
			const { requestId, createdAt } = await submitReport();
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, 'travel_expense', 'canonical', 'canonical', now(), now())
				 on conflict (organization_id, workflow_type)
				 do update set lifecycle_mode = 'canonical', side_effect_mode = 'canonical'`,
				[ids.organization],
			);
			expect(await processAt(createdAt, 60)).toMatchObject({
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
	});

	describe("pilot readiness and maintenance", () => {
		async function readiness() {
			const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });
			return {
				kind: report.kinds.find((kind) => kind.workflowType === "travel_expense"),
				telegram: report.combinations.find(
					(combination) =>
						combination.workflowType === "travel_expense" && combination.provider === "telegram",
				),
			};
		}

		it("counts pending report cycles and their evidence next to claims", async () => {
			// Reports submitted before delivery was activated stay web-inbox-only.
			await seed({ delivery: false });
			const before = await submitReport();
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
				 values ($1, 'travel_expense', 'telegram', now())`,
				[ids.organization],
			);
			const after = await submitReport();
			let current = await readiness();
			expect(current.kind?.pending).toMatchObject({ total: 2, current: 2, materialChange: 0 });
			expect(current.telegram?.findings).toContainEqual({
				code: "in_flight_before_activation",
				severity: "hold",
				count: 1,
			});

			// A report whose live rows no longer match is held like a claim.
			await admin.query(
				"update travel_expense_report_item set original_amount = '1.00' where report_id = $1 and position = 0",
				[after.reportId],
			);
			current = await readiness();
			expect(current.kind?.pending).toMatchObject({ total: 2, current: 1, materialChange: 1 });
			expect(current.telegram?.findings).toContainEqual({
				code: "evidence_held",
				severity: "hold",
				count: 1,
			});

			// Decided reports are no longer pending or in flight.
			signIn("manager");
			expect(
				(
					await approveRoute(
						new Request(`http://localhost/api/approvals/inbox/${before.requestId}/approve`, {
							method: "POST",
						}) as unknown as NextRequest,
						{ params: Promise.resolve({ id: before.requestId }) },
					)
				).status,
			).toBe(200);
			signIn(null);
			current = await readiness();
			expect(current.kind?.pending).toMatchObject({ total: 1 });
			expect(
				current.telegram?.findings.some(
					(finding) => finding.code === "in_flight_before_activation",
				),
			).toBe(false);
		});

		it("purges one report cycle's evidence, bindings, invocations, delivery and transfers", async () => {
			await seed({ escalation: true });
			const kept = await submitReport();
			const { reportId, requestId, createdAt } = await submitReport();
			await deliver();
			const message = only(await messages(reportId));
			await processDueEscalations({
				organizationId: ids.organization,
				now: parseInstant(new Date(createdAt.getTime() + 60 * 60_000).toISOString()),
			});
			const { rows: transfers } = await admin.query<{ id: string }>(
				"select id from approval_escalation_transfer where legacy_approval_request_id = $1",
				[requestId],
			);
			const revision = await revisionId(reportId);

			const deleted = await deleteApproval(db as never, ids.organization, requestId);
			expect(deleted.legacyRequests).toEqual([requestId]);
			expect(deleted.evidence).toMatchObject({
				submittedRevisions: [revision],
				reviewBindings: [message.binding_id],
			});
			expect(deleted.escalationTransfers).toEqual([only(transfers).id]);
			expect(deleted.delivery.messages).toEqual([message.id]);
			expect(deleted.delivery.intents.length).toBeGreaterThan(0);
			expect(await messages(reportId)).toHaveLength(0);
			// The report keeps its business status; the other report's lifecycle is untouched.
			expect(await reportStatus(reportId)).toBe("submitted");
			expect(await revisionId(kept.reportId)).toBeTruthy();
			expect(only(await messages(kept.reportId))).toMatchObject({ controls: "actionable" });

			// A late press of the purged card finds nothing and recreates nothing.
			expect(await attempt({ bindingId: message.binding_id, queryId: "t623-q-purged" })).toEqual({
				status: "not_found",
			});
			expect(await invocations()).toHaveLength(0);
		});
	});
});
