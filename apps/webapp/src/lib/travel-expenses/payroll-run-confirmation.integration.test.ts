/**
 * #853: an expense officer confirms a payroll run as paid, which records the
 * reimbursements of the included reports in their officer scope.
 *
 * Reports are submitted, approved and adjusted through the real actions and
 * routes, and exported through the real payroll export service, against a
 * disposable PostgreSQL database; only the session, the queue and object
 * storage are replaced.
 */

import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t853-org",
	tus: new Map<string, Buffer>(),
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
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/queue", () => ({
	async addJob() {
		return { id: randomUUID() };
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t853-public",
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
	async uploadPrivateObject(_organizationId: string, key: string) {
		return { bucket: "t853-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject() {
		throw new Error("NoSuchKey");
	},
	async deletePrivateObject() {},
	async deletePrivateObjectVersions() {},
	async uploadExport() {},
	async getPresignedUrl(_organizationId: string, key: string) {
		return `https://exports.test/${key}`;
	},
}));

const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const adjustments = await import("@/app/[locale]/(app)/travel-expenses/adjustment-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const reopen = await import("@/app/[locale]/(app)/travel-expenses/report-reopen-actions");
const recovery = await import("@/app/[locale]/(app)/travel-expenses/finance-recovery-actions");
const officerGrants = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/expense-officer-actions"
);
const { discardPayrollRunAction } = await import(
	"@/app/[locale]/(app)/settings/payroll-export/actions"
);
const { createExportJob, processExportJob } = await import("@/lib/payroll-export/export-service");
const { countUnconfirmedPayrollRuns } = await import("./reimbursement-channel");
const { getPayrollRunReadiness } = await import("./payroll-run-readiness");
const { db } = await import("@/db");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { systemClock } = await import("@/lib/datetime/temporal-core");

const ORG = "t853-org";
const FOREIGN_ORG = "t853-foreign";
const ids = {
	requester: "e8530000-0000-4000-8000-000000000001",
	manager: "e8530000-0000-4000-8000-000000000002",
	finance: "e8530000-0000-4000-8000-000000000003",
	colleague: "e8530000-0000-4000-8000-000000000004",
	officer: "e8530000-0000-4000-8000-000000000005",
	scoped: "e8530000-0000-4000-8000-000000000006",
	clerk: "e8530000-0000-4000-8000-000000000007",
	foreigner: "e8530000-0000-4000-8000-000000000008",
} as const;
type Person = keyof typeof ids;
type Owner = "requester" | "colleague" | "officer";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

