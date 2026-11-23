/**
 * #1997 (spec #1935): External Contractor periods never reach employee payroll. Against
 * PostgreSQL, through the payroll workspace's own actions (DATEV export, scope, Overview,
 * readiness) and the export data reads that settings and scheduled exports and the payroll
 * connectors use. An employee of the same organization is the control throughout; a person
 * converted from contractor to employee on 15 July 2026 at 12:00 Berlin (10:00 UTC) shows that
 * the exclusion is per stint, to the instant.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t1997p-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: "t1997p-org",
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadExport: async () => undefined,
	getPresignedUrl: async () => "https://exports.test/file",
}));
vi.mock("@/lib/queue", () => ({ addJob: async () => ({ id: "queued" }) }));

const {
	getPayrollDayRecordsAction,
	getPayrollExportScopeAction,
	getPayrollReadinessForWorkspaceAction,
	getPayrollRunReadinessAction,
	getPayrollWorkspaceSummaryAction,
	startScopedPayrollExportAction,
} = await import("@/app/[locale]/(app)/payroll/actions");
const { fetchAbsencesForExport, fetchOvertimePayoutsForExport, fetchWorkPeriodsForExport } =
	await import("./data-fetcher");
const { listCompatiblePayrollBaselines, preparePayrollComparison } =
	await import("./comparison-service");
const { readPeriodRecordsForEmployees } = await import("@/lib/payroll-period/read-period-records");
const { readExportCarriedDays } = await import("@/lib/payroll-period/carried-days");

const admin = integrationAdminPool();
const ORG = "t1997p-org";
const users = [
	"t1997p-owner",
	"t1997p-worker",
	"t1997p-contractor",
	"t1997p-converted",
	"t1997p-holder",
];
const ids = {
	owner: "d1997000-0000-4000-8000-000000000001",
	worker: "d1997000-0000-4000-8000-000000000002",
	contractor: "d1997000-0000-4000-8000-000000000003",
	converted: "d1997000-0000-4000-8000-000000000004",
	holder: "d1997000-0000-4000-8000-000000000005",
} as const;
const july = { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" };
const julyFilters = {
	dateRange: { start: parsePlainDate("2026-07-01"), end: parsePlainDate("2026-07-31") },
};
/** Contractor until 15 July 2026 12:00 Berlin, employee from then on. */
const CONVERTED_AT = "2026-07-15T10:00:00Z";

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id = any($1::text[])', [users]);
}

async function person(
	id: string,
	userId: string,
	number: string,
	engagementKind: "employee" | "contractor",
) {
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, engagement_kind, updated_at)
		 values ($1, $2, $3, 'employee', $4, $5, now())`,
		[id, userId, ORG, number, engagementKind],
	);
}

async function stint(
	employeeId: string,
	engagementKind: "employee" | "contractor",
	startedAt: string,
	endedAt: string | null,
): Promise<string> {
	const { rows } = await admin.query(
		`insert into employee_employment_period
		   (organization_id, employee_id, status, started_at, ended_at, start_provenance, engagement_kind)
		 values ($1, $2, $3, $4, $5, 'recorded', $6) returning id`,
		[ORG, employeeId, endedAt ? "closed" : "open", startedAt, endedAt, engagementKind],
	);
	return rows[0].id;
}

/** An open departure clock repair of a timer that ran from `start` until `end`. */
async function clockRepair(employeeId: string, start: string, end: string) {
	const { rows: periods } = await admin.query(
		`select id from employee_employment_period
		 where organization_id = $1 and employee_id = $2 and started_at < $3
		 order by started_at desc limit 1`,
		[ORG, employeeId, end],
	);
	const { rows: departure } = await admin.query(
		`insert into employee_departure
		 (organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at, created_by,
		  request_id, request_fingerprint, revision, status, effective_at)
		 values ($1, $2, $3, 'immediate', 'UTC', $4, 't1997p-owner', gen_random_uuid(), 'test', 1,
		         'effective', $4) returning id`,
		[ORG, employeeId, periods[0].id, end],
	);
	await admin.query(
		`insert into employee_departure_review
		 (organization_id, employee_id, employment_period_id, departure_id, kind, subject_id, status,
		  affected_start_at, affected_end_at)
		 values ($1, $2, $3, $4, 'clock_repair', gen_random_uuid(), 'open', $5, $6)`,
		[ORG, employeeId, periods[0].id, departure[0].id, start, end],
	);
}

/** An approved legacy expense claim awaiting reimbursement, decided in July. */
async function approvedClaim(employeeId: string) {
	await admin.query(
		`insert into travel_expense_claim (id, organization_id, employee_id, type, status, trip_start, trip_end,
		   original_currency, original_amount, calculated_currency, calculated_amount,
		   submitted_at, decided_at, created_by, updated_at)
		 values (gen_random_uuid(), $1, $2, 'receipt', 'approved', '2026-07-14', '2026-07-14', 'EUR', '42.00',
		   'EUR', '42.00', '2026-07-16T08:00:00Z', '2026-07-17T08:00:00Z', 't1997p-owner', now())`,
		[ORG, employeeId],
	);
}

async function work(
	employeeId: string,
	startAt: string,
	endAt: string | null,
	minutes: number | null,
	approvalState: "approved" | "pending" = "approved",
) {
	const { rows } = await admin.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
		   duration_minutes, approval_state, origin, created_by, updated_by, updated_at)
		 values (gen_random_uuid(), $1, $2, 'work', $3, $4, $5, $6, 'manual',
		   't1997p-owner', 't1997p-owner', now()) returning id`,
		[ORG, employeeId, startAt, endAt, minutes, approvalState],
	);
	await admin.query(
		`insert into time_record_work (record_id, organization_id, record_kind) values ($1, $2, 'work')`,
		[rows[0].id, ORG],
	);
}

