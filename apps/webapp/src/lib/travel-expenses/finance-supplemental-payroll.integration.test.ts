/**
 * #1256: adding supporting evidence leaves an existing payroll inclusion intact.
 * Uses the real report, approval, payroll export and settlement interfaces;
 * authentication/session and storage are controlled at external boundaries.
 */

import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1256p-org",
	tus: new Map<string, Buffer>(),
	objects: new Map<string, Buffer>(),
	jobs: [] as Array<{
		organizationId: string;
		batchId: string;
		attempt: number;
	}>,
	failNextUpload: false,
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
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
	async addJob(
		_name: string,
		data: { organizationId: string; batchId: string; attempt: number },
	) {
		harness.jobs.push({
			organizationId: data.organizationId,
			batchId: data.batchId,
			attempt: data.attempt,
		});
		return { id: randomUUID() };
	},
}));
vi.mock("@/lib/storage/s3-client", () => ({
	S3_PUBLIC_BUCKET: "t1256p-public",
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
	async uploadPrivateObject(
		_organizationId: string,
		key: string,
		data: Buffer,
	) {
		harness.objects.set(key, Buffer.from(data));
		return { bucket: "t1256p-private", versionId: `v-${key.length}` };
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

const exceptionActions = await import(
	"@/app/[locale]/(app)/travel-expenses/receipt-exception-actions"
);
const actions = await import(
	"@/app/[locale]/(app)/travel-expenses/report-actions"
);
const finance = await import(
	"@/app/[locale]/(app)/travel-expenses/finance-actions"
);
const { createExportJob, processExportJob } = await import(
	"@/lib/payroll-export/export-service"
);
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import(
	"@/app/api/approvals/inbox/[id]/approve/route"
);
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { systemClock } = await import("@/lib/datetime/temporal-core");

const ORG = "t1256p-org";
const FOREIGN_ORG = "t1256p-foreign";
const ids = {
	requester: "e12a0000-0000-4000-8000-000000000001",
	manager: "e12a0000-0000-4000-8000-000000000002",
	finance: "e12a0000-0000-4000-8000-000000000003",
	colleague: "e12a0000-0000-4000-8000-000000000004",
	officer: "e12a0000-0000-4000-8000-000000000005",
	clerk: "e12a0000-0000-4000-8000-000000000006",
	foreigner: "e12a0000-0000-4000-8000-000000000007",
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
	sage_lohn: {
		personnelNumberType: "employeeNumber",
		outputFormat: "sage_native",
	},
	successfactors_csv: { employeeMatchStrategy: "userId" },
} as const;
type Format = keyof typeof CONFIGS;

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

/** Logical dates relative to today in Berlin, so the reports approved now fall where intended. */
const today = systemClock
	.nowInstant()
	.toZonedDateTimeISO("Europe/Berlin")
	.toPlainDate();
const day = (offset: number) => today.add({ days: offset }).toString();
interface Period {
	start: string;
	end: string;
}
/** The period every report approved today falls in. */
const current: Period = { start: day(-20), end: day(20) };
async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [
		ORG,
		FOREIGN_ORG,
	]);
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't1256p-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t1256p-%"]);
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
	for (const [
		name,
		organizationId,
		memberRole,
		role,
		employeeNumber,
	] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t1256p-${name}`, name, `t1256p-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t1256p-member-${name}`, organizationId, `t1256p-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,employee_number,updated_at) values ($1,$2,$3,$4,$5,now())",
			[ids[name], `t1256p-${name}`, organizationId, role, employeeNumber],
		);
	}
	for (const employeeId of [ids.requester, ids.colleague]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't1256p-manager', now(), now())`,
			[employeeId, ids.manager],
		);
	}
	await admin.query(
		`insert into expense_officer_grant
		 (organization_id, officer_employee_id, scope, can_export, can_record_reimbursements, created_by)
		 values ($1, $2, 'all', true, true, 't1256p-finance')`,
		[ORG, ids.officer],
	);
	// The clerk's payroll scope is the requester only.
	const { rows: grants } = await admin.query<{ id: string }>(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'specific', 't1256p-finance', now()) returning id`,
		[ORG, ids.clerk],
	);
	await admin.query(
		`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
		 values ($1, $2, $3, 't1256p-finance')`,
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
			 values ($1, $2, $3::jsonb, 't1256p-finance', now())`,
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
		"update travel_expense_settings set missing_receipt_exceptions_allowed=true where organization_id=$1",
		[ORG],
	);
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
	harness.userId = `t1256p-${name}`;
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
	expect(
		await exceptionActions.saveReceiptExceptionAction({
			reportId,
			itemId: item.id,
			expectedVersion: 0,
			requested: true,
			reason: "Receipt supplied by finance later",
		}),
	).toMatchObject({ success: true, data: { status: "saved" } });
	const report = await loadOwn(owner, reportId);
	const submitted = await actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.trip?.version ?? null,
			items: report.items.map((entry) => ({
				id: entry.id,
				version: entry.version,
				receiptIds: entry.receipts.map((receipt) => receipt.id),
				receiptExceptionVersion: entry.receiptException.version,
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
			body: JSON.stringify({ acceptedReceiptExceptionItemIds: [item.id] }),
		}) as unknown as NextRequest,
		{ params: Promise.resolve({ id: rows[0]?.id ?? "" }) },
	);
	expect(approved.status).toBe(200);
	return reportId;
}

/** A payroll file export of the period, as the settings page starts it. */
/** Luxon adapts the Temporal days only at this legacy payroll-service boundary. */
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

async function settlement(reportId: string) {
	signIn("officer");
	const result = await finance.getTravelExpenseSettlement({
		type: "report",
		id: reportId,
	});
	if (!result.success || !result.data) throw new Error("No settlement");
	return result.data;
}

describe("supplemental receipts preserve payroll inclusion (#1256)", () => {
	beforeEach(async () => {
		await seed();
		harness.tus.clear();
		harness.objects.clear();
	});
	afterAll(cleanup);
	it("attaches a receipt while the approved report is in payroll without changing the inclusion, balance or recorded evidence", async () => {
		const reportId = await approvedHotel("100.00");
		const run = await exportPayroll("datev_lohn", current);
		const before = await settlement(reportId);
		expect(before.account.payrollRun).toMatchObject({ jobId: run.jobId });
		const original = await actions.getTravelExpenseReportSubmission(reportId);
		if (!original.success) throw new Error(original.error);
		const item = original.data.facts.items[0];
		if (!item) throw new Error("No receipt expense item");
		const tusFileKey = createOwnedTusFileKey("t1256p-officer");
		harness.tus.set(tusFileKey, pdfBytes);
		const response = await processReceipt(
			new Request("http://localhost/api/upload/travel-expense/report-receipt", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					reportId,
					itemId: item.itemId,
					submissionCycle: 1,
					tusFileKey,
					fileName: "payroll-support.pdf",
				}),
			}) as NextRequest,
		);
		expect(response.status).toBe(201);
		expect(await settlement(reportId)).toEqual(before);
		const after = await actions.getTravelExpenseReportSubmission(reportId);
		expect(after).toMatchObject({
			success: true,
			data: {
				status: "approved",
				facts: {
					totals: original.data.facts.totals,
					items: [
						expect.objectContaining({
							receiptException: { reason: "Receipt supplied by finance later" },
							receipts: [
								expect.objectContaining({
									fileName: "payroll-support.pdf",
									addedAfterSubmission: true,
									uploadedByName: "officer",
								}),
							],
						}),
					],
				},
			},
		});
	});
});
