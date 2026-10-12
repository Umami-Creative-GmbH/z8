/**
 * #854: payroll readiness lists each report awaiting reimbursement that the
 * payroll run will not carry, with the reason, and agrees with the export.
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
	organizationId: "t854-org",
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
	S3_PUBLIC_BUCKET: "t854-public",
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
		return { bucket: "t854-private", versionId: `v-${key.length}` };
	},
	async readPrivateObject() {
		throw new Error("not used");
	},
	async deletePrivateObject() {},
	async deletePrivateObjectVersions() {},
	async uploadExport() {},
	async getPresignedUrl(_organizationId: string, key: string) {
		return `https://exports.test/${key}`;
	},
}));

const { db } = await import("@/db");
const actions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const mileageActions = await import("@/app/[locale]/(app)/travel-expenses/mileage-actions");
const overrideActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/allowance-override-actions"
);
const finance = await import("@/app/[locale]/(app)/travel-expenses/finance-actions");
const payrollActions = await import("@/app/[locale]/(app)/payroll/actions");
const { createExportJob, processExportJob } = await import("@/lib/payroll-export/export-service");
const { getPayrollRunReadiness } = await import("./payroll-run-readiness");
const { POST: processReceipt } = await import(
	"@/app/api/upload/travel-expense/report-receipt/route"
);
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { createOwnedTusFileKey } = await import("@/lib/upload/tus-ownership");
const { systemClock } = await import("@/lib/datetime/temporal-core");

const ORG = "t854-org";
const FOREIGN_ORG = "t854-foreign";
const ids = {
	requester: "e8540000-0000-4000-8000-000000000001",
	manager: "e8540000-0000-4000-8000-000000000002",
	finance: "e8540000-0000-4000-8000-000000000003",
	colleague: "e8540000-0000-4000-8000-000000000004",
	officer: "e8540000-0000-4000-8000-000000000005",
	clerk: "e8540000-0000-4000-8000-000000000006",
	foreigner: "e8540000-0000-4000-8000-000000000007",
} as const;
type Person = keyof typeof ids;
type Owner = "requester" | "colleague";

const admin = integrationAdminPool();
const pdfBytes = Buffer.from("%PDF-1.4\n% receipt\n%%EOF");

const today = systemClock.nowInstant().toZonedDateTimeISO("Europe/Berlin").toPlainDate();
const day = (offset: number) => today.add({ days: offset }).toString();
interface Period {
	startDate: string;
	endDate: string;
}
/** The period every report approved today falls in. */
const current: Period = { startDate: day(-20), endDate: day(20) };
/** Another period that also covers today. */
const overlapping: Period = { startDate: day(-10), endDate: day(30) };
/** A period that ended yesterday, before today's approvals. */
const past: Period = { startDate: day(-40), endDate: day(-1) };

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, FOREIGN_ORG]);
	await admin.query(
		"delete from travel_expense_receipt_upload where organization_id like 't854-%'",
	);
	await admin.query('delete from "user" where id like $1', ["t854-%"]);
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
		["finance", ORG, "admin", "admin", null],
		["colleague", ORG, "member", "employee", "P-COL"],
		["officer", ORG, "member", "employee", null],
		["clerk", ORG, "member", "employee", null],
		["foreigner", FOREIGN_ORG, "owner", "admin", null],
	];
	for (const [name, organizationId, memberRole, role, employeeNumber] of people) {
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t854-${name}`, name, `t854-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t854-member-${name}`, organizationId, `t854-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,employee_number,updated_at) values ($1,$2,$3,$4,$5,now())",
			[ids[name], `t854-${name}`, organizationId, role, employeeNumber],
		);
	}
	for (const employeeId of [ids.requester, ids.colleague]) {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, 't854-manager', now(), now())`,
			[employeeId, ids.manager],
		);
	}
	await admin.query(
		`insert into expense_officer_grant
		 (organization_id, officer_employee_id, scope, can_export, can_record_reimbursements, created_by)
		 values ($1, $2, 'all', true, true, 't854-finance')`,
		[ORG, ids.officer],
	);
	// The clerk's payroll scope is the requester only.
	const { rows: grants } = await admin.query<{ id: string }>(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'specific', 't854-finance', now()) returning id`,
		[ORG, ids.clerk],
	);
	await admin.query(
		`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
		 values ($1, $2, $3, 't854-finance')`,
		[ORG, grants[0]?.id, ids.requester],
	);
	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at) values
		 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()),
		 ('personio', 'Personio', '1.0.0', now())
		 on conflict (id) do nothing`,
	);
	await admin.query(
		`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
		 values ($1, 'datev_lohn', $2::jsonb, 't854-finance', now())`,
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
	// Hotels are mapped for DATEV; meals are not.
	await admin.query(
		`insert into payroll_expense_wage_type_mapping (organization_id, payroll_line_kind, datev_wage_type_code)
		 values ($1, 'receipt_accommodation', '9100')`,
		[ORG],
	);
	await settings({ channel: "payroll_run", currency: "EUR" });
	await admin.query(
		"insert into travel_expense_payroll_run_preview_control (organization_id, mode) values ($1, 'active')",
		[ORG],
	);
}

async function settings(values: { channel?: string; currency?: string }) {
	await admin.query(
		`insert into travel_expense_settings (organization_id, reimbursement_channel, reimbursement_currency)
		 values ($1, coalesce($2, 'bank_transfer'), coalesce($3, 'EUR'))
		 on conflict (organization_id) do update set
		   reimbursement_channel = coalesce($2, travel_expense_settings.reimbursement_channel),
		   reimbursement_currency = coalesce($3, travel_expense_settings.reimbursement_currency)`,
		[ORG, values.channel ?? null, values.currency ?? null],
	);
}

function signIn(name: Person) {
	harness.userId = `t854-${name}`;
	harness.organizationId = name === "foreigner" ? FOREIGN_ORG : ORG;
}

async function loadOwn(owner: Owner, reportId: string) {
	signIn(owner);
	const report = await actions.getMyTravelExpenseReport(reportId);
	if (!report.success) throw new Error(report.error);
	return report.data;
}

async function submitAndApprove(reportId: string, owner: Owner) {
	const report = await loadOwn(owner, reportId);
	const submitted = await actions.submitTravelExpenseReportAction({
		reportId,
		reviewed: {
			detailsVersion: report.trip?.version ?? null,
			items: report.items.map((entry) => ({
				id: entry.id,
				version: entry.version,
				receiptIds: entry.receipts.map((receipt) => receipt.id),
				amount: entry.perDiem?.amount ?? entry.mileage?.amount ?? entry.amount,
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

/** An approved standalone receipt paid by `owner`; approved now. */
async function approvedReceipt(
	amount: string,
	options: { owner?: Owner; category?: "accommodation" | "meals"; currency?: string } = {},
) {
	const owner = options.owner ?? "requester";
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
			category: options.category ?? "accommodation",
			description: "Hotel Hamburg",
			amount,
			currency: options.currency ?? "EUR",
			paidBy: "employee",
			accountingReference: null,
		},
	});
	if (!saved.success) throw new Error(saved.error);
	const tusFileKey = createOwnedTusFileKey(`t854-${owner}`);
	harness.tus.set(tusFileKey, pdfBytes);
	const uploaded = await processReceipt(
		new Request("http://localhost/api/upload/travel-expense/report-receipt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tusFileKey, reportId, itemId: item.id, fileName: "invoice.pdf" }),
		}) as unknown as NextRequest,
	);
	if (uploaded.status !== 200) throw new Error(`upload ${uploaded.status}`);
	return submitAndApprove(reportId, owner);
}

/** An approved mileage allowance an administrator set by hand (#610): no statutory baseline. */
async function approvedOverriddenMileage() {
	signIn("requester");
	const created = await mileageActions.createStandaloneMileageReportAction();
	if (!created.success) throw new Error(created.error);
	const { reportId } = created.data;
	const [draft] = (await loadOwn("requester", reportId)).items;
	if (!draft) throw new Error("item missing");
	signIn("requester");
	const saved = await mileageActions.saveMileageItemDraftAction({
		reportId,
		itemId: draft.id,
		expectedVersion: draft.version,
		values: {
			expenseDate: day(-3),
			route: "Office Berlin – customer Potsdam – back",
			distanceKm: "61.50",
			vehicle: "car",
			accountingReference: null,
		},
	});
	if (!saved.success || saved.data.status !== "saved") throw new Error(JSON.stringify(saved));
	signIn("finance");
	const authorized = await overrideActions.authorizeAllowanceOverrideAction({
		reportId,
		itemId: draft.id,
		expectedVersion: saved.data.item.version,
		amount: "18.45",
		reason: "No mileage policy is set up yet",
		evidence: "Route planner printout",
		calculationBasis: "61.50 km × 0.30 EUR",
	});
	expect(authorized).toMatchObject({ success: true, data: { kind: "authorized" } });
	await submitAndApprove(reportId, "requester");
	return { reportId, itemId: draft.id };
}

/** An approved legacy claim of the requester, decided yesterday. */
async function approvedClaim() {
	const claimId = randomUUID();
	await admin.query(
		`insert into travel_expense_claim (id, organization_id, employee_id, type, status, trip_start, trip_end,
		   original_currency, original_amount, calculated_currency, calculated_amount,
		   submitted_at, decided_at, created_by, updated_at)
		 values ($1, $2, $3, 'receipt', 'approved', $4, $4, 'EUR', '42.00', 'EUR', '42.00',
		   now() - interval '2 days', now() - interval '1 day', 't854-requester', now())`,
		[claimId, ORG, ids.requester, day(-5)],
	);
	return claimId;
}

async function reimburse(reportId: string, amount: string, balance: string) {
	signIn("officer");
	const recorded = await finance.recordTravelExpenseReimbursementAction({
		source: { type: "report", id: reportId },
		idempotencyKey: randomUUID(),
		amount,
		occurredOn: today.toString(),
		reference: "SEPA-1",
		expectedBalance: { currency: "EUR", amount: balance },
	});
	expect(recorded).toMatchObject({ success: true, data: { status: "recorded" } });
}

/** A payroll file export of the period, as the settings page starts it. */
async function exportPayroll(period: Period, employeeIds?: string[]) {
	const { jobId } = await createExportJob({
		organizationId: ORG,
		formatId: "datev_lohn",
		requestedById: ids.finance,
		filters: {
			dateRange: {
				start: DateTime.fromISO(period.startDate, { zone: "utc" }),
				end: DateTime.fromISO(period.endDate, { zone: "utc" }),
			},
			employeeIds,
		},
	});
	await processExportJob({ jobId, organizationId: ORG });
	return jobId;
}

async function includedIn(jobId: string) {
	const { rows } = await admin.query<{ report_id: string }>(
		"select report_id::text from travel_expense_payroll_run_inclusion where payroll_export_job_id = $1 and state = 'included'",
		[jobId],
	);
	return rows.map((row) => row.report_id).sort();
}

function readiness(
	period: Period,
	options: { formatId?: string; employeeIds?: string[]; organizationId?: string } = {},
) {
	return getPayrollRunReadiness(db, {
		organizationId: options.organizationId ?? ORG,
		formatId: options.formatId ?? "datev_lohn",
		period,
		employeeIds: options.employeeIds ?? [ids.requester, ids.colleague],
	});
}

async function listed(...args: Parameters<typeof readiness>) {
	const result = await readiness(...args);
	if (!result.applies) throw new Error("readiness does not apply");
	return result.entries;
}

describe("payroll readiness for payroll runs (#854)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

	beforeEach(async () => {
		await seed();
		harness.tus.clear();
	});
	afterAll(cleanup);

	it("lists each report the run will not carry with its reason, exactly the ones the export skips", async () => {
		const held = await approvedReceipt("8.05", { owner: "colleague" });
		const otherRun = await exportPayroll(overlapping, [ids.colleague]);
		const carried = await approvedReceipt("100.00");
		const meals = await approvedReceipt("30.00", { category: "meals" });
		const partlyPaid = await approvedReceipt("50.00");
		await reimburse(partlyPaid, "20.00", "50.00");
		const mileage = await approvedOverriddenMileage();
		const claim = await approvedClaim();
		await settings({ currency: "CHF" });
		const swiss = await approvedReceipt("90.00", { currency: "CHF" });
		await settings({ currency: "EUR" });

		const before = await listed(current);
		const reasons = Object.fromEntries(before.map((entry) => [entry.source.id, entry.skip]));

		expect(reasons).toEqual({
			[held]: {
				reason: "included_in_other_run",
				run: expect.objectContaining({
					jobId: otherRun,
					formatName: "DATEV Lohn & Gehalt",
					periodStart: overlapping.startDate,
					periodEnd: overlapping.endDate,
				}),
			},
			[meals]: { reason: "unmapped_wage_type", kinds: ["receipt_meals"] },
			[partlyPaid]: { reason: "reimbursed_outside_payroll" },
			[mileage.reportId]: {
				reason: "no_statutory_baseline",
				items: [
					{
						itemId: mileage.itemId,
						cause: "allowance_override",
						type: "mileage",
						expenseDate: day(-3),
						description: "Office Berlin – customer Potsdam – back",
					},
				],
			},
			[claim]: { reason: "legacy_claim" },
			[swiss]: { reason: "currency_not_eur" },
		});
		expect(before.find((entry) => entry.source.id === partlyPaid)).toMatchObject({
			source: { type: "report", id: partlyPaid },
			employeeId: ids.requester,
			employeeName: "requester",
			outstanding: [{ currency: "EUR", amount: "30.00" }],
			financeQueueHref: `/travel-expenses/finance?employee=${ids.requester}&currency=EUR`,
		});
		expect(before.find((entry) => entry.source.id === swiss)?.financeQueueHref).toBe(
			`/travel-expenses/finance?employee=${ids.requester}&currency=CHF`,
		);

		// The export of the same period and employees takes exactly the reports not listed.
		const run = await exportPayroll(current, [ids.requester, ids.colleague]);
		expect(await includedIn(run)).toEqual([carried]);
		expect(await includedIn(otherRun)).toEqual([held]);
		// Once exported, readiness still agrees: the run's own report is not listed.
		expect((await listed(current)).map((entry) => entry.source.id).sort()).toEqual(
			before.map((entry) => entry.source.id).sort(),
		);
	});

	it("lists every report awaiting reimbursement for an API connector", async () => {
		const reportId = await approvedReceipt("100.00");
		const claim = await approvedClaim();

		expect(
			(await listed(current, { formatId: "personio" })).map(({ source, skip }) => ({
				id: source.id,
				skip,
			})),
		).toEqual(
			expect.arrayContaining([
				{ id: reportId, skip: { reason: "api_connector" } },
				{ id: claim, skip: { reason: "api_connector" } },
			]),
		);
	});

	it("ignores reports approved after the period and anything already settled", async () => {
		const paid = await approvedReceipt("50.00");
		await reimburse(paid, "50.00", "50.00");
		await approvedReceipt("30.00", { category: "meals" });

		expect(await listed(past)).toEqual([]);
		expect((await listed(current)).map((entry) => entry.source.id)).not.toContain(paid);
	});

	it("behaves as before with the bank transfer channel or a closed preview gate", async () => {
		await approvedReceipt("30.00", { category: "meals" });

		await settings({ channel: "bank_transfer" });
		expect(await readiness(current)).toEqual({ applies: false });
		await settings({ channel: "payroll_run" });
		await admin.query(
			"update travel_expense_payroll_run_preview_control set mode = 'inactive' where organization_id = $1",
			[ORG],
		);
		expect(await readiness(current)).toEqual({ applies: false });
	});

	it("limits the workspace to the reader's payroll scope and the organization", async () => {
		const own = await approvedReceipt("30.00", { category: "meals" });
		await approvedReceipt("20.00", { owner: "colleague", category: "meals" });

		signIn("clerk");
		const scoped = await payrollActions.getPayrollRunReadinessAction({
			startDate: current.startDate,
			endDate: current.endDate,
			label: "Current",
			formatId: "datev_lohn",
		});
		// Asking for an employee outside the scope reaches nobody's reports.
		const widened = await payrollActions.getPayrollRunReadinessAction({
			startDate: current.startDate,
			endDate: current.endDate,
			label: "Current",
			formatId: "datev_lohn",
			employeeIds: [ids.colleague],
		});
		signIn("officer");
		const noAccess = await payrollActions.getPayrollRunReadinessAction({
			startDate: current.startDate,
			endDate: current.endDate,
			label: "Current",
			formatId: "datev_lohn",
		});

		expect(scoped).toMatchObject({ success: true, data: { applies: true } });
		if (!scoped.success || !scoped.data.applies) throw new Error("scoped");
		expect(scoped.data.entries.map((entry) => entry.source.id)).toEqual([own]);
		expect(widened.success).toBe(false);
		expect(noAccess.success).toBe(false);
		// Another organization paying through payroll never sees these reports.
		await admin.query(
			`insert into travel_expense_settings (organization_id, reimbursement_channel) values ($1, 'payroll_run');
			 insert into travel_expense_payroll_run_preview_control (organization_id, mode) values ($1, 'active')`.replaceAll(
				"$1",
				`'${FOREIGN_ORG}'`,
			),
		);
		expect(
			await readiness(current, {
				organizationId: FOREIGN_ORG,
				employeeIds: [ids.requester, ids.colleague],
			}),
		).toEqual({ applies: true, entries: [] });
	});
});