/** A full-day canonical absence, encoded as the absence writers store it. */
async function absence(
	employeeId: string,
	categoryId: string,
	date: string,
	approvalState: "approved" | "pending" = "approved",
) {
	const { rows } = await admin.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
		   approval_state, origin, created_by, updated_at)
		 values (gen_random_uuid(), $1, $2, 'absence', $3::date,
		   ($3::date + interval '1 day' - interval '1 millisecond'), $4, 'manual',
		   't1997p-owner', now()) returning id`,
		[ORG, employeeId, date, approvalState],
	);
	await admin.query(
		`insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id)
		 values ($1, $2, 'absence', $3)`,
		[rows[0].id, ORG, categoryId],
	);
}

async function payout(employeeId: string, day: string, minutes: number) {
	await admin.query(
		`insert into balance_adjustment (organization_id, employee_id, kind, day, minutes, reason, recorded_by)
		 values ($1, $2, 'overtime_payout', $3, $4, 'Payout', 't1997p-owner')`,
		[ORG, employeeId, day, -minutes],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', '2026-01-01')`,
		[ORG],
	);
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at)
		 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
		[users],
	);
	await admin.query(
		`insert into member (id, organization_id, user_id, role, status, created_at) values
		 ('t1997p-m-owner', $1, 't1997p-owner', 'owner', 'approved', now()),
		 ('t1997p-m-holder', $1, 't1997p-holder', 'member', 'approved', now())`,
		[ORG],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, updated_at)
		 values ($1, 't1997p-owner', $2, 'admin', 'OWN-1', now())`,
		[ids.owner, ORG],
	);
	await person(ids.worker, "t1997p-worker", "WRK-1", "employee");
	await person(ids.contractor, "t1997p-contractor", "CON-1", "contractor");
	await person(ids.converted, "t1997p-converted", "CNV-1", "employee");
	await person(ids.holder, "t1997p-holder", "HLD-1", "employee");
	await stint(ids.contractor, "contractor", "2026-01-01T00:00:00Z", null);
	await stint(ids.converted, "contractor", "2026-01-01T00:00:00Z", CONVERTED_AT);
	await stint(ids.converted, "employee", CONVERTED_AT, null);

	// A payroll access grant that covers only the External Contractor.
	const { rows: grant } = await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'specific', 't1997p-owner', now()) returning id`,
		[ORG, ids.holder],
	);
	await admin.query(
		`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
		 values ($1, $2, $3, 't1997p-owner')`,
		[ORG, grant[0].id, ids.contractor],
	);

	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at) values
		 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now())
		 on conflict (id) do nothing`,
	);
	await admin.query(
		`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
		 values ($1, 'datev_lohn', $2::jsonb, 't1997p-owner', now())`,
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
	const { rows: category } = await admin.query(
		`insert into absence_category
		 (organization_id, type, name, color, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, 'vacation', 'Vacation', '#22c55e', true, true, true, now()) returning id`,
		[ORG],
	);
	await admin.query(
		`insert into payroll_wage_type_mapping
		   (organization_id, special_category, wage_type_code, datev_wage_type_code, created_by, updated_at)
		 values ($1, 'overtime', '1900', '1900', 't1997p-owner', now())`,
		[ORG],
	);
	await admin.query(
		`insert into payroll_wage_type_mapping
		   (organization_id, absence_category_id, wage_type_code, datev_wage_type_code, created_by, updated_at)
		 values ($1, $2, '2000', '2000', 't1997p-owner', now())`,
		[ORG, category[0].id],
	);
	const vacation = category[0].id as string;

	// The employee control.
	await work(ids.worker, "2026-07-14T07:00:00Z", "2026-07-14T11:00:00Z", 240);
	await payout(ids.worker, "2026-07-10", 60);
	await absence(ids.worker, vacation, "2026-07-22");

	// The External Contractor: approved, open and pending work, a payout, approved and pending
	// leave recorded before the stint rules (legacy rows), and no employment terms.
	await work(ids.contractor, "2026-07-14T08:00:00Z", "2026-07-14T11:00:00Z", 180);
	await work(ids.contractor, "2026-07-20T08:00:00Z", null, null);
	await work(ids.contractor, "2026-07-21T08:00:00Z", "2026-07-21T10:00:00Z", 120, "pending");
	await payout(ids.contractor, "2026-07-10", 60);
	await absence(ids.contractor, vacation, "2026-07-22");
	await absence(ids.contractor, vacation, "2026-07-23", "pending");

	// The converted person: contractor work before 15 July 12:00 Berlin, employee work after.
	await work(ids.converted, "2026-07-10T08:00:00Z", "2026-07-10T12:00:00Z", 240);
	await work(ids.converted, "2026-07-13T08:00:00Z", "2026-07-13T09:00:00Z", 60, "pending");
	await work(ids.converted, "2026-07-15T08:00:00Z", "2026-07-15T12:00:00Z", 240);
	await work(ids.converted, "2026-07-20T08:00:00Z", "2026-07-20T11:00:00Z", 180);
	await payout(ids.converted, "2026-07-10", 30);
	await payout(ids.converted, "2026-07-20", 30);
	await absence(ids.converted, vacation, "2026-07-08");
	await absence(ids.converted, vacation, "2026-07-09", "pending");
	await absence(ids.converted, vacation, "2026-07-22");
}

describe("External Contractor periods never reach employee payroll (#1997)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	beforeEach(async () => {
		harness.userId = "t1997p-owner";
		await seed();
	});
	afterAll(cleanup);

	it("exports only employee time to DATEV: the control in full, the converted person from the conversion on", async () => {
		const result = await startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });

		expect(result.success).toBe(true);
		const rows = String(result.success ? result.data.fileContent : "").split("\r\n");
		expect(rows.filter((row) => row.includes("CON-1"))).toEqual([]);
		expect(rows.filter((row) => row.includes("CNV-1"))).toEqual([
			'"CNV-1";"1000";2.00;"2026-07-15";""',
			'"CNV-1";"1000";3.00;"2026-07-20";""',
			'"CNV-1";"1900";0.50;"2026-07-20";"Überstundenauszahlung"',
			'"CNV-1";"2000";8.00;"2026-07-22";"Vacation"',
		]);
		expect(rows.filter((row) => row.includes("WRK-1"))).toEqual([
			'"WRK-1";"1900";1.00;"2026-07-10";"Überstundenauszahlung"',
			'"WRK-1";"1000";4.00;"2026-07-14";""',
			'"WRK-1";"2000";8.00;"2026-07-22";"Vacation"',
		]);
	});

	it("reads only employee time for settings and scheduled exports and payroll connectors", async () => {
		const workPeriods = await fetchWorkPeriodsForExport(ORG, julyFilters);
		const absences = await fetchAbsencesForExport(ORG, julyFilters);
		const payouts = await fetchOvertimePayoutsForExport(ORG, julyFilters);

		expect(
			workPeriods
				.map((row) => [
					row.employeeNumber,
					row.startTime.toInstant().toString(),
					row.durationMinutes,
				])
				.toSorted(),
		).toEqual([
			["CNV-1", CONVERTED_AT, 120],
			["CNV-1", "2026-07-20T08:00:00Z", 180],
			["WRK-1", "2026-07-14T07:00:00Z", 240],
		]);
		expect(absences.map((row) => [row.employeeNumber, row.startDate]).toSorted()).toEqual([
			["CNV-1", "2026-07-22"],
			["WRK-1", "2026-07-22"],
		]);
		expect(payouts.map((row) => [row.employeeNumber, row.day, row.minutes]).toSorted()).toEqual([
			["CNV-1", "2026-07-20", 30],
			["WRK-1", "2026-07-10", 60],
		]);
	});

	it("leaves an External Contractor out of a selection naming them", async () => {
		const workPeriods = await fetchWorkPeriodsForExport(ORG, {
			...julyFilters,
			employeeIds: [ids.contractor],
		});
		const payouts = await fetchOvertimePayoutsForExport(ORG, {
			...julyFilters,
			employeeIds: [ids.contractor],
		});

		expect(workPeriods).toEqual([]);
		expect(payouts).toEqual([]);
	});

	it("shows the Overview with employee time only and no blockers from contractor time", async () => {
		const summary = await getPayrollWorkspaceSummaryAction(july);

		expect(summary.success).toBe(true);
		if (!summary.success) return;
		const byId = new Map(summary.data.employees.map((row) => [row.id, row]));
		expect(byId.has(ids.contractor)).toBe(false);
		expect(byId.get(ids.worker)?.workedHours).toBe(4);
		expect(byId.get(ids.converted)?.workedHours).toBe(5);
		expect(
			byId.get(ids.converted)?.absenceDaysByCategory.map((row) => [row.categoryName, row.days]),
		).toEqual([["Vacation", 1]]);
		expect(summary.data.blockers.filter((blocker) => blocker.employeeId !== ids.owner)).toEqual([]);
	});

	describe("with scoped payroll collection", () => {
		beforeEach(async () => {
			await admin.query(
				`insert into payroll_work_collection_control (organization_id, mode) values ($1, 'active')
				 on conflict (organization_id) do update set mode = 'active', updated_at = now()`,
				[ORG],
			);
		});

		it("collects and exports only employee time, unblocked by open or pending contractor work", async () => {
			const result = await startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });

			expect(result).toMatchObject({ success: true });
			const rows = String(result.success ? result.data.fileContent : "").split("\r\n");
			expect(rows.filter((row) => row.includes("CON-1"))).toEqual([]);
			expect(rows.filter((row) => row.includes('"1000"'))).toEqual([
				'"CNV-1";"1000";2.00;"2026-07-15";""',
				'"CNV-1";"1000";3.00;"2026-07-20";""',
				'"WRK-1";"1000";4.00;"2026-07-14";""',
			]);
		});

		it("shows the Overview from collected employee time without contractor blockers", async () => {
			const summary = await getPayrollWorkspaceSummaryAction(july);

			expect(summary.success).toBe(true);
			if (!summary.success) return;
			const hours = Object.fromEntries(
				summary.data.employees.map((row) => [row.id, row.workedHours]),
			);
			expect(hours).toEqual({
				[ids.owner]: 0,
				[ids.worker]: 4,
				[ids.converted]: 5,
				[ids.holder]: 0,
			});
			expect(summary.data.blockers).toEqual([]);
		});
	});

	it("counts nobody in the export scope of a grant covering only an External Contractor", async () => {
		harness.userId = "t1997p-holder";

		const scope = await getPayrollExportScopeAction(july);
		const result = await startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });

		expect(scope).toEqual({ success: true, data: { employeeCount: 0 } });
		expect(result).toMatchObject({ success: false });
	});

	it("names no External Contractor and no contractor time in payroll readiness", async () => {
		const readiness = await getPayrollReadinessForWorkspaceAction(july);

		expect(readiness.success).toBe(true);
		if (!readiness.success) return;
		const affected = (id: string) =>
			readiness.data.groups
				.flatMap((group) => group.checks)
				.flatMap((check) =>
					check.affectedEmployees.some((row) => row.id === id) ? [check.id] : [],
				);
		expect(affected(ids.contractor)).toEqual([]);
		expect(affected(ids.converted)).toEqual(["missing-employment-history"]);
		// The control: an employee without terms is named.
		expect(affected(ids.worker)).toEqual(["missing-employment-history"]);
	});

	it("compares an export against its baseline with an External Contractor in the organization", async () => {
		const exported = await startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });
		expect(exported.success).toBe(true);
		const request = { startDate: july.startDate, endDate: july.endDate };

		const baselines = await listCompatiblePayrollBaselines(request);
		expect(baselines).toHaveLength(1);
		// The converted person's pending absence on a contractor day (9 July) and the contractor's
		// pending leave are no payroll input.
		const prepared = await preparePayrollComparison({
			baselineId: baselines[0]?.id ?? "",
			...request,
		});

		expect(prepared).toMatchObject({ status: "ready" });
	});

	it("shows only employee records in the Days side panel, a record across the conversion from it", async () => {
		const contractor = await getPayrollDayRecordsAction({
			employeeId: ids.contractor,
			date: "2026-07-14",
		});
		const contractorStint = await getPayrollDayRecordsAction({
			employeeId: ids.converted,
			date: "2026-07-10",
		});
		const conversionDay = await getPayrollDayRecordsAction({
			employeeId: ids.converted,
			date: "2026-07-15",
		});
		const control = await getPayrollDayRecordsAction({
			employeeId: ids.worker,
			date: "2026-07-14",
		});

		expect(contractor).toMatchObject({ success: true, data: { records: [] } });
		expect(contractorStint).toMatchObject({ success: true, data: { records: [] } });
		expect(conversionDay.success && conversionDay.data.records).toMatchObject([
			{ kind: "work", start: "2026-07-15T12:00", end: "2026-07-15T14:00", durationMinutes: 120 },
		]);
		expect(control.success && control.data.records).toMatchObject([
			{ kind: "work", start: "2026-07-14T09:00", end: "2026-07-14T13:00", durationMinutes: 240 },
		]);
	});

	it("prints only employee records on the PDF day sheets", async () => {
		const records = await readPeriodRecordsForEmployees(ORG, {
			employees: [
				{ id: ids.converted, timezone: "Europe/Berlin" },
				{ id: ids.contractor, timezone: "Europe/Berlin" },
			],
			startDate: july.startDate,
			endDate: july.endDate,
		});

		expect([...(records.get(ids.converted)?.keys() ?? [])]).toEqual(["2026-07-15", "2026-07-20"]);
		expect(records.get(ids.converted)?.get("2026-07-15")).toMatchObject([
			{ start: "2026-07-15T12:00", end: "2026-07-15T14:00", durationMinutes: 120 },
		]);
		expect(records.get(ids.contractor)?.size ?? 0).toBe(0);
	});

	it("carries only the days with employee time, so confirming the export never settles a contractor day", async () => {
		const days = await readExportCarriedDays({
			organizationId: ORG,
			startDate: july.startDate,
			endDate: july.endDate,
			employeeIds: [ids.converted, ids.worker, ids.contractor],
		});
		const dates = (employeeId: string) =>
			days.filter((day) => day.employeeId === employeeId).map((day) => day.date);

		expect(dates(ids.contractor)).toEqual([]);
		expect(dates(ids.converted)).toHaveLength(17);
		expect(dates(ids.converted)[0]).toBe("2026-07-15");
		expect(
			days.find((day) => day.employeeId === ids.converted && day.date === "2026-07-15")
				?.creditedMinutes,
		).toBe(120);
		// The control carries every day of the period.
		expect(dates(ids.worker)).toHaveLength(31);
	});

	it("lists no External Contractor's expenses in payroll-run readiness", async () => {
		await admin.query(
			`insert into travel_expense_settings (organization_id, reimbursement_channel, reimbursement_currency)
			 values ($1, 'payroll_run', 'EUR')`,
			[ORG],
		);
		await admin.query(
			"insert into travel_expense_payroll_run_preview_control (organization_id, mode) values ($1, 'active')",
			[ORG],
		);
		await approvedClaim(ids.worker);
		await approvedClaim(ids.contractor);

		const readiness = await getPayrollRunReadinessAction({ ...july, formatId: "datev_lohn" });

		expect(readiness.success).toBe(true);
		if (!readiness.success || !readiness.data.applies) throw new Error("Expected readiness");
		expect(readiness.data.entries.map((entry) => entry.employeeId)).toEqual([ids.worker]);
	});

	it("is not blocked by a departure clock repair of a timer that ran in a contractor stint", async () => {
		// The contractor stint's running timer, stopped at the conversion.
		await clockRepair(ids.converted, "2026-07-14T16:00:00Z", CONVERTED_AT);

		const workPeriods = await fetchWorkPeriodsForExport(ORG, julyFilters);

		expect(workPeriods.map((row) => row.employeeNumber).toSorted()).toEqual([
			"CNV-1",
			"CNV-1",
			"WRK-1",
		]);
	});

	it("is blocked by a departure clock repair of a timer that ran in employee time (control)", async () => {
		await clockRepair(ids.converted, "2026-07-20T12:00:00Z", "2026-07-20T16:00:00Z");

		await expect(fetchWorkPeriodsForExport(ORG, julyFilters)).rejects.toThrow(
			"unresolved offboarding clock-out",
		);
	});
});
