/**
 * #755: marking a completed export batch as reimbursed.
 *
 * Reports are submitted, decided, adjusted and exported through the real
 * actions, routes and export worker against a disposable PostgreSQL database;
 * only the session, notifications, the queue and object storage are replaced.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t755-org",
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
	S3_PUBLIC_BUCKET: "t755-public",
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
		return { bucket: "t755-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = harness.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		harness.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		harness.objects.delete(input.key);
	},
}));

const { db } = await import("@/db");
const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const adjustments = await import("@/app/[locale]/(app)/travel-expenses/adjustment-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const exportActions = await import("@/app/[locale]/(app)/travel-expenses/finance-export-actions");
const { processTravelExpenseExportBatch } = await import("@/lib/travel-expenses/export-processor");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");

const ids = {
	requester: "e7550000-0000-4000-8000-000000000001",
	manager: "e7550000-0000-4000-8000-000000000002",
	finance: "e7550000-0000-4000-8000-000000000004",
	colleague: "e7550000-0000-4000-8000-000000000005",
	foreigner: "e7550000-0000-4000-8000-000000000006",
	officer: "e7550000-0000-4000-8000-000000000007",
	exporter: "e7550000-0000-4000-8000-000000000008",
} as const;
type Person = keyof typeof ids;
type Employee = "requester" | "colleague";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

async function cleanup() {
	await admin.query("delete from organization where id in ('t755-org', 't755-foreign')");
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't755-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t755-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t755-org','Expenses','t755-org','Europe/Berlin',now()),
		 ('t755-foreign','Foreign','t755-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string, string]> = [
		["requester", "t755-org", "member", "employee"],
		["manager", "t755-org", "member", "manager"],
		["finance", "t755-org", "admin", "employee"],
		["colleague", "t755-org", "member", "employee"],
		["foreigner", "t755-foreign", "owner", "admin"],
		["officer", "t755-org", "member", "employee"],
		["exporter", "t755-org", "member", "employee"],
	];
	for (const [name, organizationId, memberRole, role] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t755-${name}`, name, `t755-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t755-member-${name}`, organizationId, `t755-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t755-${name}`, organizationId, role],
		);
	}
	for (const employeeId of [ids.requester, ids.colleague]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't755-manager', now(), now())`,
			[employeeId, ids.manager],
		);
	}
	// An expense officer who exports and reimburses for everyone, and one who only exports.
	await admin.query(
		`insert into expense_officer_grant
		 (organization_id, officer_employee_id, scope, can_export, can_record_reimbursements, created_by)
		 values ('t755-org', $1, 'all', true, true, 't755-finance'),
		        ('t755-org', $2, 'all', true, false, 't755-finance')`,
		[ids.officer, ids.exporter],
	);
}

function signIn(name: Person) {
	harness.userId = `t755-${name}`;
	harness.organizationId = name === "foreigner" ? "t755-foreign" : "t755-org";
}

async function upload(owner: Employee, reportId: string, itemId: string) {
	const tusFileKey = createOwnedTusFileKey(`t755-${owner}`);
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

async function loadOwn(owner: Employee, reportId: string) {
	signIn(owner);
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	return report.data;
}

async function setAmount(owner: Employee, reportId: string, amount: string) {
	const item = (await loadOwn(owner, reportId)).items[0];
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

async function submit(owner: Employee, reportId: string) {
	const report = await loadOwn(owner, reportId);
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
	expect(submitted).toEqual({ success: true, data: { status: "submitted" } });
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

/** An approved standalone hotel receipt of EUR `amount`, paid by `owner`. */
async function approvedHotel(amount: string, owner: Employee = "requester") {
	signIn(owner);
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	await setAmount(owner, reportId, amount);
	const itemId = (await loadOwn(owner, reportId)).items[0]?.id ?? "";
	signIn(owner);
	await upload(owner, reportId, itemId);
	await submit(owner, reportId);
	await approve(reportId);
	return reportId;
}

/** Corrects the original hotel to EUR `amount` through an approved adjustment. */
async function approvedAdjustment(originalReportId: string, amount: string) {
	signIn("requester");
	const created = await adjustments.createTravelExpenseAdjustmentAction({
		originalReportId,
		reason: "The hotel charged a late checkout",
		idempotencyKey: randomUUID(),
	});
	if (!created.success || created.data.status !== "created") {
		throw new Error(`adjustment ${JSON.stringify(created)}`);
	}
	await setAmount("requester", created.data.reportId, amount);
	await submit("requester", created.data.reportId);
	await approve(created.data.reportId);
	return created.data.reportId;
}