/** Logical dates relative to today in Berlin, so the reports approved now fall where intended. */
const today = systemClock.nowInstant().toZonedDateTimeISO("Europe/Berlin").toPlainDate();
const day = (offset: number) => today.add({ days: offset }).toString();
interface Period {
	start: string;
	end: string;
}
/** A period that covers today and ends in the future. */
const current: Period = { start: day(-20), end: day(20) };
/** Another period that covers today. */
const overlapping: Period = { start: day(-10), end: day(30) };

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, FOREIGN_ORG]);
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't853-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t853-%"]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ($1,'Expenses',$1,'Europe/Berlin',now()), ($2,'Foreign',$2,'UTC',now())`,
		[ORG, FOREIGN_ORG],
	);
	const people: Array<[Person, string, string, string, string | null]> = [
		["requester", ORG, "member", "employee", "P-REQ"],
		["manager", ORG, "member", "manager", null],
		["finance", ORG, "admin", "employee", null],
		["colleague", ORG, "member", "employee", "P-COL"],
		["officer", ORG, "member", "employee", "P-OFF"],
		["scoped", ORG, "member", "employee", null],
		["clerk", ORG, "member", "employee", null],
		["foreigner", FOREIGN_ORG, "owner", "admin", null],
	];
	for (const [name, organizationId, memberRole, role, employeeNumber] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t853-${name}`, name, `t853-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t853-member-${name}`, organizationId, `t853-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,employee_number,updated_at) values ($1,$2,$3,$4,$5,now())",
			[ids[name], `t853-${name}`, organizationId, role, employeeNumber],
		);
	}
	for (const employeeId of [ids.requester, ids.colleague, ids.officer]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't853-manager', now(), now())`,
			[employeeId, ids.manager],
		);
	}
	// An officer who records reimbursements for everyone.
	await admin.query(
		`insert into expense_officer_grant
		 (organization_id, officer_employee_id, scope, can_export, can_record_reimbursements, created_by)
		 values ($1, $2, 'all', false, true, 't853-finance')`,
		[ORG, ids.officer],
	);
	// The clerk has payroll access for everyone, but no expense officer grant.
	await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'all', 't853-finance', now())`,
		[ORG, ids.clerk],
	);
	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at) values
		 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now())
		 on conflict (id) do nothing`,
	);
	await admin.query(
		`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
		 values ($1, 'datev_lohn', $2::jsonb, 't853-finance', now())`,
		[
			ORG,
			JSON.stringify({
				mandantennummer: "12345",
				beraternummer: "1234567",
				personnelNumberType: "employeeNumber",
				includeZeroHours: false,
			}),
		],
	);
	await admin.query(
		`insert into payroll_expense_wage_type_mapping (organization_id, payroll_line_kind, datev_wage_type_code)
		 values ($1, 'receipt_accommodation', '9100')`,
		[ORG],
	);
	await admin.query(
		`insert into travel_expense_settings (organization_id, reimbursement_channel) values ($1, 'payroll_run')`,
		[ORG],
	);
	await admin.query(
		"insert into travel_expense_payroll_run_preview_control (organization_id, mode) values ($1, 'active')",
		[ORG],
	);
}

function signIn(name: Person) {
	harness.userId = `t853-${name}`;
	harness.organizationId = name === "foreigner" ? FOREIGN_ORG : ORG;
}

async function loadOwn(owner: Owner, reportId: string) {
	signIn(owner);
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	return report.data;
}

async function setHotel(owner: Owner, reportId: string, amount: string) {
	const item = (await loadOwn(owner, reportId)).items[0];
	if (!item) throw new Error("no item");
	const saved = await actions.saveReceiptItemDraftAction({
		reportId,
		itemId: item.id,
		expectedVersion: item.version,
		values: {
			expenseDate: day(-3),
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

async function submitAndApprove(owner: Owner, reportId: string) {
	const report = await loadOwn(owner, reportId);
	const submitted = await actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.trip?.version ?? null,
			items: report.items.map((entry) => ({
				id: entry.id,
				version: entry.version,
				receiptIds: entry.receipts.map((receipt) => receipt.id),
			})),
		},
	});
	expect(submitted).toEqual({ success: true, data: { status: "submitted" } });
	const { rows } = await admin.query<{ id: string }>(
		"select id from approval_request where entity_type = 'travel_expense_report' and entity_id = $1 and status = 'pending'",
		[reportId],
	);
	signIn("manager");
	const approved = await approveRoute(
		new Request(`http://localhost/api/approvals/inbox/${rows[0]?.id}/approve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: rows[0]?.id ?? "" }) },
	);
	expect(approved.status).toBe(200);
}

/** An approved standalone hotel receipt of EUR `amount`, paid by `owner`; approved now. */
async function approvedHotel(amount: string, owner: Owner = "requester") {
	signIn(owner);
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	await setHotel(owner, reportId, amount);
	const item = (await loadOwn(owner, reportId)).items[0];
	const tusFileKey = createOwnedTusFileKey(`t853-${owner}`);
	harness.tus.set(tusFileKey, pdfBytes);
	const uploaded = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId: item?.id, fileName: "invoice.pdf" }),
		}) as unknown as NextRequest,
	);
	if (uploaded.status !== 200) throw new Error(`upload ${uploaded.status}`);
	await submitAndApprove(owner, reportId);
	return reportId;
}

