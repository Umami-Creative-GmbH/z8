/**
 * #612: the finance queue, finance evidence access and recorded reimbursements.
 *
 * Reports are submitted and approved through the real report actions and
 * Approvals inbox routes against a disposable PostgreSQL database; only the
 * session, notifications and object storage are replaced.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t612-org",
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
}));
// #752: the real notification service, observed; email is captured instead of sent.
vi.mock("@/lib/notifications/notification-service", async (original) => {
	const actual = await original<typeof import("@/lib/notifications/notification-service")>();
	return { ...actual, createNotification: vi.fn(actual.createNotification) };
});
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t612-public",
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
		return { bucket: "t612-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
		return bytes;
	},
	async privateObjectExists(input: { key: string }) {
		return harness.objects.has(input.key);
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
}));

const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const { DEFAULT_FINANCE_QUEUE_VIEW } = await import("@/lib/travel-expenses/finance-queue-params");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { GET: getReceipt } = await import(
	"@/app/api/travel-expenses/reports/[reportId]/receipts/[receiptId]/route"
);
const { GET: getClaim } = await import("@/app/api/travel-expenses/[claimId]/route");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const recovery = await import("@/app/[locale]/(app)/travel-expenses/finance-recovery-actions");
const { createNotification } = await import("@/lib/notifications/notification-service");
const { sendEmail } = await import("@/lib/email/email-service");

const ids = {
	requester: "e6120000-0000-4000-8000-000000000001",
	manager: "e6120000-0000-4000-8000-000000000002",
	lead: "e6120000-0000-4000-8000-000000000003",
	finance: "e6120000-0000-4000-8000-000000000004",
	accountant: "e6120000-0000-4000-8000-000000000005",
	foreigner: "e6120000-0000-4000-8000-000000000006",
	role: "e6121000-0000-4000-8000-000000000001",
	claim: "e6122000-0000-4000-8000-000000000001",
	foreignClaim: "e6122000-0000-4000-8000-000000000002",
} as const;
type Person = "requester" | "manager" | "lead" | "finance" | "accountant" | "foreigner";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");
/** A receipt photo, so finance can also be checked for its preview (#690). */
const receiptPhoto = await sharp({
	create: { width: 400, height: 300, channels: 3, background: "#f0ece4" },
})
	.png({ compressionLevel: 9 })
	.toBuffer();