/** Exports the reports' approved revisions in one batch; completes it unless `complete` is false. */
async function exportReports(
	reportIds: string[],
	options: { as?: Person; complete?: boolean } = {},
) {
	signIn(options.as ?? "finance");
	const listed = await exportActions.getTravelExpenseExports();
	if (!listed.success) throw new Error(listed.error);
	const selection = reportIds.map((reportId) => {
		const row = listed.data.exportable.find((candidate) => candidate.reportId === reportId);
		if (!row) throw new Error(`not exportable: ${reportId}`);
		return { reportId, revisionId: row.revisionId };
	});
	const created = await exportActions.createTravelExpenseExportAction({
		idempotencyKey: randomUUID(),
		selection,
	});
	if (!created.success || created.data.status !== "created") {
		throw new Error(`export ${JSON.stringify(created)}`);
	}
	const jobs = harness.jobs.splice(0);
	if (options.complete !== false) {
		for (const job of jobs) {
			expect(await processTravelExpenseExportBatch(db, job)).toEqual({ status: "completed" });
		}
	}
	return created.data.batchId;
}

const source = (id: string) => ({ type: "report" as const, id });

async function preview(batchId: string, as: Person = "finance") {
	signIn(as);
	return exportActions.getTravelExpenseExportReimbursement(batchId);
}

/** What the dialog shows: the accounts it offers, with the balances it shows. */
async function offered(batchId: string, as: Person = "finance") {
	const result = await preview(batchId, as);
	if (!result.success || result.data.status !== "ready") {
		throw new Error(`preview ${JSON.stringify(result)}`);
	}
	return result.data.accounts
		.filter((entry) => entry.skip === null && entry.account)
		.map((entry) => ({
			source: entry.source,
			expectedBalance: {
				currency: entry.account?.currency ?? "",
				amount: entry.account?.summary.currencies[0]?.balance ?? "",
			},
		}));
}

function markReimbursed(
	batchId: string,
	accounts: Awaited<ReturnType<typeof offered>>,
	options: { as?: Person; requestKey?: string } = {},
) {
	signIn(options.as ?? "finance");
	return exportActions.markTravelExpenseExportReimbursedAction({
		batchId,
		requestKey: options.requestKey ?? randomUUID(),
		accounts,
		occurredOn: "2026-10-01",
		reference: "SEPA-BATCH-7",
		note: "October expense run",
	});
}

function outcomes(result: Awaited<ReturnType<typeof markReimbursed>>) {
	if (!result.success || result.data.status !== "processed") {
		throw new Error(`mark ${JSON.stringify(result)}`);
	}
	return result.data.rows.map(({ source: rowSource, outcome, replayed, amount }) => ({
		id: rowSource.id,
		outcome,
		replayed,
		amount,
	}));
}

async function entries(reportId: string) {
	const { rows } = await admin.query(
		`select amount, reference, export_batch_id::text as batch from travel_expense_settlement_entry
		 where report_id = $1 order by recorded_at`,
		[reportId],
	);
	return rows;
}

async function entryCount() {
	const { rows } = await admin.query<{ count: number }>(
		"select count(*)::int as count from travel_expense_settlement_entry where organization_id = 't755-org'",
	);
	return rows[0]?.count;
}

