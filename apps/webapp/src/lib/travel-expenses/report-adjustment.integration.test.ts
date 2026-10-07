/**
 * #615: signed adjustments of exported or reimbursed reports and recorded
 * overpayment recovery.
 *
 * Reports are submitted, decided, exported and settled through the real
 * actions, routes and export worker against a disposable PostgreSQL database;
 * only the session, notifications, the queue and object storage are replaced.
 */

import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t615-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	jobs: [] as Array<{ organizationId: string; batchId: string; attempt: number }>,
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
vi.mock("@/env", async (original) => ({
	env: {
		...(await original<typeof import("@/env")>()).env,
		TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: "1024",
	},
}));
vi.mock("@/lib/notifications/triggers", async (original) => ({
	...(await original<typeof import("@/lib/notifications/triggers")>()),
	onTravelExpenseReportDecided: async () => {},
	onTravelExpenseReportReturned: async () => {},
}));
vi.mock("@/lib/queue", () => ({
	async addJob(_name: string, data: { organizationId: string; batchId: string; attempt: number }) {
		harness.jobs.push({
			organizationId: data.organizationId,
			batchId: data.batchId,
			attempt: data.attempt,
		});
		return { id: randomUUID() };
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t615-public",
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
		return { bucket: "t615-private", versionId: `v-${key.length}` };
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

const { db } = await import("@/db");
const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const adjustments = await import("@/app/[locale]/(app)/travel-expenses/adjustment-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const recovery = await import("@/app/[locale]/(app)/travel-expenses/finance-recovery-actions");
const exportActions = await import("@/app/[locale]/(app)/travel-expenses/finance-export-actions");
const review = await import("@/app/[locale]/(app)/travel-expenses/report-review-actions");
const reopenActions = await import("@/app/[locale]/(app)/travel-expenses/report-reopen-actions");
const { processTravelExpenseExportBatch } = await import("@/lib/travel-expenses/export-processor");
const { runTravelExpenseReceiptCleanup } = await import("@/lib/travel-expenses/receipt-upload");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { GET: getReceipt } = await import(
	"@/app/api/travel-expenses/reports/[reportId]/receipts/[receiptId]/route"
);
const { GET: getApprovalDetail } = await import("@/app/api/approvals/inbox/[id]/route");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/approvals/inbox/[id]/reject/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6150000-0000-4000-8000-000000000001",
	manager: "e6150000-0000-4000-8000-000000000002",
	finance: "e6150000-0000-4000-8000-000000000004",
	colleague: "e6150000-0000-4000-8000-000000000005",
	foreigner: "e6150000-0000-4000-8000-000000000006",
} as const;
type Person = "requester" | "manager" | "finance" | "colleague" | "foreigner";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t615-org', 't615-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't615-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t615-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t615-org','Expenses','t615-org','Europe/Berlin',now()),
		 ('t615-foreign','Foreign','t615-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string, string]> = [
		["requester", ids.requester, "t615-org", "member", "employee"],
		["manager", ids.manager, "t615-org", "member", "manager"],
		["finance", ids.finance, "t615-org", "admin", "employee"],
		["colleague", ids.colleague, "t615-org", "member", "employee"],
		["foreigner", ids.foreigner, "t615-foreign", "owner", "admin"],
	];
	for (const [name, employeeId, organizationId, memberRole, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t615-${name}`, name, `t615-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t615-member-${name}`, organizationId, `t615-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[employeeId, `t615-${name}`, organizationId, role],
		);
	}
	for (const employeeId of [ids.requester, ids.colleague]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't615-manager', now(), now())`,
			[employeeId, ids.manager],
		);
	}
}

function signIn(name: Person) {
	harness.userId = `t615-${name}`;
	harness.organizationId = name === "foreigner" ? "t615-foreign" : "t615-org";
}

async function upload(reportId: string, itemId: string) {
	const tusFileKey = createOwnedTusFileKey("t615-requester");
	harness.tus.set(tusFileKey, pdfBytes);
	const response = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName: "invoice.pdf" }),
		}) as unknown as NextRequest,
	);
	if (response.status !== 200)
		throw new Error(`upload ${response.status}: ${await response.text()}`);
}

async function loadOwn(reportId: string) {
	signIn("requester");
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	return report.data;
}

async function setAmount(reportId: string, amount: string) {
	const report = await loadOwn(reportId);
	const item = report.items[0];
	if (!item) throw new Error("no item");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: "2026-09-14",
			category: "accommodation",
			description: "Hotel Hamburg",
			amount,
			currency: "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	});
	if (!saved.success) throw new Error(saved.error);
}

async function submit(reportId: string) {
	const report = await loadOwn(reportId);
	const submitted = await actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.trip?.version ?? null,
			items: report.items.map((item) => ({
				id: item.id,
				version: item.version,
				receiptIds: item.receipts.map((receipt) => receipt.id),
			})),
		},
	});
	if (!submitted.success) throw new Error(submitted.error);
	return submitted.data;
}

/** A submitted standalone hotel receipt of EUR `amount`, paid by the employee. */
async function submittedHotel(amount: string) {
	signIn("requester");
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	await setAmount(reportId, amount);
	const itemId = (await loadOwn(reportId)).items[0]?.id ?? "";
	await upload(reportId, itemId);
	expect(await submit(reportId)).toEqual({ status: "submitted" });
	return reportId;
}

async function pendingRequestId(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("no pending request");
	return id;
}

async function approve(reportId: string) {
	const requestId = await pendingRequestId(reportId);
	signIn("manager");
	return approveRoute(
		new Request(`http://localhost/api/approvals/inbox/${requestId}/approve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
}

async function reject(reportId: string) {
	const requestId = await pendingRequestId(reportId);
	signIn("manager");
	return rejectRoute(
		new Request(`http://localhost/api/approvals/inbox/${requestId}/reject`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ reason: "Not a business expense" }),
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
}

async function approvedHotel(amount: string) {
	const reportId = await submittedHotel(amount);
	expect((await approve(reportId)).status).toBe(200);
	return reportId;
}

const source = (id: string) => ({ type: "report" as const, id });

async function reimburse(reportId: string, amount: string, expected: string) {
	signIn("finance");
	const result = await finance.recordTravelExpenseReimbursementAction({
		source: source(reportId),
		idempotencyKey: randomUUID(),
		amount,
		occurredOn: "2026-10-01",
		reference: "SEPA-500",
		note: null,
		expectedBalance: { currency: "EUR", amount: expected },
	});
	expect(result.success && result.data.status).toBe("recorded");
}

/** An approved EUR 500 hotel that finance reimbursed in full. */
async function paidHotel() {
	const reportId = await approvedHotel("500.00");
	await reimburse(reportId, "500.00", "500.00");
	return reportId;
}

async function createAdjustment(
	originalReportId: string,
	reason = "The hotel refunded one night",
	idempotencyKey: string = randomUUID(),
) {
	signIn("requester");
	const result = await adjustments.createTravelExpenseAdjustmentAction({
		originalReportId,
		reason,
		idempotencyKey,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}

async function adjustTo(originalReportId: string, amount: string) {
	const created = await createAdjustment(originalReportId);
	if (created.status !== "created") throw new Error(created.status);
	await setAmount(created.reportId, amount);
	expect(await submit(created.reportId)).toEqual({ status: "submitted" });
	return created.reportId;
}

const TRIP_ITEMS = [
	{ category: "accommodation", description: "Hotel Hamburg", amount: "300.00" },
	{ category: "transport", description: "Taxi Hamburg", amount: "200.00" },
] as const;

/** Saves new amounts for the named expenses of a draft trip report. */
async function setTripAmounts(reportId: string, amounts: Record<string, string>) {
	for (const [description, amount] of Object.entries(amounts)) {
		const report = await loadOwn(reportId);
		const item = report.items.find((candidate) => candidate.description === description);
		const known = TRIP_ITEMS.find((candidate) => candidate.description === description);
		if (!item || !known) throw new Error(`no item ${description}`);
		const saved = await actions.saveReceiptItemDraftAction({
			reportId,
			itemId: item.id,
			expectedVersion: item.version,
			values: {
				expenseDate: "2026-09-14",
				category: known.category,
				description,
				amount,
				currency: "EUR",
				paidBy: "employee",
				accountingReference: null,
			},
		});
		if (!saved.success || saved.data.status !== "saved") throw new Error("save failed");
	}
}

/** An approved EUR 500 trip (EUR 300 hotel + EUR 200 taxi) that finance reimbursed in full. */
async function paidTrip() {
	signIn("requester");
	const created = await actions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	const loaded = await loadOwn(reportId);
	const details = await actions.saveTripDetailsDraftAction({
		reportId,
		expectedVersion: loaded.trip?.version ?? 1,
		values: {
			purpose: "Customer workshop",
			startDate: "2026-09-14",
			endDate: "2026-09-15",
			timeZone: "Europe/Berlin",
			destinations: [{ place: "Hamburg", countryCode: "DE" }],
		},
	});
	if (!details.success) throw new Error(details.error);
	for (const item of TRIP_ITEMS) {
		signIn("requester");
		const added = await actions.addTripReportItemAction({ reportId });
		if (!added.success) throw new Error(added.error);
		const saved = await actions.saveReceiptItemDraftAction({
			reportId,
			itemId: added.data.item.id,
			expectedVersion: added.data.item.version,
			values: {
				expenseDate: "2026-09-14",
				category: item.category,
				description: item.description,
				amount: item.amount,
				currency: "EUR",
				paidBy: "employee",
				accountingReference: null,
			},
		});
		if (!saved.success) throw new Error(saved.error);
		await upload(reportId, added.data.item.id);
	}
	expect(await submit(reportId)).toEqual({ status: "submitted" });
	expect((await approve(reportId)).status).toBe(200);
	await reimburse(reportId, "500.00", "500.00");
	return reportId;
}

/** Creates an adjustment of a paid trip, corrects the named expenses and submits it. */
async function correctTrip(originalReportId: string, amounts: Record<string, string>) {
	const created = await createAdjustment(originalReportId);
	if (created.status !== "created") throw new Error(created.status);
	await setTripAmounts(created.reportId, amounts);
	expect(await submit(created.reportId)).toEqual({ status: "submitted" });
	return created.reportId;
}

/** Exports the report's approved revision through a completed batch. */
async function exportReport(reportId: string) {
	signIn("finance");
	const listed = await exportActions.getTravelExpenseExports();
	if (!listed.success) throw new Error(listed.error);
	const row = listed.data.exportable.find((candidate) => candidate.reportId === reportId);
	if (!row) throw new Error("not exportable");
	const batch = await exportActions.createTravelExpenseExportAction({
		idempotencyKey: randomUUID(),
		selection: [{ reportId, revisionId: row.revisionId }],
	});
	expect(batch.success && batch.data.status).toBe("created");
	for (const job of harness.jobs.splice(0)) {
		expect(await processTravelExpenseExportBatch(db, job)).toEqual({ status: "completed" });
	}
}

function reopen(reportId: string, reason = "Wrong amount") {
	signIn("manager");
	return reopenActions.reopenTravelExpenseReportAction({ reportId, submissionCycle: 1, reason });
}

async function holdReportLock(reportId: string): Promise<PoolClient> {
	const holder = await admin.connect();
	await holder.query("begin");
	await holder.query("select id from travel_expense_report where id = $1 for update", [reportId]);
	return holder;
}

async function waitForLockWaiters(count: number) {
	for (let attempt = 0; attempt < 400; attempt += 1) {
		const { rows } = await admin.query<{ waiters: number }>(
			`select count(*)::int as waiters from pg_stat_activity
			 where datname = current_database() and wait_event_type = 'Lock'`,
		);
		if ((rows[0]?.waiters ?? 0) >= count) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Expected ${count} blocked sessions`);
}

async function settlement(reportId: string) {
	signIn("finance");
	const result = await finance.getTravelExpenseSettlement(source(reportId));
	if (!result.success || !result.data) throw new Error("no settlement");
	return result.data.account;
}

function recover(reportId: string, amount: string, expected: string, key: string = randomUUID()) {
	signIn("finance");
	return recovery.recordTravelExpenseRecoveryAction({
		source: source(reportId),
		idempotencyKey: key,
		amount,
		occurredOn: "2026-10-05",
		reference: "RECOVERY-77",
		note: "Deducted from the October payroll",
		expectedBalance: { currency: "EUR", amount: expected },
	});
}

async function entries(reportId: string) {
	const { rows } = await admin.query(
		"select kind, amount, reference, occurred_on::text from travel_expense_settlement_entry where report_id = $1 order by recorded_at",
		[reportId],
	);
	return rows;
}

function receipt(reportId: string, receiptId: string) {
	return getReceipt(
		new Request(
			`http://localhost/api/travel-expenses/reports/${reportId}/receipts/${receiptId}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ reportId, receiptId }) },
	);
}

describe("signed adjustments and overpayment recovery (#615)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.jobs.length = 0;
	});
	afterAll(cleanup);

	it("turns a paid EUR 500 report corrected to EUR 450 into a EUR -50 adjustment, a EUR 50 overpayment and a settling recovery", async () => {
		const original = await paidHotel();
		const originalRevision = (await settlement(original)).basis?.revisionId;

		const adjustmentId = await adjustTo(original, "450.00");
		// Pending: nothing changes until the adjustment is approved.
		expect((await settlement(original)).summary.currencies).toEqual([
			expect.objectContaining({ entitlement: "500.00", reimbursed: "500.00", balance: "0.00" }),
		]);

		// The reviewer sees the signed delta, reason and baseline before deciding the whole report.
		const requestId = await pendingRequestId(adjustmentId);
		signIn("manager");
		const detail = await (
			await getApprovalDetail({} as NextRequest, { params: Promise.resolve({ id: requestId }) })
		).json();
		expect(JSON.stringify(detail.sections)).toContain("-50.00 EUR");
		expect(detail.sections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "key_value",
					rows: expect.arrayContaining([
						expect.objectContaining({ value: "The hotel refunded one night" }),
						expect.objectContaining({ value: "500.00 EUR" }),
						expect.objectContaining({ value: "450.00 EUR" }),
					]),
				}),
			]),
		);
		expect((await approve(adjustmentId)).status).toBe(200);

		const account = await settlement(original);
		expect(account.summary).toEqual({
			state: "overpaid",
			currencies: [
				{
					currency: "EUR",
					entitlement: "450.00",
					reimbursed: "500.00",
					recovered: "0.00",
					balance: "-50.00",
					state: "overpaid",
				},
			],
		});
		expect(account.entitlement).toEqual([
			expect.objectContaining({ kind: "approved_submission", amount: "500.00" }),
			expect.objectContaining({ kind: "approved_adjustment", amount: "-50.00" }),
		]);
		expect(account.adjustments).toEqual([
			expect.objectContaining({ reportId: adjustmentId, delta: "-50.00" }),
		]);
		// The original approval stays the account's basis.
		expect(account.basis?.revisionId).toBe(originalRevision);

		// The overpayment shows in the open finance queue; the adjustment is no account of its own.
		signIn("finance");
		const queue = await finance.getTravelExpenseFinanceQueue("open");
		expect(queue.success && queue.data.accounts.map((a) => a.source.id)).toEqual([original]);
		const onAdjustment = await finance.recordTravelExpenseReimbursementAction({
			source: source(adjustmentId),
			idempotencyKey: randomUUID(),
			amount: "1.00",
			occurredOn: "2026-10-01",
			reference: "X",
			expectedBalance: { currency: "EUR", amount: "0.00" },
		});
		expect(onAdjustment).toEqual({ success: true, data: { status: "adjustment_report" } });

		// A recovery never exceeds the overpayment and is recorded once per command.
		expect(await recover(original, "60.00", "-50.00")).toMatchObject({
			success: true,
			data: { status: "refused", reason: "exceeds_overpayment" },
		});
		const key = randomUUID();
		const recovered = await recover(original, "50.00", "-50.00", key);
		expect(
			recovered.success &&
				recovered.data.status === "recorded" &&
				recovered.data.account.summary.state,
		).toBe("settled");
		const retried = await recover(original, "50.00", "-50.00", key);
		expect(retried.success && retried.data.status === "recorded" && retried.data.replayed).toBe(
			true,
		);
		expect(await entries(original)).toEqual([
			{ kind: "reimbursement", amount: "500.00", reference: "SEPA-500", occurred_on: "2026-10-01" },
			{ kind: "recovery", amount: "50.00", reference: "RECOVERY-77", occurred_on: "2026-10-05" },
		]);

		// The employee sees the settled balance of their report, adjustment included.
		signIn("requester");
		const own = await finance.getTravelExpenseSettlement(source(original));
		expect(own.success && own.data?.account.summary.currencies[0]).toMatchObject({
			entitlement: "450.00",
			recovered: "50.00",
			balance: "0.00",
		});
		const mine = await finance.getMyTravelExpenseSettlements();
		expect(mine.success && Object.keys(mine.data)).toEqual([`report:${original}`]);
	});

	it("only adjusts exported or reimbursed reports of the employee's own, and replays a retried creation", async () => {
		const approvedOnly = await approvedHotel("120.00");
		expect(await createAdjustment(approvedOnly)).toEqual({
			status: "ineligible",
			reason: "not_exported_or_reimbursed",
		});
		const pending = await submittedHotel("80.00");
		expect(await createAdjustment(pending)).toEqual({
			status: "ineligible",
			reason: "not_approved",
		});
		expect(await createAdjustment(approvedOnly, "   ")).toEqual({
			status: "invalid",
			code: "required",
		});

		// An exported report is eligible without any reimbursement.
		signIn("finance");
		const exportable = await exportActions.getTravelExpenseExports();
		if (!exportable.success) throw new Error(exportable.error);
		const row = exportable.data.exportable.find((candidate) => candidate.reportId === approvedOnly);
		if (!row) throw new Error("not exportable");
		const batch = await exportActions.createTravelExpenseExportAction({
			idempotencyKey: randomUUID(),
			selection: [{ reportId: approvedOnly, revisionId: row.revisionId }],
		});
		expect(batch.success && batch.data.status).toBe("created");
		for (const job of harness.jobs.splice(0)) {
			expect(await processTravelExpenseExportBatch(db, job)).toEqual({ status: "completed" });
		}

		const key = randomUUID();
		const first = await createAdjustment(approvedOnly, "Wrong hotel rate", key);
		const again = await createAdjustment(approvedOnly, "Wrong hotel rate", key);
		if (first.status !== "created") throw new Error(first.status);
		expect(again).toEqual({ status: "created", reportId: first.reportId, replayed: true });
		expect(await createAdjustment(approvedOnly, "Something else", key)).toEqual({
			status: "idempotency_conflict",
		});
		// An adjustment is corrected through its original, never adjusted itself.
		await setAmount(first.reportId, "100.00");
		expect(await submit(first.reportId)).toEqual({ status: "submitted" });
		expect((await approve(first.reportId)).status).toBe(200);
		expect(await createAdjustment(first.reportId)).toEqual({
			status: "ineligible",
			reason: "is_adjustment",
		});

		// Nobody else adjusts the employee's report, and tenants stay apart.
		signIn("colleague");
		expect(
			await adjustments.createTravelExpenseAdjustmentAction({
				originalReportId: approvedOnly,
				reason: "Mine now",
				idempotencyKey: randomUUID(),
			}),
		).toEqual({ success: false, error: "Expense report not found" });
		signIn("foreigner");
		expect(
			await adjustments.createTravelExpenseAdjustmentAction({
				originalReportId: approvedOnly,
				reason: "Foreign",
				idempotencyKey: randomUUID(),
			}),
		).toEqual({ success: false, error: "Expense report not found" });
		const { rows } = await admin.query(
			"select count(*)::int as count from travel_expense_report_adjustment where organization_id = 't615-org'",
		);
		expect(rows[0]?.count).toBe(1);
	});

	it("keeps pending and rejected adjustments out of the entitlement", async () => {
		const original = await paidHotel();
		const rejected = await adjustTo(original, "450.00");
		expect((await reject(rejected)).status).toBe(200);
		const pending = await adjustTo(original, "520.00");
		expect(pending).not.toBe(rejected);

		const account = await settlement(original);
		expect(account.summary.currencies).toEqual([
			expect.objectContaining({ entitlement: "500.00", balance: "0.00" }),
		]);
		expect(account.adjustments).toEqual([]);

		// The owner sees both, with their state; nothing of them is applied.
		signIn("requester");
		const view = await adjustments.getTravelExpenseReportAdjustments(original);
		if (!view.success || view.data.role !== "original") throw new Error("no view");
		expect(
			view.data.adjustments.map(({ reportId, status, delta, applied }) => ({
				reportId,
				status,
				delta,
				applied,
			})),
		).toEqual(
			expect.arrayContaining([
				{ reportId: rejected, status: "rejected", delta: "-50.00", applied: false },
				{ reportId: pending, status: "submitted", delta: "20.00", applied: false },
			]),
		);
	});

	it("never lets a competing adjustment undo an approved correction of another expense", async () => {
		// EUR 300 hotel + EUR 200 taxi, paid. A corrects the hotel, B the taxi; both copy EUR 500.
		const original = await paidTrip();
		const first = await correctTrip(original, { "Hotel Hamburg": "250.00" });
		const second = await correctTrip(original, { "Taxi Hamburg": "180.00" });

		expect((await approve(first)).status).toBe(200);
		// Calculated against EUR 500, which is no longer the approved amount.
		const stale = await approve(second);
		expect(stale.status).toBe(409);
		expect((await settlement(original)).summary.currencies[0]?.entitlement).toBe("450.00");

		// Returned and resubmitted, B would still claim the uncorrected EUR 300 hotel
		// (EUR 480 = 450 + 30), silently undoing A. It is refused instead.
		signIn("manager");
		const returned = await review.returnTravelExpenseReportAction({
			approvalId: await pendingRequestId(second),
			note: "Please recalculate against the corrected amount",
			itemComments: [],
		});
		expect(returned.success).toBe(true);
		expect(await submit(second)).toEqual({
			status: "adjustment_unavailable",
			reason: "source_superseded",
		});
		expect((await loadOwn(second)).status).toBe("returned");

		// A fresh adjustment copies A's corrected facts and keeps both corrections.
		const fresh = await createAdjustment(original, "Taxi was cheaper");
		if (fresh.status !== "created") throw new Error(fresh.status);
		expect(
			(await loadOwn(fresh.reportId)).items.map((item) => [item.description, item.amount]),
		).toEqual([
			["Hotel Hamburg", "250.00"],
			["Taxi Hamburg", "200.00"],
		]);
		await setTripAmounts(fresh.reportId, { "Taxi Hamburg": "180.00" });
		expect(await submit(fresh.reportId)).toEqual({ status: "submitted" });
		expect((await approve(fresh.reportId)).status).toBe(200);

		const account = await settlement(original);
		expect(account.summary.currencies[0]).toMatchObject({
			entitlement: "430.00",
			balance: "-70.00",
		});
		expect(account.adjustments.map((entry) => entry.delta)).toEqual(["-50.00", "-20.00"]);
	});

	it("refuses to submit an adjustment copied before another adjustment was approved", async () => {
		const original = await paidTrip();
		const first = await createAdjustment(original, "Hotel refund");
		const second = await createAdjustment(original, "Taxi refund");
		if (first.status !== "created" || second.status !== "created") throw new Error("not created");
		await setTripAmounts(first.reportId, { "Hotel Hamburg": "250.00" });
		expect(await submit(first.reportId)).toEqual({ status: "submitted" });
		expect((await approve(first.reportId)).status).toBe(200);

		// B's copy still holds the EUR 300 hotel A corrected.
		await setTripAmounts(second.reportId, { "Taxi Hamburg": "180.00" });
		expect(await submit(second.reportId)).toEqual({
			status: "adjustment_unavailable",
			reason: "source_superseded",
		});
		const { rows } = await admin.query(
			"select status, submission_count from travel_expense_report where id = $1",
			[second.reportId],
		);
		expect(rows[0]).toEqual({ status: "draft", submission_count: 0 });
		expect((await settlement(original)).summary.currencies[0]?.entitlement).toBe("450.00");
	});

	it("serializes concurrent approvals of competing adjustments: exactly one applies", async () => {
		const original = await paidHotel();
		const left = await adjustTo(original, "450.00");
		const right = await adjustTo(original, "470.00");
		const statuses = (await Promise.all([approve(left), approve(right)])).map((r) => r.status);
		expect(statuses.toSorted()).toEqual([200, 409]);
		const account = await settlement(original);
		expect(account.adjustments).toHaveLength(1);
		expect(["450.00", "470.00"]).toContain(account.summary.currencies[0]?.entitlement);
	});

	it("starts a later correction from the then-effective approved facts and keeps the original's receipts", async () => {
		const original = await paidHotel();
		const first = await adjustTo(original, "450.00");
		expect((await approve(first)).status).toBe(200);

		const created = await createAdjustment(original, "Minibar charge was private");
		if (created.status !== "created") throw new Error(created.status);
		const copy = await loadOwn(created.reportId);
		// Copied from the approved adjustment (EUR 450), not from the original EUR 500.
		expect(copy.status).toBe("draft");
		expect(copy.items.map((item) => item.amount)).toEqual(["450.00"]);
		const [copied] = copy.items[0]?.receipts ?? [];
		if (!copied) throw new Error("receipt not copied");
		signIn("requester");
		expect((await receipt(created.reportId, copied.id)).status).toBe(200);
		signIn("requester");
		const draftView = await adjustments.getTravelExpenseReportAdjustments(created.reportId);
		expect(
			draftView.success &&
				draftView.data.role === "adjustment" &&
				draftView.data.baseline?.entitlement,
		).toBe("450.00");

		// Removing the copied receipt never deletes the evidence the original still names.
		const originalReport = await loadOwn(original);
		const originalReceipt = originalReport.items[0]?.receipts[0];
		if (!originalReceipt) throw new Error("no original receipt");
		const { rows } = await admin.query<{ storage_key: string }>(
			"select storage_key from travel_expense_report_receipt where id = $1",
			[originalReceipt.id],
		);
		const key = rows[0]?.storage_key ?? "";
		signIn("requester");
		const removed = await actions.removeReportReceiptAction({
			reportId: created.reportId,
			itemId: copy.items[0]?.id ?? "",
			receiptId: copied.id,
		});
		expect(removed.success).toBe(true);
		await runTravelExpenseReceiptCleanup(db, {
			deleteObject: async (input) => {
				harness.objects.delete(input.key);
			},
		});
		expect(harness.objects.has(key)).toBe(true);
		signIn("requester");
		expect((await receipt(original, originalReceipt.id)).status).toBe(200);

		// Corrected to EUR 430: EUR -20 against the effective EUR 450.
		signIn("requester");
		await upload(created.reportId, copy.items[0]?.id ?? "");
		await setAmount(created.reportId, "430.00");
		expect(await submit(created.reportId)).toEqual({ status: "submitted" });
		expect((await approve(created.reportId)).status).toBe(200);
		const account = await settlement(original);
		expect(account.adjustments.map((entry) => entry.delta)).toEqual(["-50.00", "-20.00"]);
		expect(account.summary.currencies[0]).toMatchObject({
			entitlement: "430.00",
			balance: "-70.00",
		});
	});

	it("exports an approved adjustment once, separately identifiable with its signed delta", async () => {
		const original = await paidHotel();
		const adjustment = await adjustTo(original, "450.00");
		expect((await approve(adjustment)).status).toBe(200);

		signIn("finance");
		const listed = await exportActions.getTravelExpenseExports();
		if (!listed.success) throw new Error(listed.error);
		const selection = listed.data.exportable
			.filter((row) => [original, adjustment].includes(row.reportId))
			.map(({ reportId, revisionId }) => ({ reportId, revisionId }));
		expect(selection).toHaveLength(2);
		const batch = await exportActions.createTravelExpenseExportAction({
			idempotencyKey: randomUUID(),
			selection,
		});
		if (!batch.success || batch.data.status !== "created") throw new Error("not created");
		for (const job of harness.jobs.splice(0)) {
			expect(await processTravelExpenseExportBatch(db, job)).toEqual({ status: "completed" });
		}
		const { rows } = await admin.query<{ storage_key: string }>(
			"select storage_key from travel_expense_export_batch where id = $1",
			[batch.data.batchId],
		);
		const zip = await JSZip.loadAsync(
			harness.objects.get(rows[0]?.storage_key ?? "") ?? Buffer.alloc(0),
		);
		const reports = (await zip.file("reports.csv")?.async("string")) ?? "";
		expect(reports).toContain(`"adjustment","${original}","The hotel refunded one night"`);
		// Baseline, delta, then the corrected report's own totals in their own columns.
		expect(reports).toMatch(/,500\.00,-50\.00,450\.00,\d+\.\d{2}\r\n/);
		expect(reports).toContain(`"original","",`);
		// The summable totals never double count: original 500.00 plus the -50.00 delta.
		signIn("finance");
		const exported = await exportActions.getTravelExpenseExports();
		expect(
			exported.success &&
				exported.data.batches.find((entry) => entry.id === batch.data.batchId)?.totals,
		).toEqual([expect.objectContaining({ currency: "EUR", reimbursable: "450.00" })]);

		// Each revision is exported once; the export recorded no money.
		signIn("finance");
		const after = await exportActions.getTravelExpenseExports();
		expect(
			after.success &&
				after.data.exportable.some((row) => [original, adjustment].includes(row.reportId)),
		).toBe(false);
		expect(await entries(original)).toHaveLength(1);
	});

	it("never reopens an approved adjustment once its original was paid", async () => {
		const original = await paidHotel();
		const adjustment = await adjustTo(original, "450.00");
		expect((await approve(adjustment)).status).toBe(200);

		// The adjustment itself was neither exported nor paid; its original was.
		const refused = { status: "adjustment_required", reason: "reimbursed" };
		signIn("manager");
		expect(await reopenActions.getTravelExpenseReportReopenState(adjustment)).toEqual({
			success: true,
			data: refused,
		});
		expect(await reopen(adjustment)).toEqual({ success: true, data: refused });

		// Nothing changed: the adjustment stays approved and its delta stays applied.
		const { rows } = await admin.query(
			`select r.status, (select count(*)::int from travel_expense_report_cycle_closure c
			   where c.report_id = r.id) as closures
			 from travel_expense_report r where r.id = $1`,
			[adjustment],
		);
		expect(rows[0]).toEqual({ status: "approved", closures: 0 });
		expect((await settlement(original)).summary.currencies[0]).toMatchObject({
			entitlement: "450.00",
			balance: "-50.00",
		});
	});

	it("serializes reopening an adjustment with a reimbursement of its original on the original's lock", async () => {
		for (const reopenFirst of [true, false]) {
			// Exported, not yet paid: the adjustment exists without any money recorded.
			const original = await approvedHotel("500.00");
			await exportReport(original);
			const adjustment = await adjustTo(original, "450.00");
			expect((await approve(adjustment)).status).toBe(200);

			const holder = await holdReportLock(original);
			let reopened: ReturnType<typeof reopen>;
			let paid: Promise<void>;
			try {
				if (reopenFirst) {
					// The reopen now waits for the original row, not only the adjustment's.
					reopened = reopen(adjustment, "Race");
					await waitForLockWaiters(1);
					paid = reimburse(original, "450.00", "450.00");
					await waitForLockWaiters(2);
				} else {
					paid = reimburse(original, "450.00", "450.00");
					await waitForLockWaiters(1);
					reopened = reopen(adjustment, "Race");
					await waitForLockWaiters(2);
				}
			} finally {
				await holder.query("commit");
				holder.release();
			}
			const [reopenResult] = await Promise.all([reopened, paid]);
			expect(reopenResult).toEqual({
				success: true,
				data: { status: "adjustment_required", reason: reopenFirst ? "exported" : "reimbursed" },
			});
			const account = await settlement(original);
			expect(account.adjustments.map((entry) => entry.reportId)).toEqual([adjustment]);
			expect(account.summary.currencies[0]).toMatchObject({
				entitlement: "450.00",
				reimbursed: "450.00",
				balance: "0.00",
			});
			await seed();
		}
	});

	it("keeps adjustment links immutable", async () => {
		const original = await paidHotel();
		const created = await createAdjustment(original);
		if (created.status !== "created") throw new Error(created.status);
		await expect(
			admin.query("update travel_expense_report_adjustment set reason = 'x' where report_id = $1", [
				created.reportId,
			]),
		).rejects.toThrow(/immutable/);
	});
});