async function cleanup() {
	await admin.query("delete from organization where id in ('t612-org', 't612-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't612-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t612-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t612-org','Expenses','t612-org','Europe/Berlin',now()),
		 ('t612-foreign','Foreign','t612-foreign','UTC',now())`,
	);
	// [name, employee id, organization, org member role, employee role]
	const people: Array<[Person, string, string, string, string]> = [
		["requester", ids.requester, "t612-org", "member", "employee"],
		["manager", ids.manager, "t612-org", "member", "manager"],
		["lead", ids.lead, "t612-org", "member", "manager"],
		["finance", ids.finance, "t612-org", "admin", "employee"],
		["accountant", ids.accountant, "t612-org", "member", "employee"],
		["foreigner", ids.foreigner, "t612-foreign", "owner", "admin"],
	];
	for (const [name, employeeId, organizationId, memberRole, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t612-${name}`, name, `t612-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t612-member-${name}`, organizationId, `t612-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[employeeId, `t612-${name}`, organizationId, role],
		);
	}
	// The manager approves the requester's expenses; the lead manages nobody here.
	await admin.query(
		`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
		 values (gen_random_uuid(), $1, $2, true, 't612-manager', now(), now())`,
		[ids.requester, ids.manager],
	);
	// An accountant whose custom role grants read-only finance access.
	await admin.query(
		`insert into custom_role (id, organization_id, name, base_tier, created_by, updated_at)
		 values ($1, 't612-org', 'Accounting', 'employee', 't612-finance', now())`,
		[ids.role],
	);
	await admin.query(
		`insert into custom_role_permission (id, custom_role_id, action, subject)
		 values (gen_random_uuid(), $1, 'read', 'TravelExpenseFinance')`,
		[ids.role],
	);
	await admin.query(
		`insert into employee_custom_role (id, employee_id, custom_role_id, assigned_by)
		 values (gen_random_uuid(), $1, $2, 't612-finance')`,
		[ids.accountant, ids.role],
	);
	// Approved legacy claims from before the report model.
	for (const [claimId, organizationId, employeeId] of [
		[ids.claim, "t612-org", ids.requester],
		[ids.foreignClaim, "t612-foreign", ids.foreigner],
	]) {
		await admin.query(
			`insert into travel_expense_claim (id, organization_id, employee_id, type, status, trip_start, trip_end,
			   original_currency, original_amount, calculated_currency, calculated_amount,
			   submitted_at, decided_at, created_by, updated_at)
			 values ($1, $2, $3, 'mileage', 'approved', '2026-08-03', '2026-08-03',
			   'EUR', '42.00', 'EUR', '42.00', '2026-08-04', '2026-08-05', $4, now())`,
			[
				claimId,
				organizationId,
				employeeId,
				organizationId === "t612-org" ? "t612-requester" : "t612-foreigner",
			],
		);
	}
}

function signIn(name: Person) {
	harness.userId = `t612-${name}`;
	harness.organizationId = name === "foreigner" ? "t612-foreign" : "t612-org";
}

async function upload(reportId: string, itemId: string, bytes: Buffer) {
	signIn("requester");
	const tusFileKey = createOwnedTusFileKey("t612-requester");
	harness.tus.set(tusFileKey, bytes);
	return processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId, fileName: "receipt" }),
		}) as unknown as NextRequest,
	);
}

/**
 * A submitted trip: an employee-paid EUR 89.90 train with a receipt photo and a
 * company-paid EUR 240.00 hotel with a PDF receipt.
 */
async function submittedTrip() {
	signIn("requester");
	const created = await actions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	const reportId = created.data.reportId;
	const loaded = await actions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	await actions.saveTripDetailsDraftAction({
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
	for (const [values, receipt] of [
		[
			{ category: "transport", description: "Train", amount: "89.90", paidBy: "employee" },
			receiptPhoto,
		],
		[
			{ category: "accommodation", description: "Hotel", amount: "240.00", paidBy: "company" },
			pdfBytes,
		],
	] as const) {
		signIn("requester");
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
		if (!saved.success) throw new Error("save failed");
		expect((await upload(reportId, added.data.item.id, receipt)).status).toBe(200);
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
	expect(submitted).toEqual({ success: true, data: { status: "submitted" } });
	return {
		reportId,
		receiptId: report.data.items[0]?.receipts[0]?.id ?? "",
		pdfReceiptId: report.data.items[1]?.receipts[0]?.id ?? "",
	};
}

async function approve(reportId: string) {
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	const requestId = rows[0]?.id;
	if (!requestId) throw new Error("no pending request");
	signIn("manager");
	const response = await approveRoute(
		new Request(`http://localhost/api/approvals/inbox/${requestId}/approve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: requestId }) },
	);
	expect(response.status).toBe(200);
}

async function approvedTrip() {
	const trip = await submittedTrip();
	await approve(trip.reportId);
	return trip;
}