describe("marking an export batch as reimbursed (#755)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.jobs.length = 0;
	});
	afterAll(cleanup);

	it("reimburses each account of a completed batch once, names the batch and replays a retry", async () => {
		const hotel = await approvedHotel("500.00");
		const colleagueHotel = await approvedHotel("120.00", "colleague");
		const batchId = await exportReports([hotel, colleagueHotel]);

		signIn("finance");
		const view = await exportActions.getTravelExpenseExports();
		expect(view.success && view.data.canSettle).toBe(true);

		const accounts = await offered(batchId);
		expect(accounts.map((account) => account.source.id).toSorted()).toEqual(
			[hotel, colleagueHotel].toSorted(),
		);
		const requestKey = randomUUID();
		const first = await markReimbursed(batchId, accounts, { requestKey });
		expect(outcomes(first).toSorted((left, right) => (left.id < right.id ? -1 : 1))).toEqual(
			[
				{ id: hotel, outcome: "reimbursed", replayed: false, amount: "500.00" },
				{ id: colleagueHotel, outcome: "reimbursed", replayed: false, amount: "120.00" },
			].toSorted((left, right) => (left.id < right.id ? -1 : 1)),
		);
		expect(await entries(hotel)).toEqual([
			{ amount: "500.00", reference: "SEPA-BATCH-7", batch: batchId },
		]);
		expect(await entries(colleagueHotel)).toEqual([
			{ amount: "120.00", reference: "SEPA-BATCH-7", batch: batchId },
		]);

		// The payment history names the batch for finance, not for the employee.
		signIn("finance");
		const financeView = await finance.getTravelExpenseSettlement(source(hotel));
		expect(financeView.success && financeView.data?.account.entries[0]?.exportBatch).toEqual({
			id: batchId,
			requestedAt: expect.any(String),
		});
		signIn("requester");
		const ownView = await finance.getTravelExpenseSettlement(source(hotel));
		expect(ownView.success && ownView.data?.account.entries[0]?.exportBatch).toBeNull();

		// Each new entry is audited with its batch.
		const { rows: audits } = await admin.query<{ entity_id: string; metadata: string }>(
			`select entity_id::text, metadata from audit_log
			 where organization_id = 't755-org' and action = 'travel_expense.reimbursement_recorded'`,
		);
		expect(audits).toHaveLength(2);
		expect(audits.every((audit) => JSON.parse(audit.metadata).exportBatchId === batchId)).toBe(
			true,
		);

		// A retried request replays what it recorded.
		const retried = await markReimbursed(batchId, accounts, { requestKey });
		expect(outcomes(retried).every((row) => row.outcome === "reimbursed" && row.replayed)).toBe(
			true,
		);
		// Marking the batch again offers nothing and records nothing.
		const again = await preview(batchId);
		expect(
			again.success &&
				again.data.status === "ready" &&
				again.data.accounts.map((entry) => entry.skip),
		).toEqual(["already_reimbursed", "already_reimbursed"]);
		const repeated = await markReimbursed(batchId, accounts);
		expect(outcomes(repeated).map((row) => row.outcome)).toEqual([
			"already_reimbursed",
			"already_reimbursed",
		]);
		expect(await entryCount()).toBe(2);
		const { rows: auditCount } = await admin.query<{ count: number }>(
			`select count(*)::int as count from audit_log
			 where organization_id = 't755-org' and action = 'travel_expense.reimbursement_recorded'`,
		);
		expect(auditCount[0]?.count).toBe(2);
	});

	it("counts adjustments against their original report's account, once per account", async () => {
		const hotel = await approvedHotel("500.00");
		const firstBatch = await exportReports([hotel]);
		expect(outcomes(await markReimbursed(firstBatch, await offered(firstBatch)))).toEqual([
			{ id: hotel, outcome: "reimbursed", replayed: false, amount: "500.00" },
		]);

		// Two later corrections of the same report and another report, exported together.
		const plus50 = await approvedAdjustment(hotel, "550.00");
		const plus30 = await approvedAdjustment(hotel, "580.00");
		const other = await approvedHotel("70.00");
		const secondBatch = await exportReports([plus50, plus30, other]);

		const result = await preview(secondBatch);
		expect(result.success && result.data.status).toBe("ready");
		if (!result.success || result.data.status !== "ready") return;
		// The adjustments are no accounts of their own: one account for the original.
		expect(
			result.data.accounts
				.map((entry) => ({
					id: entry.source.id,
					skip: entry.skip,
					balance: entry.account?.summary.currencies[0]?.balance,
				}))
				.toSorted((left, right) => (left.id < right.id ? -1 : 1)),
		).toEqual(
			[
				{ id: hotel, skip: null, balance: "80.00" },
				{ id: other, skip: null, balance: "70.00" },
			].toSorted((left, right) => (left.id < right.id ? -1 : 1)),
		);
		const marked = await markReimbursed(secondBatch, await offered(secondBatch));
		expect(outcomes(marked).toSorted((left, right) => (left.id < right.id ? -1 : 1))).toEqual(
			[
				{ id: hotel, outcome: "reimbursed", replayed: false, amount: "80.00" },
				{ id: other, outcome: "reimbursed", replayed: false, amount: "70.00" },
			].toSorted((left, right) => (left.id < right.id ? -1 : 1)),
		);
		expect(await entries(hotel)).toEqual([
			{ amount: "500.00", reference: "SEPA-BATCH-7", batch: firstBatch },
			{ amount: "80.00", reference: "SEPA-BATCH-7", batch: secondBatch },
		]);
		// Nothing is ever recorded against the adjustment reports themselves.
		expect(await entries(plus50)).toEqual([]);
		expect(await entries(plus30)).toEqual([]);

		// Marking the second batch again changes nothing.
		const repeated = await markReimbursed(secondBatch, [
			{ source: source(hotel), expectedBalance: { currency: "EUR", amount: "80.00" } },
		]);
		expect(outcomes(repeated).map((row) => row.outcome)).toEqual(["already_reimbursed"]);
		expect(await entryCount()).toBe(3);
	});

	it("refuses an unfinished batch and accounts that are not in the batch", async () => {
		const hotel = await approvedHotel("500.00");
		const outside = await approvedHotel("40.00");
		const queued = await exportReports([hotel], { complete: false });
		expect(await preview(queued)).toEqual({ success: true, data: { status: "not_completed" } });
		expect(
			await markReimbursed(queued, [
				{ source: source(hotel), expectedBalance: { currency: "EUR", amount: "500.00" } },
			]),
		).toEqual({ success: false, error: "Export not completed" });

		for (const job of harness.jobs.splice(0)) await processTravelExpenseExportBatch(db, job);
		const completed = await exportReports([outside]);
		// An account of another batch is refused as a whole: nothing is recorded.
		expect(
			await markReimbursed(completed, [
				{ source: source(outside), expectedBalance: { currency: "EUR", amount: "40.00" } },
				{ source: source(hotel), expectedBalance: { currency: "EUR", amount: "500.00" } },
			]),
		).toEqual({ success: false, error: "Invalid reimbursement" });
		expect(await entryCount()).toBe(0);
	});

	it("skips and lists the accounts outside the officer's reimbursement scope", async () => {
		const hotel = await approvedHotel("500.00");
		const colleagueHotel = await approvedHotel("120.00", "colleague");
		const batchId = await exportReports([hotel, colleagueHotel], { as: "officer" });
		// The officer's scope narrowed to the requester after they exported both.
		await admin.query(
			"update expense_officer_grant set scope = 'specific' where officer_employee_id = $1",
			[ids.officer],
		);
		await admin.query(
			`insert into expense_officer_employee (organization_id, grant_id, employee_id, created_by)
			 select organization_id, id, $2, 't755-finance' from expense_officer_grant where officer_employee_id = $1`,
			[ids.officer, ids.requester],
		);

		const result = await preview(batchId, "officer");
		expect(result.success && result.data.status).toBe("ready");
		if (!result.success || result.data.status !== "ready") return;
		const colleagueEntry = result.data.accounts.find((entry) => entry.source.id === colleagueHotel);
		// Listed by name and title only: the balance stays out of scope.
		expect(colleagueEntry).toEqual({
			source: source(colleagueHotel),
			employeeName: "colleague",
			title: expect.objectContaining({ kind: "standalone" }),
			account: null,
			skip: "out_of_scope",
		});
		const accounts = await offered(batchId, "officer");
		expect(accounts.map((account) => account.source.id)).toEqual([hotel]);

		// Sent anyway, the out-of-scope account is skipped by the service.
		const marked = await markReimbursed(
			batchId,
			[
				...accounts,
				{ source: source(colleagueHotel), expectedBalance: { currency: "EUR", amount: "120.00" } },
			],
			{ as: "officer" },
		);
		expect(outcomes(marked).map(({ id, outcome }) => ({ id, outcome }))).toEqual([
			{ id: hotel, outcome: "reimbursed" },
			{ id: colleagueHotel, outcome: "out_of_scope" },
		]);
		expect(await entries(colleagueHotel)).toEqual([]);
	});

	it("is only for users who record reimbursements and see the batch", async () => {
		const hotel = await approvedHotel("500.00");
		const batchId = await exportReports([hotel]);
		const accounts = await offered(batchId);

		// Exporting without recording reimbursements: the batch is visible, the action is not offered.
		signIn("exporter");
		const view = await exportActions.getTravelExpenseExports();
		expect(view.success && view.data.canSettle).toBe(false);
		expect(await preview(batchId, "exporter")).toEqual({ success: false, error: "Unauthorized" });
		expect(await markReimbursed(batchId, accounts, { as: "exporter" })).toEqual({
			success: false,
			error: "Unauthorized",
		});
		// No finance access, or another organization: the batch does not exist.
		expect(await preview(batchId, "colleague")).toEqual({ success: false, error: "Unauthorized" });
		expect(await preview(batchId, "foreigner")).toEqual({ success: false, error: "Not found" });
		expect(await markReimbursed(batchId, accounts, { as: "foreigner" })).toEqual({
			success: false,
			error: "Not found",
		});
		expect(await preview(randomUUID())).toEqual({ success: false, error: "Not found" });
		expect(await entryCount()).toBe(0);
	});
});