/** Corrects the requester's hotel to EUR `amount` through an approved adjustment. */
async function approvedAdjustment(originalReportId: string, amount: string) {
	signIn("requester");
	const created = await adjustments.createTravelExpenseAdjustmentAction({
		originalReportId,
		reason: "The hotel corrected its invoice",
		idempotencyKey: randomUUID(),
	});
	if (!created.success || created.data.status !== "created") {
		throw new Error(`adjustment ${JSON.stringify(created)}`);
	}
	await setHotel("requester", created.data.reportId, amount);
	await submitAndApprove("requester", created.data.reportId);
	return created.data.reportId;
}

/** A DATEV Lohn payroll file export of the period, as the settings page starts it. */
async function exportPayroll(period: Period) {
	const { jobId } = await createExportJob({
		organizationId: ORG,
		formatId: "datev_lohn",
		requestedById: ids.finance,
		filters: {
			dateRange: {
				start: DateTime.fromISO(period.start, { zone: "utc" }),
				end: DateTime.fromISO(period.end, { zone: "utc" }),
			},
		},
	});
	const { result } = await processExportJob({ jobId, organizationId: ORG });
	return { jobId, content: String(result?.content ?? "") };
}

async function confirm(person: Person, jobId: string, payday?: string) {
	signIn(person);
	return finance.confirmPayrollRunAction({ jobId, payday: payday ?? null });
}

/** Each confirmation row as the result dialog shows it. */
async function confirmed(person: Person, jobId: string, payday?: string) {
	const result = await confirm(person, jobId, payday);
	if (!result.success || result.data.status !== "processed") {
		throw new Error(`confirm ${JSON.stringify(result)}`);
	}
	return result.data.rows.map(({ reportId, outcome, amount, overpaid, remaining }) => ({
		reportId,
		outcome,
		amount,
		overpaid,
		remaining,
	}));
}

async function entries(reportId: string) {
	const { rows } = await admin.query(
		`select kind, amount, occurred_on::text as occurred_on, reference, payroll_run_id::text as run,
		        recorded_by_user_id as recorded_by
		 from travel_expense_settlement_entry where report_id = $1 order by recorded_at, id`,
		[reportId],
	);
	return rows;
}

async function inclusions(reportId: string) {
	const { rows } = await admin.query(
		`select state, payroll_export_job_id::text as job, ended_by_user_id as ended_by
		 from travel_expense_payroll_run_inclusion where report_id = $1 order by included_at, id`,
		[reportId],
	);
	return rows;
}

async function notifications(userId: string) {
	const { rows } = await admin.query<{ type: string; message: string }>(
		`select type::text, message from notification
		 where organization_id = $1 and user_id = $2 and type::text like 'travel_expense_%reimbursed'
		 order by created_at, id`,
		[ORG, userId],
	);
	return rows;
}

async function settlementAs(person: Person, reportId: string) {
	signIn(person);
	const result = await finance.getTravelExpenseSettlement({ type: "report", id: reportId });
	if (!result.success || !result.data) throw new Error(`settlement ${JSON.stringify(result)}`);
	return result.data;
}

const datevLine = (personnelNumber: string, amount: string, period: Period) =>
	`"${personnelNumber}";"9100";${amount};"${period.end}";"Reisekostenerstattung in EUR"`;

