/**
 * #617: the unified Travel Expenses history and the complete employee →
 * reviewer → finance journey across new reports and legacy claims.
 *
 * Everything runs through the real actions, inbox routes and settlement owners
 * against a disposable PostgreSQL database; only the session, notifications,
 * the queue and object storage are replaced.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import type { ExpenseHistoryRow, LegacyClaimHistoryRow, ReportHistoryRow } from "./expense-history";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t617-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
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
	async addJob() {
		return { id: randomUUID() };
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t617-public",
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
		return { bucket: "t617-private", versionId: `v-${key.length}` };
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
const history = await import("@/app/[locale]/(app)/travel-expenses/history-actions");
const adjustments = await import("@/app/[locale]/(app)/travel-expenses/adjustment-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const legacyDrafts = await import("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions");
const legacyClaims = await import("@/app/[locale]/(app)/travel-expenses/actions");
const { insertLegacyTravelExpenseDraft, submitLegacyTravelExpenseClaim } = await import(
	"./__tests__/legacy-claim"
);
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { GET: getApprovalDetail } = await import("@/app/api/approvals/inbox/[id]/route");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/approvals/inbox/[id]/reject/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e6170000-0000-4000-8000-000000000001",
	manager: "e6170000-0000-4000-8000-000000000002",
	approver: "e6170000-0000-4000-8000-000000000003",
	finance: "e6170000-0000-4000-8000-000000000004",
	colleague: "e6170000-0000-4000-8000-000000000005",
	foreigner: "e6170000-0000-4000-8000-000000000006",
} as const;
type Person = keyof typeof ids;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t617-org', 't617-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't617-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t617-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t617-org','Expenses','t617-org','Europe/Berlin',now()),
		 ('t617-foreign','Foreign','t617-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t617-org", "member", "employee"],
		["manager", "t617-org", "member", "manager"],
		["approver", "t617-org", "member", "manager"],
		["finance", "t617-org", "admin", "employee"],
		["colleague", "t617-org", "member", "employee"],
		["foreigner", "t617-foreign", "owner", "admin"],
	];
	for (const [name, organizationId, memberRole, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t617-${name}`, name, `t617-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t617-member-${name}`, organizationId, `t617-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t617-${name}`, organizationId, role],
		);
	}
	for (const employeeId of [ids.requester, ids.colleague]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't617-manager', now(), now())`,
			[employeeId, ids.manager],
		);
	}
	// The designated organization expense approver reviews when no manager can.
	await admin.query(
		`insert into travel_expense_settings (organization_id, expense_approver_employee_id, updated_at)
		 values ('t617-org', $1, now())`,
		[ids.approver],
	);
}

function signIn(name: Person) {
	harness.userId = `t617-${name}`;
	harness.organizationId = name === "foreigner" ? "t617-foreign" : "t617-org";
}

async function upload(reportId: string, itemId: string, person: Person) {
	const tusFileKey = createOwnedTusFileKey(`t617-${person}`);
	harness.tus.set(tusFileKey, pdfBytes);
	const response = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName: "invoice.pdf" }),
		}) as unknown as NextRequest,
	);
	if (response.status !== 200) throw new Error(`upload ${response.status}`);
}

async function loadOwn(reportId: string) {
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	return report.data;
}

async function setHotel(reportId: string, amount: string, paidBy: "employee" | "company") {
	const item = (await loadOwn(reportId)).items[0];
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
			paidBy,
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

/** A submitted standalone hotel receipt of `person`. */
async function submittedHotel(
	person: Person,
	amount: string,
	paidBy: "employee" | "company" = "employee",
) {
	signIn(person);
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	await setHotel(reportId, amount, paidBy);
	await upload(reportId, (await loadOwn(reportId)).items[0]?.id ?? "", person);
	expect(await submit(reportId)).toEqual({ status: "submitted" });
	return reportId;
}

