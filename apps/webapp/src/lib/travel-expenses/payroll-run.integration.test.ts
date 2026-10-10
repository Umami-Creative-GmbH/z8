/**
 * #852: payroll file exports carry expense lines and include the reports they
 * carry in the payroll run.
 *
 * Reports are submitted and approved through the real actions and routes, and
 * exported through the real export service, against a disposable PostgreSQL
 * database; only the session, notifications, the queue and object storage are
 * replaced.
 */

import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t852-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	jobs: [] as Array<{ organizationId: string; batchId: string; attempt: number }>,
	failNextUpload: false,
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
	S3_PUBLIC_BUCKET: "t852-public",
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
		return { bucket: "t852-private", versionId: `v-${key.length}` };
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
	async uploadExport() {
		if (harness.failNextUpload) {
			harness.failNextUpload = false;
			throw new Error("Object store unavailable");
		}
	},
	async getPresignedUrl(_organizationId: string, key: string) {
		return `https://exports.test/${key}`;
	},
}));

const { db } = await import("@/db");
const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const exportActions = await import("@/app/[locale]/(app)/travel-expenses/finance-export-actions");
const payrollActions = await import("@/app/[locale]/(app)/payroll/actions");
const { processTravelExpenseExportBatch } = await import("@/lib/travel-expenses/export-processor");
const { createExportJob, processExportJob } = await import("@/lib/payroll-export/export-service");
const { discardPayrollRun } = await import("./payroll-run");
const { countUnconfirmedPayrollRuns } = await import("./reimbursement-channel");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { systemClock } = await import("@/lib/datetime/temporal-core");

const ORG = "t852-org";
const FOREIGN_ORG = "t852-foreign";
const ids = {
	requester: "e8520000-0000-4000-8000-000000000001",
	manager: "e8520000-0000-4000-8000-000000000002",
	finance: "e8520000-0000-4000-8000-000000000003",
	colleague: "e8520000-0000-4000-8000-000000000004",
	officer: "e8520000-0000-4000-8000-000000000005",
	clerk: "e8520000-0000-4000-8000-000000000006",
	foreigner: "e8520000-0000-4000-8000-000000000007",
} as const;
type Person = keyof typeof ids;
type Owner = "requester" | "colleague";

const CONFIGS = {
	datev_lohn: {
		mandantennummer: "12345",
		beraternummer: "1234567",
		personnelNumberType: "employeeNumber",
		includeZeroHours: false,
	},
	lexware_lohn: {
		personnelNumberType: "employeeNumber",
		includeZeroHours: false,
		includeStunden: true,
		includeStundensatz: false,
	},
	sage_lohn: { personnelNumberType: "employeeNumber", outputFormat: "sage_native" },
	successfactors_csv: { employeeMatchStrategy: "userId" },
} as const;
type Format = keyof typeof CONFIGS;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