describe("confirming a payroll run as paid (#853)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	beforeEach(async () => {
		await seed();
		harness.tus.clear();
	});
	afterAll(cleanup);

	it("records one reimbursement per included report naming the run, and nothing new when repeated", async () => {
		const own = await approvedHotel("100.00");
		const colleagues = await approvedHotel("8.05", "colleague");
		const run = await exportPayroll(current);

		const rows = await confirmed("officer", run.jobId);

		expect(rows).toEqual(
			expect.arrayContaining([
				{ reportId: own, outcome: "confirmed", amount: "100.00", overpaid: null, remaining: null },
				{
					reportId: colleagues,
					outcome: "confirmed",
					amount: "8.05",
					overpaid: null,
					remaining: null,
				},
			]),
		);
		// The run's period ends in the future: the payday defaults to today.
		expect(await entries(own)).toEqual([
			{
				kind: "reimbursement",
				amount: "100.00",
				occurred_on: today.toString(),
				reference: `Payroll run ${current.start} – ${current.end} (DATEV Lohn & Gehalt)`,
				run: run.jobId,
				recorded_by: "t853-officer",
			},
		]);
		expect(await inclusions(own)).toEqual([
			{ state: "confirmed", job: run.jobId, ended_by: "t853-officer" },
		]);
		expect(await countUnconfirmedPayrollRuns(ORG)).toBe(0);

		// Again: nothing is left to confirm and nothing new is recorded.
		expect(await confirmed("officer", run.jobId)).toEqual([]);
		expect(await entries(own)).toHaveLength(1);
		expect(await entries(colleagues)).toHaveLength(1);

		// The employee's notification and history name the payroll run.
		expect(await notifications("t853-requester")).toEqual([
			{
				type: "travel_expense_reimbursed",
				message: `Your travel expense has been fully reimbursed with payroll ${current.start} – ${current.end}: 100.00 EUR.`,
			},
		]);
		const ownView = await settlementAs("requester", own);
		expect(ownView.account.entries).toEqual([
			expect.objectContaining({
				amount: "100.00",
				payrollRun: { id: run.jobId, periodStart: current.start, periodEnd: current.end },
			}),
		]);
	});

	it("confirms partially: never the confirmer's own report or one outside their scope, which stay included", async () => {
		const requesters = await approvedHotel("100.00");
		const colleagues = await approvedHotel("8.05", "colleague");
		const officers = await approvedHotel("30.00", "officer");
		const run = await exportPayroll(current);
		// The scoped officer records reimbursements for the requester only.
		signIn("finance");
		const granted = await officerGrants.saveExpenseOfficerGrantAction({
			officerEmployeeId: ids.scoped,
			scope: "specific",
			teamIds: [],
			employeeIds: [ids.requester],
			canExport: false,
			canRecordReimbursements: true,
		});
		if (!granted.success) throw new Error(granted.error);

		signIn("scoped");
		const listed = await finance.getPayrollRunsToConfirmAction();
		const scoped = await confirmed("scoped", run.jobId, day(-1));

		expect(listed).toEqual({
			success: true,
			data: [
				expect.objectContaining({
					jobId: run.jobId,
					formatName: "DATEV Lohn & Gehalt",
					includedReports: 3,
					confirmableReports: 1,
					confirmableAmount: "100.00",
					defaultPayday: today.toString(),
				}),
			],
		});
		expect(scoped).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ reportId: requesters, outcome: "confirmed", amount: "100.00" }),
				expect.objectContaining({ reportId: colleagues, outcome: "out_of_scope", amount: null }),
				expect.objectContaining({ reportId: officers, outcome: "out_of_scope", amount: null }),
			]),
		);
		expect(await entries(requesters)).toEqual([
			expect.objectContaining({ occurred_on: day(-1), run: run.jobId }),
		]);
		// A confirmed run is final: it can no longer be discarded as a whole.
		signIn("finance");
		expect(await discardPayrollRunAction(ORG, run.jobId)).toEqual({
			success: true,
			data: { status: "confirmed" },
		});

		expect(await confirmed("officer", run.jobId)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ reportId: colleagues, outcome: "confirmed", amount: "8.05" }),
				expect.objectContaining({ reportId: officers, outcome: "own_expense", amount: null }),
			]),
		);
		expect(await inclusions(officers)).toEqual([expect.objectContaining({ state: "included" })]);
		expect(await countUnconfirmedPayrollRuns(ORG)).toBe(1);

		// An admin confirms the officer's own report; then the whole run is confirmed.
		expect(await confirmed("finance", run.jobId)).toEqual([
			expect.objectContaining({ reportId: officers, outcome: "confirmed", amount: "30.00" }),
		]);
		expect(await countUnconfirmedPayrollRuns(ORG)).toBe(0);
		expect(await entries(officers)).toEqual([
			expect.objectContaining({ amount: "30.00", recorded_by: "t853-finance", run: run.jobId }),
		]);
	});

	it("keeps a partly confirmed run's remaining reports when its period is exported again", async () => {
		const requesters = await approvedHotel("100.00");
		const officers = await approvedHotel("30.00", "officer");
		const run = await exportPayroll(current);
		// The officer's own report stays included for someone else.
		await confirmed("officer", run.jobId);

		const again = await exportPayroll(current);

		// Payroll paid the first file: the second never carries the officer's report too.
		expect(again.content).not.toContain(datevLine("P-OFF", "30.00", current));
		expect(await inclusions(officers)).toEqual([
			expect.objectContaining({ state: "included", job: run.jobId }),
		]);
		// Readiness agrees with the export: the first run holds it.
		expect(
			await getPayrollRunReadiness(db, {
				organizationId: ORG,
				formatId: "datev_lohn",
				period: { startDate: current.start, endDate: current.end },
				employeeIds: [ids.requester, ids.officer],
			}),
		).toEqual({
			applies: true,
			entries: [
				expect.objectContaining({
					source: { type: "report", id: officers },
					skip: {
						reason: "included_in_other_run",
						run: expect.objectContaining({ jobId: run.jobId, partlyConfirmed: true }),
					},
				}),
			],
		});
		// It is confirmed with the run that carried it.
		expect(await confirmed("finance", run.jobId)).toEqual([
			expect.objectContaining({ reportId: officers, outcome: "confirmed", amount: "30.00" }),
		]);
		expect(await entries(requesters)).toHaveLength(1);
	});

	it("closes an inclusion that carries nothing without recording money", async () => {
		const reportId = await approvedHotel("100.00");
		const run = await exportPayroll(current);
		// A run never takes a report it carries nothing for; should one hold such a report, it is no dead end.
		await admin.query(
			"update travel_expense_payroll_run_inclusion set lines = '[]'::jsonb where report_id = $1",
			[reportId],
		);

		expect(await confirmed("officer", run.jobId)).toEqual([
			{ reportId, outcome: "confirmed", amount: "0.00", overpaid: null, remaining: "100.00" },
		]);
		expect(await entries(reportId)).toEqual([]);
		expect(await inclusions(reportId)).toEqual([
			{ state: "confirmed", job: run.jobId, ended_by: "t853-officer" },
		]);
		expect(await notifications("t853-requester")).toEqual([]);
	});

	it("records what payroll paid after an adjustment lowered it: the overpayment shows and is recovered by hand", async () => {
		const reportId = await approvedHotel("100.00");
		const run = await exportPayroll(current);
		// The run's file carries it like an export: correcting it needs an adjustment, not a reopen.
		signIn("manager");
		expect(await reopen.getTravelExpenseReportReopenState(reportId)).toEqual({
			success: true,
			data: expect.objectContaining({ status: "adjustment_required" }),
		});
		await approvedAdjustment(reportId, "70.00");

		const rows = await confirmed("officer", run.jobId);

		expect(rows).toEqual([
			{
				reportId,
				outcome: "overpaid_by_payroll",
				amount: "100.00",
				overpaid: "30.00",
				remaining: null,
			},
		]);
		expect(await entries(reportId)).toEqual([
			expect.objectContaining({ amount: "100.00", run: run.jobId }),
		]);
		// The balance goes negative: the existing overpaid state, never clamped.
		const view = await settlementAs("officer", reportId);
		expect(view.account.summary).toEqual(
			expect.objectContaining({
				state: "overpaid",
				currencies: [expect.objectContaining({ balance: "-30.00", state: "overpaid" })],
			}),
		);
		// No recovery is recorded automatically; an officer records it by hand.
		signIn("officer");
		const recovered = await recovery.recordTravelExpenseRecoveryAction({
			source: { type: "report", id: reportId },
			idempotencyKey: randomUUID(),
			amount: "30.00",
			occurredOn: today.toString(),
			reference: "SEPA-BACK-1",
			expectedBalance: { currency: "EUR", amount: "-30.00" },
		});
		expect(recovered).toEqual({
			success: true,
			data: expect.objectContaining({ status: "recorded" }),
		});
		expect((await settlementAs("officer", reportId)).account.summary.state).toBe("settled");
	});

	it("stays coherent when a later adjustment raises what an overpaid run paid: the next run carries the difference once", async () => {
		const reportId = await approvedHotel("100.00");
		const first = await exportPayroll(current);
		await approvedAdjustment(reportId, "70.00");
		await confirmed("officer", first.jobId);
		// Paid 100.00 on payroll; now corrected up to 130.00: 30.00 is owed, not 60.00.
		await approvedAdjustment(reportId, "130.00");
		expect((await settlementAs("officer", reportId)).account.summary.currencies[0]?.balance).toBe(
			"30.00",
		);

		const next = await exportPayroll(overlapping);

		expect(next.content).toContain(datevLine("P-REQ", "30.00", overlapping));
		expect(await confirmed("officer", next.jobId)).toEqual([
			{ reportId, outcome: "confirmed", amount: "30.00", overpaid: null, remaining: null },
		]);
		expect((await settlementAs("officer", reportId)).account.summary.state).toBe("settled");
	});

	it("leaves what an adjustment added for the next run, which carries only the difference", async () => {
		const reportId = await approvedHotel("100.00");
		const first = await exportPayroll(current);
		await approvedAdjustment(reportId, "130.00");

		const rows = await confirmed("officer", first.jobId);
		const next = await exportPayroll(overlapping);

		expect(rows).toEqual([
			{ reportId, outcome: "confirmed", amount: "100.00", overpaid: null, remaining: "30.00" },
		]);
		// Partly paid by payroll: the next run takes it, with only what earlier runs did not carry.
		expect(next.content).toContain(datevLine("P-REQ", "30.00", overlapping));
		expect(await confirmed("officer", next.jobId)).toEqual([
			{ reportId, outcome: "confirmed", amount: "30.00", overpaid: null, remaining: null },
		]);
		expect(await entries(reportId)).toEqual([
			expect.objectContaining({ amount: "100.00", run: first.jobId }),
			expect.objectContaining({ amount: "30.00", run: next.jobId }),
		]);
		expect(await notifications("t853-requester")).toEqual([
			expect.objectContaining({ type: "travel_expense_partially_reimbursed" }),
			expect.objectContaining({ type: "travel_expense_reimbursed" }),
		]);
	});

	it("never takes a report again that was also reimbursed by bank transfer", async () => {
		const reportId = await approvedHotel("100.00");
		const first = await exportPayroll(current);
		await approvedAdjustment(reportId, "130.00");
		await confirmed("officer", first.jobId);
		signIn("officer");
		const paid = await finance.recordTravelExpenseReimbursementAction({
			source: { type: "report", id: reportId },
			idempotencyKey: randomUUID(),
			amount: "10.00",
			occurredOn: today.toString(),
			reference: "SEPA-1",
			expectedBalance: { currency: "EUR", amount: "30.00" },
		});

		const next = await exportPayroll(overlapping);

		expect(paid).toEqual(expect.objectContaining({ success: true }));
		expect(next.content).not.toContain("Reisekostenerstattung");
		expect(await inclusions(reportId)).toEqual([
			expect.objectContaining({ state: "confirmed", job: first.jobId }),
		]);
	});

	it("needs reimbursement scope, not payroll access, and stays inside the organization", async () => {
		const reportId = await approvedHotel("100.00");
		const run = await exportPayroll(current);

		signIn("clerk");
		const listed = await finance.getPayrollRunsToConfirmAction();
		const clerk = await confirm("clerk", run.jobId);
		const foreigner = await confirm("foreigner", run.jobId);
		const future = await confirm("officer", run.jobId, day(5));

		expect(listed).toEqual({ success: true, data: [] });
		expect(clerk).toEqual({ success: false, error: "Unauthorized" });
		expect(foreigner).toEqual({ success: false, error: "Not found" });
		expect(future).toEqual({
			success: true,
			data: { status: "invalid", errors: [{ field: "occurredOn", code: "future" }] },
		});
		expect(await entries(reportId)).toEqual([]);
		expect(await inclusions(reportId)).toEqual([expect.objectContaining({ state: "included" })]);
	});
});