function receipt(reportId: string, receiptId: string, query = "") {
	return getReceipt(
		new Request(
			`http://localhost/api/travel-expenses/reports/${reportId}/receipts/${receiptId}${query}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ reportId, receiptId }) },
	);
}

function reimburse(
	source: { type: "report" | "legacy_claim"; id: string },
	amount: string,
	expected: string,
	options: { key?: string; reference?: string } = {},
) {
	return finance.recordTravelExpenseReimbursementAction({
		source,
		idempotencyKey: options.key ?? randomUUID(),
		amount,
		occurredOn: "2026-10-01",
		reference: options.reference ?? "SEPA-4711",
		note: null,
		expectedBalance: { currency: "EUR", amount: expected },
	});
}

async function entryCount() {
	const { rows } = await admin.query<{ count: number }>(
		"select count(*)::int as count from travel_expense_settlement_entry where organization_id = 't612-org'",
	);
	return rows[0]?.count ?? 0;
}

describe("finance queue and recorded reimbursements (#612)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
	});
	afterAll(cleanup);

	it("lists approved reports and legacy claims of the organization only, with employee- and company-paid costs apart", async () => {
		const approved = await approvedTrip();
		const pending = await submittedTrip();

		signIn("finance");
		const queue = await finance.getTravelExpenseFinanceQueue({
			...DEFAULT_FINANCE_QUEUE_VIEW,
			status: "all",
		});
		if (!queue.success) throw new Error(queue.error);
		expect(queue.data.canSettle).toBe(true);
		const rows = queue.data.accounts.map((account) => ({
			source: account.source,
			employeeName: account.employeeName,
			currency: account.currency,
			evidence: account.basis?.evidence,
			companyPaid: account.basis?.companyPaid,
			balance: account.summary.currencies,
		}));
		expect(rows).toHaveLength(2);
		expect(rows).toContainEqual({
			source: { type: "report", id: approved.reportId },
			employeeName: "requester",
			currency: "EUR",
			evidence: "frozen_revision",
			companyPaid: "240.00",
			balance: [
				{
					currency: "EUR",
					entitlement: "89.90",
					reimbursed: "0.00",
					recovered: "0.00",
					balance: "89.90",
					state: "outstanding",
				},
			],
		});
		expect(rows).toContainEqual(
			expect.objectContaining({
				source: { type: "legacy_claim", id: ids.claim },
				evidence: "legacy_claim",
				companyPaid: null,
			}),
		);
		expect(rows.some((row) => row.source.id === pending.reportId)).toBe(false);
		expect(rows.some((row) => row.source.id === ids.foreignClaim)).toBe(false);

		// Read-only finance through a custom role: same queue, no settlement.
		signIn("accountant");
		const readOnly = await finance.getTravelExpenseFinanceQueue({
			...DEFAULT_FINANCE_QUEUE_VIEW,
			status: "open",
		});
		expect(readOnly.success && readOnly.data.canSettle).toBe(false);
		expect(readOnly.success && readOnly.data.accounts).toHaveLength(2);
	});

	it("never grants finance access through approval authority or plain membership", async () => {
		await approvedTrip();
		for (const person of ["manager", "lead", "requester"] as const) {
			signIn(person);
			expect(
				await finance.getTravelExpenseFinanceQueue({
					...DEFAULT_FINANCE_QUEUE_VIEW,
					status: "all",
				}),
			).toEqual({
				success: false,
				error: "Unauthorized",
			});
		}
		signIn("foreigner");
		const foreign = await finance.getTravelExpenseFinanceQueue({
			...DEFAULT_FINANCE_QUEUE_VIEW,
			status: "all",
		});
		expect(foreign.success && foreign.data.accounts.map((a) => a.source.id)).toEqual([
			ids.foreignClaim,
		]);
	});

	it("lets finance open approved frozen evidence and receipts, but not submitted reports or other tenants", async () => {
		const approved = await approvedTrip();
		const pending = await submittedTrip();

		signIn("finance");
		const view = await actions.getTravelExpenseReportSubmission(approved.reportId);
		expect(view.success && view.data.access).toBe("finance");
		expect(view.success && view.data.facts.totals).toEqual({
			currency: "EUR",
			reimbursable: "89.90",
			companyPaid: "240.00",
		});
		expect((await receipt(approved.reportId, approved.receiptId)).status).toBe(200);
		const preview = await receipt(approved.reportId, approved.receiptId, "?variant=thumb");
		expect(preview.status).toBe(200);
		expect(preview.headers.get("content-type")).toBe("image/webp");
		const pdf = await receipt(approved.reportId, approved.pdfReceiptId);
		expect(pdf.headers.get("content-type")).toBe("application/pdf");
		expect(Buffer.from(await pdf.arrayBuffer())).toEqual(pdfBytes);
		expect((await receipt(approved.reportId, approved.pdfReceiptId, "?variant=thumb")).status).toBe(
			404,
		);
		expect((await actions.getTravelExpenseReportSubmission(pending.reportId)).success).toBe(false);
		expect((await receipt(pending.reportId, pending.receiptId)).status).toBe(404);
		expect((await receipt(pending.reportId, pending.receiptId, "?variant=thumb")).status).toBe(404);

		// A manager without authority over this report cannot open it or its receipts.
		signIn("lead");
		expect((await actions.getTravelExpenseReportSubmission(approved.reportId)).success).toBe(false);
		expect((await receipt(approved.reportId, approved.receiptId)).status).toBe(404);
		expect((await receipt(approved.reportId, approved.receiptId, "?variant=thumb")).status).toBe(
			404,
		);

		// Finance reads approved legacy claims too; the lead does not.
		signIn("accountant");
		const claimResponse = await getClaim(
			new Request(`http://localhost/api/travel-expenses/${ids.claim}`) as unknown as NextRequest,
			{ params: Promise.resolve({ claimId: ids.claim }) },
		);
		expect(claimResponse.status).toBe(200);
		signIn("lead");
		const leadClaim = await getClaim(
			new Request(`http://localhost/api/travel-expenses/${ids.claim}`) as unknown as NextRequest,
			{ params: Promise.resolve({ claimId: ids.claim }) },
		);
		expect(leadClaim.status).toBe(404);

		signIn("foreigner");
		expect((await actions.getTravelExpenseReportSubmission(approved.reportId)).success).toBe(false);
		expect(
			await finance.getTravelExpenseSettlement({ type: "report", id: approved.reportId }),
		).toEqual({ success: false, error: "Not found" });
	});

	it("records reimbursements with amount, date and reference and shows the employee their balance", async () => {
		const { reportId } = await approvedTrip();
		const source = { type: "report" as const, id: reportId };

		signIn("finance");
		const partial = await reimburse(source, "50.00", "89.90", { reference: "SEPA-1" });
		expect(partial.success && partial.data.status).toBe("recorded");
		const rest = await reimburse(source, "39.90", "39.90", { reference: "SEPA-2" });
		if (!rest.success || rest.data.status !== "recorded") throw new Error("not recorded");
		expect(rest.data.account.summary).toEqual({
			state: "settled",
			currencies: [
				{
					currency: "EUR",
					entitlement: "89.90",
					reimbursed: "89.90",
					recovered: "0.00",
					balance: "0.00",
					state: "settled",
				},
			],
		});
		const { rows } = await admin.query(
			`select kind, amount, currency, occurred_on::text, reference, balance_before, basis_submission_cycle,
			   recorded_by_employee_id from travel_expense_settlement_entry where report_id = $1 order by recorded_at`,
			[reportId],
		);
		expect(rows).toEqual([
			expect.objectContaining({
				kind: "reimbursement",
				amount: "50.00",
				occurred_on: "2026-10-01",
				reference: "SEPA-1",
				balance_before: "89.90",
				basis_submission_cycle: 1,
				recorded_by_employee_id: ids.finance,
			}),
			expect.objectContaining({ amount: "39.90", balance_before: "39.90", reference: "SEPA-2" }),
		]);

		signIn("requester");
		const own = await finance.getTravelExpenseSettlement(source);
		if (!own.success || !own.data) throw new Error("no own settlement");
		expect(own.data.viewer).toBe("owner");
		expect(own.data.account.summary.state).toBe("settled");
		expect(own.data.account.entries.map((entry) => [entry.amount, entry.reference])).toEqual([
			["50.00", "SEPA-1"],
			["39.90", "SEPA-2"],
		]);
		expect(own.data.account.entries.every((entry) => entry.recordedByName === null)).toBe(true);
		const mine = await finance.getMyTravelExpenseSettlements();
		expect(mine.success && mine.data[`report:${reportId}`]?.summary.state).toBe("settled");

		// The approving manager is no finance user and sees no settlement.
		signIn("manager");
		expect(await finance.getTravelExpenseSettlement(source)).toEqual({
			success: false,
			error: "Not found",
		});
	});

	it("records a retried command once and refuses a reused key for another command", async () => {
		const { reportId } = await approvedTrip();
		const source = { type: "report" as const, id: reportId };
		const key = randomUUID();

		signIn("finance");
		const first = await reimburse(source, "89.90", "89.90", { key });
		const retry = await reimburse(source, "89.90", "89.90", { key });
		expect(first.success && first.data.status === "recorded" && first.data.replayed).toBe(false);
		expect(retry.success && retry.data.status === "recorded" && retry.data.replayed).toBe(true);
		expect(await entryCount()).toBe(1);

		const reused = await reimburse(source, "10.00", "0.00", { key });
		expect(reused).toEqual({ success: true, data: { status: "idempotency_conflict" } });
		const another = await reimburse(source, "10.00", "0.00");
		expect(another.success && another.data.status === "refused" && another.data.reason).toBe(
			"nothing_outstanding",
		);
		expect(await entryCount()).toBe(1);
	});

	it("serializes concurrent reimbursements: only one is applied to the balance both saw", async () => {
		const { reportId } = await approvedTrip();
		const source = { type: "report" as const, id: reportId };

		signIn("finance");
		const results = await Promise.all([
			reimburse(source, "89.90", "89.90", { reference: "A" }),
			reimburse(source, "89.90", "89.90", { reference: "B" }),
		]);
		const statuses = results.map((result) =>
			result.success
				? result.data.status === "refused"
					? result.data.reason
					: result.data.status
				: "error",
		);
		expect(statuses.sort()).toEqual(["recorded", "stale_balance"]);
		expect(await entryCount()).toBe(1);
	});

	it("refuses settlement without approval, for one's own expense, without the settle permission and across tenants", async () => {
		const pending = await submittedTrip();
		signIn("finance");
		expect(await reimburse({ type: "report", id: pending.reportId }, "1.00", "0.00")).toEqual({
			success: true,
			data: { status: "not_approved" },
		});

		// Finance staff cannot record money for their own expenses.
		await admin.query("update travel_expense_claim set employee_id = $1 where id = $2", [
			ids.finance,
			ids.claim,
		]);
		expect(await reimburse({ type: "legacy_claim", id: ids.claim }, "42.00", "42.00")).toEqual({
			success: true,
			data: { status: "own_expense" },
		});
		await admin.query("update travel_expense_claim set employee_id = $1 where id = $2", [
			ids.requester,
			ids.claim,
		]);

		signIn("accountant");
		expect(await reimburse({ type: "legacy_claim", id: ids.claim }, "42.00", "42.00")).toEqual({
			success: false,
			error: "Unauthorized",
		});
		signIn("finance");
		expect(
			await reimburse({ type: "legacy_claim", id: ids.foreignClaim }, "42.00", "42.00"),
		).toEqual({
			success: false,
			error: "Not found",
		});

		// A legacy claim settles in its preserved calculated currency.
		const claim = await reimburse({ type: "legacy_claim", id: ids.claim }, "42.00", "42.00");
		expect(
			claim.success && claim.data.status === "recorded" && claim.data.account.summary.state,
		).toBe("settled");
		expect(await entryCount()).toBe(1);
	});

	it("finds an old open account behind more settled ones than one page, and pages the rest", async () => {
		// The seeded claim (decided 2026-08-05) stays open; four newer claims are settled.
		const settledIds: string[] = [];
		for (let day = 10; day < 14; day++) {
			const claimId = randomUUID();
			settledIds.push(claimId);
			await admin.query(
				`insert into travel_expense_claim (id, organization_id, employee_id, type, status, trip_start, trip_end,
				   original_currency, original_amount, calculated_currency, calculated_amount,
				   submitted_at, decided_at, created_by, updated_at)
				 values ($1, 't612-org', $2, 'mileage', 'approved', '2026-08-03', '2026-08-03',
				   'EUR', '10.00', 'EUR', '10.00', '2026-08-04', $3, 't612-requester', now())`,
				[claimId, ids.requester, `2026-08-${day}`],
			);
			await admin.query(
				`insert into travel_expense_settlement_entry (organization_id, source_type, legacy_claim_id, kind, amount,
				   currency, occurred_on, reference, balance_before, idempotency_key, command_fingerprint, recorded_by_user_id)
				 values ('t612-org', 'legacy_claim', $1, 'reimbursement', '10.00', 'EUR', '2026-09-01', 'SEPA',
				   '10.00', $2, 'fingerprint', 't612-finance')`,
				[claimId, randomUUID()],
			);
		}
		const { db } = await import("@/db");
		const { listFinanceQueue } = await import("@/lib/travel-expenses/finance-queue-store");
		const scope = { organizationId: "t612-org" } as const;
		// Read two sources per round trip, so the open claim lies behind more than one read.
		const small = { pageSize: 2, scanSize: 2 };

		const open = await listFinanceQueue(db, { ...scope, status: "open" }, small);
		expect(open.accounts.map((account) => account.source.id)).toEqual([ids.claim]);
		expect(open.hasMore).toBe(false);

		// More reimbursed accounts match than one page: the newest first, the rest on the next page.
		const first = await listFinanceQueue(db, { ...scope, status: "reimbursed" }, small);
		expect(first.accounts.map((account) => account.source.id)).toEqual(
			settledIds.toReversed().slice(0, 2),
		);
		expect(first.hasMore).toBe(true);
		const second = await listFinanceQueue(
			db,
			{ ...scope, status: "reimbursed" },
			{ ...small, page: 2 },
		);
		expect(second.accounts.map((account) => account.source.id)).toEqual(
			settledIds.toReversed().slice(2, 4),
		);
		expect(second.hasMore).toBe(false);

		const all = await listFinanceQueue(
			db,
			{ ...scope, status: "all" },
			{ pageSize: 10, scanSize: 2 },
		);
		expect(all.accounts).toHaveLength(5);
		expect(all.hasMore).toBe(false);

		signIn("finance");
		const action = await finance.getTravelExpenseFinanceQueue({
			...DEFAULT_FINANCE_QUEUE_VIEW,
			status: "open",
		});
		expect(action.success && action.data.hasMore).toBe(false);
		expect(action.success && action.data.accounts.map((account) => account.source.id)).toEqual([
			ids.claim,
		]);
	});

	it("keeps recorded money immutable in the database", async () => {
		const { reportId } = await approvedTrip();
		signIn("finance");
		await reimburse({ type: "report", id: reportId }, "89.90", "89.90");
		await expect(
			admin.query("update travel_expense_settlement_entry set amount = 1 where report_id = $1", [
				reportId,
			]),
		).rejects.toThrow(/immutable/);
		// Removing the finance employee keeps the entry and its recording user.
		await admin.query("delete from employee where id = $1", [ids.finance]);
		const { rows } = await admin.query(
			"select recorded_by_employee_id, recorded_by_user_id, amount from travel_expense_settlement_entry where report_id = $1",
			[reportId],
		);
		expect(rows).toEqual([
			{ recorded_by_employee_id: null, recorded_by_user_id: "t612-finance", amount: "89.90" },
		]);
	});
});