/** Logical dates relative to today in Berlin, so the reports approved now fall where intended. */
const today = systemClock.nowInstant().toZonedDateTimeISO("Europe/Berlin").toPlainDate();
const day = (offset: number) => today.add({ days: offset }).toString();
interface Period {
	start: string;
	end: string;
}
/** The period every report approved today falls in. */
const current: Period = { start: day(-20), end: day(20) };
/** Another period that also covers today. */
const overlapping: Period = { start: day(-10), end: day(30) };
/** A period that ended yesterday, before today's approvals. */
const past: Period = { start: day(-40), end: day(-1) };

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, FOREIGN_ORG]);
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't852-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t852-%"]);
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
		["officer", ORG, "member", "employee", null],
		["clerk", ORG, "member", "employee", null],
		["foreigner", FOREIGN_ORG, "owner", "admin", null],
	];
	for (const [name, organizationId, memberRole, role, employeeNumber] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t852-${name}`, name, `t852-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t852-member-${name}`, organizationId, `t852-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,employee_number,updated_at) values ($1,$2,$3,$4,$5,now())",
			[ids[name], `t852-${name}`, organizationId, role, employeeNumber],
		);
	}
	for (const employeeId of [ids.requester, ids.colleague]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't852-manager', now(), now())`,
			[employeeId, ids.manager],
		);
	}
	await admin.query(
		`insert into expense_officer_grant
		 (organization_id, officer_employee_id, scope, can_export, can_record_reimbursements, created_by)
		 values ($1, $2, 'all', true, true, 't852-finance')`,
		[ORG, ids.officer],
	);
	// The clerk's payroll scope is the requester only.
	const { rows: grants } = await admin.query<{ id: string }>(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'specific', 't852-finance', now()) returning id`,
		[ORG, ids.clerk],
	);
	await admin.query(
		`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
		 values ($1, $2, $3, 't852-finance')`,
		[ORG, grants[0]?.id, ids.requester],
	);
	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at) values
		 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()),
		 ('lexware_lohn', 'Lexware lohn+gehalt', '2024.1', now()),
		 ('sage_lohn', 'Sage Lohn', '2024.1', now()),
		 ('successfactors_csv', 'SAP SuccessFactors (CSV)', '1.0.0', now())
		 on conflict (id) do nothing`,
	);
	for (const [formatId, config] of Object.entries(CONFIGS)) {
		await admin.query(
			`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
			 values ($1, $2, $3::jsonb, 't852-finance', now())`,
			[ORG, formatId, JSON.stringify(config)],
		);
	}
	await admin.query(
		`insert into payroll_expense_wage_type_mapping
		 (organization_id, payroll_line_kind, datev_wage_type_code, lexware_wage_type_code, sage_wage_type_code, successfactors_wage_type_code)
		 values ($1, 'receipt_accommodation', '9100', 'LX9100', 'SG9100', 'SF9100')`,
		[ORG],
	);
	await setChannel("payroll_run");
	await admin.query(
		"insert into travel_expense_payroll_run_preview_control (organization_id, mode) values ($1, 'active')",
		[ORG],
	);
}

async function setChannel(channel: "bank_transfer" | "payroll_run") {
	await admin.query(
		`insert into travel_expense_settings (organization_id, reimbursement_channel) values ($1, $2)
		 on conflict (organization_id) do update set reimbursement_channel = excluded.reimbursement_channel`,
		[ORG, channel],
	);
}

function signIn(name: Person) {
	harness.userId = `t852-${name}`;
	harness.organizationId = name === "foreigner" ? FOREIGN_ORG : ORG;
}

async function loadOwn(owner: Owner, reportId: string) {
	signIn(owner);
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	return report.data;
}

/** An approved standalone hotel receipt of EUR `amount`, paid by `owner`; approved now. */
async function approvedHotel(amount: string, owner: Owner = "requester") {
	signIn(owner);
	const created = await actions.createStandaloneReceiptReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
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
	const tusFileKey = createOwnedTusFileKey(`t852-${owner}`);
	harness.tus.set(tusFileKey, pdfBytes);
	const uploaded = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId: item.id, fileName: "invoice.pdf" }),
		}) as unknown as NextRequest,
	);
	if (uploaded.status !== 200) throw new Error(`upload ${uploaded.status}`);
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
	return reportId;
}

/** A payroll file export of the period, as the settings page starts it. */
async function exportPayroll(
	formatId: Format,
	period: Period,
	options: { employeeIds?: string[] } = {},
) {
	const { jobId, isAsync } = await createExportJob({
		organizationId: ORG,
		formatId,
		requestedById: ids.finance,
		filters: {
			dateRange: {
				start: DateTime.fromISO(period.start, { zone: "utc" }),
				end: DateTime.fromISO(period.end, { zone: "utc" }),
			},
			employeeIds: options.employeeIds,
		},
	});
	expect(isAsync).toBe(false);
	const { result } = await processExportJob({ jobId, organizationId: ORG });
	return { jobId, content: String(result?.content ?? "") };
}

async function inclusions(reportId: string) {
	const { rows } = await admin.query(
		`select state, payroll_export_job_id::text as job, superseded_by_job_id::text as superseded_by,
		        ended_by_user_id as ended_by, lines
		 from travel_expense_payroll_run_inclusion where report_id = $1 order by included_at, id`,
		[reportId],
	);
	return rows;
}

async function auditActions(action: string) {
	const { rows } = await admin.query(
		"select entity_id::text as entity, performed_by, changes from audit_log where organization_id = $1 and action = $2",
		[ORG, action],
	);
	return rows;
}

const source = (id: string) => ({ type: "report" as const, id });

async function settlementAs(person: Person, reportId: string) {
	signIn(person);
	const result = await finance.getTravelExpenseSettlement(source(reportId));
	if (!result.success || !result.data) throw new Error(`settlement ${JSON.stringify(result)}`);
	return result.data;
}

/** Records the full balance by bank transfer, as the single reimbursement form does. */
async function reimburse(reportId: string, amount: string, as: Person = "officer") {
	signIn(as);
	return finance.recordTravelExpenseReimbursementAction({
		source: source(reportId),
		idempotencyKey: randomUUID(),
		amount,
		occurredOn: today.toString(),
		reference: "SEPA-1",
		expectedBalance: { currency: "EUR", amount },
	});
}

const datevLine = (personnelNumber: string, code: string, amount: string, period: Period) =>
	`"${personnelNumber}";"${code}";${amount};"${period.end}";"Reisekostenerstattung in EUR"`;

describe("payroll file exports carry expense lines (#852)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
		harness.jobs.length = 0;
	});
	afterAll(cleanup);

	it("carries the mapped money lines per employee in every file format and moves the reports between re-exports", async () => {
		const first = await approvedHotel("100.00");
		const second = await approvedHotel("20.50");
		const colleagues = await approvedHotel("8.05", "colleague");

		const datev = await exportPayroll("datev_lohn", current);
		expect(datev.content).toContain(datevLine("P-REQ", "9100", "120.50", current));
		expect(datev.content).toContain(datevLine("P-COL", "9100", "8.05", current));
		expect(await inclusions(first)).toEqual([
			expect.objectContaining({
				state: "included",
				job: datev.jobId,
				lines: [
					{
						kind: "receipt_accommodation",
						amount: "100.00",
						currency: "EUR",
						wageTypeCode: "9100",
					},
				],
			}),
		]);

		// Each format re-exports the same period: it takes the reports over and writes its own codes.
		const lexware = await exportPayroll("lexware_lohn", current);
		expect(lexware.content).toContain(";P-REQ;LX9100;120,50;");
		expect(lexware.content).toContain(";P-COL;LX9100;8,05;");
		const sage = await exportPayroll("sage_lohn", current);
		expect(sage.content).toContain(
			`"P-REQ";"SG9100";"120,50";"${current.end}";"Reisekostenerstattung in EUR"`,
		);
		const successFactors = await exportPayroll("successfactors_csv", current);
		expect(successFactors.content).toContain(
			`"P-REQ";"${current.end}";"SF9100";"";"Expense reimbursement";"120.50";"EUR"`,
		);
		expect(successFactors.content).toContain(
			`"P-COL";"${current.end}";"SF9100";"";"Expense reimbursement";"8.05";"EUR"`,
		);

		for (const reportId of [first, second, colleagues]) {
			const states = await inclusions(reportId);
			expect(states.map(({ state, superseded_by }) => ({ state, superseded_by }))).toEqual([
				{ state: "superseded", superseded_by: lexware.jobId },
				{ state: "superseded", superseded_by: sage.jobId },
				{ state: "superseded", superseded_by: successFactors.jobId },
				{ state: "included", superseded_by: null },
			]);
		}
		expect(await countUnconfirmedPayrollRuns(ORG)).toBe(1);
	});

	it("carries no expense lines and includes nothing with the bank transfer channel or a closed gate", async () => {
		const reportId = await approvedHotel("100.00");

		await setChannel("bank_transfer");
		const bankTransfer = await exportPayroll("datev_lohn", current);
		await setChannel("payroll_run");
		await admin.query(
			"update travel_expense_payroll_run_preview_control set mode = 'inactive' where organization_id = $1",
			[ORG],
		);
		const gateClosed = await exportPayroll("lexware_lohn", current);

		expect(bankTransfer.content).not.toContain("Reisekostenerstattung");
		expect(gateClosed.content).not.toContain("LX9100");
		expect(await inclusions(reportId)).toEqual([]);
		expect(await countUnconfirmedPayrollRuns(ORG)).toBe(0);
	});

	it("never includes a report in two unconfirmed runs: another period skips it", async () => {
		const reportId = await approvedHotel("100.00");
		const run = await exportPayroll("datev_lohn", current);

		const other = await exportPayroll("datev_lohn", overlapping);

		expect(other.content).not.toContain("Reisekostenerstattung");
		expect(await inclusions(reportId)).toEqual([
			expect.objectContaining({ state: "included", job: run.jobId }),
		]);
		await expect(
			admin.query(
				`insert into travel_expense_payroll_run_inclusion
				 (organization_id, payroll_export_job_id, report_id, employee_id, basis_revision_id, lines)
				 values ($1, $2, $3, $4, gen_random_uuid(), '[]'::jsonb)`,
				[ORG, other.jobId, reportId, ids.requester],
			),
		).rejects.toThrow(/travelExpensePayrollRunInclusion_org_report_included_idx/);
	});

	it("holds nothing when the file is never delivered, and the earlier run keeps its reports", async () => {
		const reportId = await approvedHotel("100.00");
		const earlier = await exportPayroll("datev_lohn", current);
		// An asynchronous delivery whose upload fails.
		const { LexwareLohnFormatter } = await import(
			"@/lib/payroll-export/formatters/lexware-lohn-formatter"
		);
		vi.spyOn(LexwareLohnFormatter.prototype, "getSyncThreshold").mockReturnValue(-1);
		const { jobId, isAsync } = await createExportJob({
			organizationId: ORG,
			formatId: "lexware_lohn",
			requestedById: ids.finance,
			filters: {
				dateRange: {
					start: DateTime.fromISO(current.start, { zone: "utc" }),
					end: DateTime.fromISO(current.end, { zone: "utc" }),
				},
			},
		});
		harness.failNextUpload = true;

		await expect(processExportJob({ jobId, organizationId: ORG })).rejects.toThrow(
			"Object store unavailable",
		);

		expect(isAsync).toBe(true);
		const { rows } = await admin.query("select status from payroll_export_job where id = $1", [
			jobId,
		]);
		expect(rows[0]?.status).toBe("failed");
		expect(await inclusions(reportId)).toEqual([
			expect.objectContaining({ state: "included", job: earlier.jobId }),
		]);
		vi.restoreAllMocks();
	});

	it("takes only reports approved by the end of the period, with every kind mapped", async () => {
		const reportId = await approvedHotel("100.00");

		const before = await exportPayroll("datev_lohn", past);
		await admin.query(
			"update payroll_expense_wage_type_mapping set sage_wage_type_code = null where organization_id = $1",
			[ORG],
		);
		const unmapped = await exportPayroll("sage_lohn", current);

		expect(before.content).not.toContain("Reisekostenerstattung");
		expect(unmapped.content).not.toContain("Reisekostenerstattung");
		expect(await inclusions(reportId)).toEqual([]);
	});

	it("exports amounts only for the employees in the payroll access holder's scope", async () => {
		const own = await approvedHotel("100.00");
		const colleagues = await approvedHotel("8.05", "colleague");

		signIn("clerk");
		const exported = await payrollActions.startScopedPayrollExportAction({
			startDate: current.start,
			endDate: current.end,
			label: "Current",
			formatId: "datev_lohn",
		});

		if (!exported.success) throw new Error(exported.error);
		expect(exported.data.fileContent).toContain(datevLine("P-REQ", "9100", "100.00", current));
		expect(exported.data.fileContent).not.toContain("P-COL");
		expect(await inclusions(own)).toEqual([expect.objectContaining({ state: "included" })]);
		expect(await inclusions(colleagues)).toEqual([]);
	});

	it("discards a run, freeing its reports for the next export or a bank transfer", async () => {
		const first = await approvedHotel("100.00");
		const second = await approvedHotel("20.50");
		const run = await exportPayroll("datev_lohn", current);

		signIn("finance");
		const { discardPayrollRunAction } = await import(
			"@/app/[locale]/(app)/settings/payroll-export/actions"
		);
		const discarded = await discardPayrollRunAction(ORG, run.jobId);

		expect(discarded).toEqual({
			success: true,
			data: { status: "discarded", reportIds: expect.arrayContaining([first, second]) },
		});
		expect(await inclusions(first)).toEqual([
			expect.objectContaining({ state: "discarded", ended_by: "t852-finance" }),
		]);
		expect(await auditActions("payroll_export.payroll_run_discarded")).toEqual([
			expect.objectContaining({ entity: run.jobId, performed_by: "t852-finance" }),
		]);
		expect(await countUnconfirmedPayrollRuns(ORG)).toBe(0);
		// The next export of another period takes one; the other is paid by bank transfer.
		expect((await reimburse(second, "20.50")).success).toBe(true);
		const next = await exportPayroll("datev_lohn", overlapping);
		expect(next.content).toContain(datevLine("P-REQ", "9100", "100.00", overlapping));
		// Discarding again finds nothing to discard.
		signIn("finance");
		expect(await discardPayrollRunAction(ORG, run.jobId)).toEqual({
			success: true,
			data: { status: "not_found" },
		});
	});

	it("lets a payroll access holder discard only runs within their payroll scope", async () => {
		await approvedHotel("100.00");
		const own = await exportPayroll("datev_lohn", current, { employeeIds: [ids.requester] });
		await approvedHotel("8.05", "colleague");
		const wide = await exportPayroll("lexware_lohn", overlapping);

		signIn("clerk");
		const listed = await payrollActions.getScopedPayrollRunsAction();
		const refused = await payrollActions.discardScopedPayrollRunAction(wide.jobId);
		const discarded = await payrollActions.discardScopedPayrollRunAction(own.jobId);

		if (!listed.success) throw new Error(listed.error);
		expect(listed.data.map((run) => run.jobId)).toEqual([own.jobId]);
		expect(refused).toEqual({ success: true, data: { status: "out_of_scope" } });
		expect(discarded).toEqual({
			success: true,
			data: { status: "discarded", reportIds: [expect.any(String)] },
		});
	});

	it("removes one report from a run, audited, so it can be reimbursed or exported again", async () => {
		const reportId = await approvedHotel("100.00");
		const other = await approvedHotel("20.50");
		const run = await exportPayroll("datev_lohn", current);

		signIn("officer");
		const removed = await finance.removeTravelExpenseFromPayrollRunAction({ reportId });

		expect(removed).toEqual({ success: true, data: { status: "removed", jobId: run.jobId } });
		expect(await inclusions(reportId)).toEqual([
			expect.objectContaining({ state: "removed", ended_by: "t852-officer" }),
		]);
		expect(await inclusions(other)).toEqual([expect.objectContaining({ state: "included" })]);
		expect(await auditActions("travel_expense.payroll_run_report_removed")).toEqual([
			expect.objectContaining({
				entity: reportId,
				performed_by: "t852-officer",
				changes: JSON.stringify({ payrollExportJobId: run.jobId }),
			}),
		]);
		expect(await finance.removeTravelExpenseFromPayrollRunAction({ reportId })).toEqual({
			success: true,
			data: { status: "not_included" },
		});
		// Free again: the next export of another period takes it.
		const next = await exportPayroll("datev_lohn", overlapping);
		expect(next.content).toContain(datevLine("P-REQ", "9100", "100.00", overlapping));
	});

	it("refuses an included report on every reimbursement path, with a clear reason", async () => {
		const reportId = await approvedHotel("100.00");
		const batchSigned = async () => {
			signIn("finance");
			const listed = await exportActions.getTravelExpenseExports();
			if (!listed.success) throw new Error(listed.error);
			const row = listed.data.exportable.find((candidate) => candidate.reportId === reportId);
			const created = await exportActions.createTravelExpenseExportAction({
				idempotencyKey: randomUUID(),
				selection: [{ reportId, revisionId: row?.revisionId ?? "" }],
			});
			if (!created.success || created.data.status !== "created") throw new Error("export");
			for (const job of harness.jobs.splice(0)) {
				expect(await processTravelExpenseExportBatch(db, job)).toEqual({ status: "completed" });
			}
			return created.data.batchId;
		};
		const batchId = await batchSigned();
		const run = await exportPayroll("datev_lohn", current);
		const account = {
			source: source(reportId),
			expectedBalance: { currency: "EUR", amount: "100.00" },
		};

		const single = await reimburse(reportId, "100.00");
		signIn("officer");
		const bulk = await finance.markTravelExpensesReimbursedAction({
			requestKey: randomUUID(),
			accounts: [account],
			occurredOn: today.toString(),
			reference: "SEPA-2",
		});
		signIn("finance");
		const preview = await exportActions.getTravelExpenseExportReimbursement(batchId);
		const batch = await exportActions.markTravelExpenseExportReimbursedAction({
			batchId,
			requestKey: randomUUID(),
			accounts: [account],
			occurredOn: today.toString(),
			reference: "SEPA-3",
			note: null,
		});

		expect(single).toEqual({
			success: true,
			data: {
				status: "in_payroll_run",
				payrollRun: expect.objectContaining({
					jobId: run.jobId,
					formatId: "datev_lohn",
					periodStart: current.start,
					periodEnd: current.end,
				}),
			},
		});
		expect(bulk).toEqual({
			success: true,
			data: {
				status: "processed",
				rows: [expect.objectContaining({ outcome: "in_payroll_run", amount: null })],
			},
		});
		if (!preview.success || preview.data.status !== "ready") throw new Error("preview");
		expect(preview.data.accounts.map((entry) => entry.skip)).toEqual(["in_payroll_run"]);
		expect(batch).toEqual({
			success: true,
			data: { status: "processed", rows: [expect.objectContaining({ outcome: "in_payroll_run" })] },
		});
		const { rows } = await admin.query(
			"select count(*)::int as count from travel_expense_settlement_entry where report_id = $1",
			[reportId],
		);
		expect(rows[0]?.count).toBe(0);
	});

	it("shows officers which run includes a report; the employee sees nothing new", async () => {
		const reportId = await approvedHotel("100.00");
		const run = await exportPayroll("datev_lohn", current);

		const officerView = await settlementAs("officer", reportId);
		const ownView = await settlementAs("requester", reportId);
		signIn("officer");
		const queue = await finance.getTravelExpenseFinanceQueue({
			status: "open",
			employeeId: null,
			teamId: null,
			currency: null,
			notExported: false,
			page: 1,
		});

		expect(officerView.account.payrollRun).toEqual(expect.objectContaining({ jobId: run.jobId }));
		expect(ownView.account.payrollRun).toBeNull();
		if (!queue.success) throw new Error(queue.error);
		expect(queue.data.accounts.map((account) => account.payrollRun?.jobId)).toEqual([run.jobId]);
	});

	it("keeps every read and write inside the organization", async () => {
		const reportId = await approvedHotel("100.00");
		const run = await exportPayroll("datev_lohn", current);

		const foreignDiscard = await discardPayrollRun(db, {
			organizationId: FOREIGN_ORG,
			jobId: run.jobId,
			actorUserId: "t852-foreigner",
			employeeScope: "all",
		});
		signIn("foreigner");
		const foreignRemove = await finance.removeTravelExpenseFromPayrollRunAction({ reportId });

		expect(foreignDiscard).toEqual({ status: "not_found" });
		expect(foreignRemove).toEqual({ success: false, error: "Not found" });
		expect(await countUnconfirmedPayrollRuns(FOREIGN_ORG)).toBe(0);
		expect(await inclusions(reportId)).toEqual([expect.objectContaining({ state: "included" })]);
	});
});