async function pendingRequest(reportId: string) {
	const { rows } = await admin.query<{ id: string; approver_id: string }>(
		"select id, approver_id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	const row = rows[0];
	if (!row) throw new Error("no pending request");
	return row;
}

async function decide(reportId: string, as: Person, action: "approve" | "reject") {
	const { id } = await pendingRequest(reportId);
	signIn(as);
	const route = action === "approve" ? approveRoute : rejectRoute;
	const response = await route(
		new Request(`http://localhost/api/approvals/inbox/${id}/${action}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(action === "reject" ? { reason: "Not a business expense" } : {}),
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id }) },
	);
	expect(response.status).toBe(200);
}

async function reimburse(reportId: string, amount: string) {
	signIn("finance");
	const result = await finance.recordTravelExpenseReimbursementAction({
		source: { type: "report", id: reportId },
		idempotencyKey: randomUUID(),
		amount,
		occurredOn: "2026-10-01",
		reference: "SEPA-617",
		note: null,
		expectedBalance: { currency: "EUR", amount },
	});
	expect(result.success && result.data.status).toBe("recorded");
}

async function adjustTo(originalReportId: string, amount: string) {
	signIn("requester");
	const created = await adjustments.createTravelExpenseAdjustmentAction({
		originalReportId,
		reason: "The hotel refunded one night",
		idempotencyKey: randomUUID(),
	});
	if (!created.success || created.data.status !== "created") throw new Error("not created");
	const { reportId } = created.data;
	await setHotel(reportId, amount, "employee");
	expect(await submit(reportId)).toEqual({ status: "submitted" });
	return reportId;
}

async function myHistory(person: Person): Promise<ExpenseHistoryRow[]> {
	signIn(person);
	const result = await history.getMyTravelExpenseHistory();
	if (!result.success) throw new Error(result.error);
	return result.data;
}

function reportRow(rows: ExpenseHistoryRow[], id: string): ReportHistoryRow {
	const row = rows.find((candidate) => candidate.id === id);
	if (row?.source !== "report") throw new Error(`no report row ${id}`);
	return row;
}

function claimRow(rows: ExpenseHistoryRow[], id: string): LegacyClaimHistoryRow {
	const row = rows.find((candidate) => candidate.id === id);
	if (row?.source !== "legacy_claim") throw new Error(`no claim row ${id}`);
	return row;
}

const owner = (person: Person) => ({
	organizationId: person === "foreigner" ? "t617-foreign" : "t617-org",
	employeeId: ids[person],
	userId: `t617-${person}`,
});

describe("unified expense history and role journeys (#617)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
	});
	afterAll(cleanup);

	it("presents every report and earlier claim of the employee with statuses, logical dates and balances", async () => {
		// New reports in every stage.
		signIn("requester");
		const trip = await actions.createTripReportAction();
		if (!trip.success) throw new Error(trip.error);
		const paid = await submittedHotel("requester", "500.00");
		await decide(paid, "manager", "approve");
		await reimburse(paid, "500.00");
		const adjustment = await adjustTo(paid, "450.00");
		await decide(adjustment, "manager", "approve");
		const rejected = await submittedHotel("requester", "80.00");
		await decide(rejected, "manager", "reject");
		const companyPaid = await submittedHotel("requester", "240.00", "company");

		// Legacy claims keep their own authority and logical dates.
		const pendingClaim = await insertLegacyTravelExpenseDraft(db, owner("requester"));
		await submitLegacyTravelExpenseClaim(db, { ...owner("requester"), claimId: pendingClaim });
		const approvedClaim = await insertLegacyTravelExpenseDraft(db, {
			...owner("requester"),
			tripStart: "2026-02-10",
			tripEnd: "2026-02-12",
			destinationCity: "München",
		});
		await submitLegacyTravelExpenseClaim(db, { ...owner("requester"), claimId: approvedClaim });
		signIn("manager");
		expect((await legacyClaims.approveTravelExpenseClaim({ claimId: approvedClaim })).success).toBe(
			true,
		);
		const openDraft = await insertLegacyTravelExpenseDraft(db, owner("requester"));
		const continuedDraft = await insertLegacyTravelExpenseDraft(db, owner("requester"));
		signIn("requester");
		const converted = await legacyDrafts.convertLegacyTravelExpenseDraftAction(continuedDraft);
		if (!converted.success || converted.data.kind !== "converted") throw new Error("not converted");

		// Other people's expenses never appear.
		const colleagues = await submittedHotel("colleague", "10.00");
		signIn("foreigner");
		const foreign = await actions.createStandaloneReceiptReportAction();
		if (!foreign.success) throw new Error(foreign.error);

		const rows = await myHistory("requester");
		expect(rows.map((row) => row.id).sort()).toEqual(
			[
				trip.data.reportId,
				paid,
				adjustment,
				rejected,
				companyPaid,
				converted.data.reportId,
				pendingClaim,
				approvedClaim,
				openDraft,
			].sort(),
		);
		expect(rows.map((row) => row.id)).not.toContain(colleagues);
		expect(rows.map((row) => row.id)).not.toContain(foreign.data.reportId);
		expect(rows.map((row) => row.id)).not.toContain(continuedDraft);

		expect(reportRow(rows, trip.data.reportId)).toMatchObject({
			stage: "needs_action",
			kind: "trip",
			status: "draft",
		});
		// EUR 500 reimbursed, corrected to EUR 450: a visible EUR 50 overpayment on the original.
		expect(reportRow(rows, paid)).toMatchObject({
			stage: "approved",
			totals: { reimbursable: "500.00", currency: "EUR" },
			balance: {
				state: "overpaid",
				currencies: [expect.objectContaining({ balance: "-50.00", entitlement: "450.00" })],
			},
		});
		expect(reportRow(rows, adjustment)).toMatchObject({
			stage: "approved",
			adjustmentOf: { reportId: paid, title: "Hotel Hamburg" },
			balance: null,
		});
		expect(reportRow(rows, rejected)).toMatchObject({ stage: "rejected", balance: null });
		// Company-paid costs stay visible but are never owed to the employee.
		expect(reportRow(rows, companyPaid)).toMatchObject({
			stage: "in_review",
			totals: { reimbursable: "0.00", companyPaid: "240.00" },
		});
		expect(reportRow(rows, converted.data.reportId)).toMatchObject({
			stage: "needs_action",
			continuedFromClaimId: continuedDraft,
		});
		expect(claimRow(rows, pendingClaim)).toMatchObject({
			stage: "in_review",
			status: "submitted",
			balance: null,
		});
		expect(claimRow(rows, approvedClaim)).toMatchObject({
			stage: "approved",
			href: `/travel-expenses/${approvedClaim}`,
			dates: { start: "2026-02-10", end: "2026-02-12" },
			destination: "München",
			amount: { amount: "120.50", currency: "EUR" },
			balance: { state: "outstanding" },
		});
		expect(claimRow(rows, openDraft)).toMatchObject({ canContinue: true });

		// Reviewers, finance users and other tenants each see only their own expenses.
		expect((await myHistory("manager")).map((row) => row.id)).toEqual([]);
		expect((await myHistory("finance")).map((row) => row.id)).toEqual([]);
		expect((await myHistory("colleague")).map((row) => row.id)).toEqual([colleagues]);
		expect((await myHistory("foreigner")).map((row) => row.id)).toEqual([foreign.data.reportId]);
	});

	it("lets the reviewer of an adjustment open the approved report it corrects, and nobody else", async () => {
		const paid = await submittedHotel("requester", "500.00");
		await decide(paid, "manager", "approve");
		await reimburse(paid, "500.00");
		// The requester no longer has a manager: the expense approver reviews the adjustment.
		await admin.query("delete from employee_managers where employee_id = $1", [ids.requester]);
		const adjustment = await adjustTo(paid, "450.00");
		const request = await pendingRequest(adjustment);
		expect(request.approver_id).toBe(ids.approver);

		signIn("approver");
		const detail = await (
			await getApprovalDetail({} as NextRequest, { params: Promise.resolve({ id: request.id }) })
		).json();
		expect(JSON.stringify(detail.sections)).toContain(`"href":"/travel-expenses/reports/${paid}"`);
		const original = await actions.getTravelExpenseReportSubmission(paid);
		expect(original.success && original.data).toMatchObject({
			reportId: paid,
			access: "reviewer",
			status: "approved",
		});

		signIn("colleague");
		expect(await actions.getTravelExpenseReportSubmission(paid)).toEqual({
			success: false,
			error: "Expense report not found",
		});
		signIn("foreigner");
		expect((await actions.getTravelExpenseReportSubmission(paid)).success).toBe(false);
	});
});