async function settlementNotifications() {
	const { rows } = await admin.query<{
		user_id: string;
		type: string;
		title: string;
		message: string;
		entity_id: string;
		action_url: string;
		metadata: string;
	}>(
		`select user_id, type::text, title, message, entity_id::text, action_url, metadata from notification
		 where organization_id = 't612-org' and type::text like 'travel_expense_%' order by created_at, id`,
	);
	return rows;
}

function settlementNotificationCalls() {
	return vi
		.mocked(createNotification)
		.mock.calls.filter(([params]) => params.type.startsWith("travel_expense_"));
}

describe("employee notifications of recorded money (#752)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		vi.mocked(createNotification).mockClear();
		vi.mocked(sendEmail).mockClear();
	});
	afterAll(cleanup);

	it("notifies the employee once per reimbursement: partially, then fully reimbursed", async () => {
		const { reportId } = await approvedTrip();
		const source = { type: "report" as const, id: reportId };

		signIn("finance");
		await reimburse(source, "50.00", "89.90", { reference: "SEPA-1" });
		await reimburse(source, "39.90", "39.90", { reference: "SEPA-2" });

		const notifications = await settlementNotifications();
		expect(
			notifications.map(({ user_id, type, title, message, entity_id, action_url }) => ({
				user_id,
				type,
				title,
				message,
				entity_id,
				action_url,
			})),
		).toEqual([
			{
				user_id: "t612-requester",
				type: "travel_expense_partially_reimbursed",
				title: "Expense partially reimbursed",
				message:
					"50.00 EUR of your travel expense has been reimbursed (payment reference SEPA-1). 39.90 EUR is still awaiting reimbursement.",
				entity_id: reportId,
				action_url: `/travel-expenses/reports/${reportId}`,
			},
			{
				user_id: "t612-requester",
				type: "travel_expense_reimbursed",
				title: "Expense reimbursed",
				message:
					"Your travel expense has been fully reimbursed: 39.90 EUR, payment reference SEPA-2.",
				entity_id: reportId,
				action_url: `/travel-expenses/reports/${reportId}`,
			},
		]);
		// Never the recorder's identity, matching the owner view.
		for (const notification of notifications) {
			expect(JSON.stringify(notification)).not.toMatch(/t612-finance|finance/i);
		}

		// Email goes out in the recipient's language with a link to the report.
		await vi.waitFor(() =>
			expect(vi.mocked(sendEmail)).toHaveBeenCalledWith(
				expect.objectContaining({
					to: "t612-requester@example.test",
					subject: "Expense reimbursed",
					html: expect.stringContaining(`/travel-expenses/reports/${reportId}`),
					organizationId: "t612-org",
				}),
			),
		);
	});

	it("does not notify again when the same idempotent request is replayed", async () => {
		const { reportId } = await approvedTrip();
		const source = { type: "report" as const, id: reportId };
		const key = randomUUID();

		signIn("finance");
		await reimburse(source, "89.90", "89.90", { key });
		const retry = await reimburse(source, "89.90", "89.90", { key });
		expect(retry.success && retry.data.status === "recorded" && retry.data.replayed).toBe(true);
		// Refused commands record nothing and notify nobody either.
		await reimburse(source, "10.00", "0.00", { key });
		await reimburse(source, "10.00", "0.00");

		expect((await settlementNotifications()).map((row) => row.type)).toEqual([
			"travel_expense_reimbursed",
		]);
		expect(settlementNotificationCalls()).toHaveLength(1);
		expect(settlementNotificationCalls()[0]?.[0].idempotencyKey).toBe(
			`travel-expense-settlement:${key}`,
		);
	});

	it("notifies the employee of a recorded recovery, linking the legacy claim", async () => {
		// The claim's EUR 42.00 was overpaid by EUR 8.00.
		await admin.query(
			`insert into travel_expense_settlement_entry (organization_id, source_type, legacy_claim_id, kind, amount,
			   currency, occurred_on, reference, balance_before, idempotency_key, command_fingerprint, recorded_by_user_id)
			 values ('t612-org', 'legacy_claim', $1, 'reimbursement', '50.00', 'EUR', '2026-09-01', 'SEPA',
			   '42.00', $2, 'fingerprint', 't612-finance')`,
			[ids.claim, randomUUID()],
		);

		signIn("finance");
		const recorded = await recovery.recordTravelExpenseRecoveryAction({
			source: { type: "legacy_claim", id: ids.claim },
			idempotencyKey: randomUUID(),
			amount: "8.00",
			occurredOn: "2026-10-01",
			reference: "Payroll deduction",
			note: "Deducted by Fiona from finance",
			expectedBalance: { currency: "EUR", amount: "-8.00" },
		});
		expect(recorded.success && recorded.data.status).toBe("recorded");

		const notifications = await settlementNotifications();
		expect(notifications).toEqual([
			expect.objectContaining({
				user_id: "t612-requester",
				type: "travel_expense_recovery_recorded",
				title: "Expense recovery recorded",
				message:
					"A recovery of 8.00 EUR was recorded for your travel expense (payment reference Payroll deduction).",
				entity_id: ids.claim,
				action_url: `/travel-expenses/${ids.claim}`,
			}),
		]);
		expect(notifications[0]?.metadata).not.toContain("Fiona");
	});
});
