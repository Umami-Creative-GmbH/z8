/**
 * #1898: payroll files leave settled and changed-since-settled days out, against a
 * disposable PostgreSQL database. The exports run through the real export service;
 * only object storage and the queue are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadExport: async () => undefined,
	getPresignedUrl: async () => "https://exports.test/file",
}));
vi.mock("@/lib/queue", () => ({ addJob: async () => ({ id: "queued" }) }));

const { DateTime } = await import("luxon");
const { createExportJob, getExportJobHistory, processExportJob } =
	await import("@/lib/payroll-export/export-service");
const { settleDays } = await import("./settlement");
const { loadExportCarriedDays } = await import("./carried-days");
const { settledDaysFor } = await import("./settled-days-for");
const { db } = await import("@/db");

const admin = integrationAdminPool();
const ORG = "t1898-org";
const OTHER_ORG = "t1898-other";
const users = ["t1898-owner", "t1898-holder", "t1898-anna", "t1898-ben", "t1898-foreign"];
const ids = {
	owner: "d1898000-0000-4000-8000-000000000001",
	holder: "d1898000-0000-4000-8000-000000000002",
	anna: "d1898000-0000-4000-8000-000000000003",
	ben: "d1898000-0000-4000-8000-000000000004",
	foreign: "d1898000-0000-4000-8000-000000000005",
} as const;
const week = { startDate: "2026-11-09", endDate: "2026-11-15" };
const holder = { employeeId: ids.holder, userId: "t1898-holder", name: "Holder" };

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, OTHER_ORG]);
	await admin.query('delete from "user" where id = any($1::text[])', [users]);
}

async function employee(id: string, userId: string, organizationId: string, number: string) {
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, is_active, updated_at)
		 values ($1, $2, $3, 'employee', $4, true, now())`,
		[id, userId, organizationId, number],
	);
}

async function work(
	organizationId: string,
	employeeId: string,
	startAt: string,
	endAt: string,
	minutes: number,
) {
	const { rows } = await admin.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
		   duration_minutes, approval_state, origin, created_by, updated_by, updated_at)
		 values (gen_random_uuid(), $1, $2, 'work', $3, $4, $5, 'approved', 'manual',
		   't1898-owner', 't1898-owner', now()) returning id`,
		[organizationId, employeeId, startAt, endAt, minutes],
	);
	return rows[0].id as string;
}

/** An approved full-day canonical absence, encoded as the absence writers store it. */
async function approvedAbsence(employeeId: string, date: string, categoryId: string) {
	const { rows: record } = await admin.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
		   approval_state, origin, created_by, updated_at)
		 values (gen_random_uuid(), $1, $2, 'absence', $3::date,
		   ($3::date + interval '1 day' - interval '1 millisecond'), 'approved', 'manual',
		   't1898-owner', now()) returning id`,
		[ORG, employeeId, date],
	);
	await admin.query(
		`insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id)
		 values ($1, $2, 'absence', $3)`,
		[record[0].id, ORG, categoryId],
	);
}

async function exportConfig(organizationId: string) {
	await admin.query(
		`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
		 values ($1, 'datev_lohn', $2::jsonb, 't1898-owner', now())`,
		[
			organizationId,
			JSON.stringify({
				mandantennummer: "12345",
				beraternummer: "1234567",
				personnelNumberType: "employeeNumber",
				includeZeroHours: false,
			}),
		],
	);
}

let annaTuesdayWorkId = "";

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', '2026-01-01'), ($2, $2, $2, 'Europe/Berlin', '2026-01-01')`,
		[ORG, OTHER_ORG],
	);
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at)
		 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
		[users],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, updated_at)
		 values ($1, 't1898-owner', $2, 'admin', 'OWN-1', now())`,
		[ids.owner, ORG],
	);
	await employee(ids.holder, "t1898-holder", ORG, "HLD-1");
	await employee(ids.anna, "t1898-anna", ORG, "ANN-1");
	await employee(ids.ben, "t1898-ben", ORG, "BEN-1");
	await employee(ids.foreign, "t1898-foreign", OTHER_ORG, "FOR-1");
	await admin.query(
		`insert into member (id, organization_id, user_id, role, status, created_at)
		 values ('t1898-m-holder', $1, 't1898-holder', 'member', 'approved', now())`,
		[ORG],
	);
	// The holder's grant covers Anna.
	const { rows: grant } = await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'specific', 't1898-owner', now()) returning id`,
		[ORG, ids.holder],
	);
	await admin.query(
		`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
		 values ($1, $2, $3, 't1898-owner')`,
		[ORG, grant[0].id, ids.anna],
	);

	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at)
		 values ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()) on conflict (id) do nothing`,
	);
	await exportConfig(ORG);
	await exportConfig(OTHER_ORG);

	const { rows: category } = await admin.query(
		`insert into absence_category
		 (organization_id, type, name, color, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, 'vacation', 'Vacation', '#22c55e', true, true, true, now()) returning id`,
		[ORG],
	);
	await admin.query(
		`insert into payroll_wage_type_mapping
		   (organization_id, absence_category_id, wage_type_code, datev_wage_type_code, created_by, updated_at)
		 values ($1, $2, '1500', '1500', 't1898-owner', now())`,
		[ORG, category[0].id],
	);
	await admin.query(
		`insert into payroll_wage_type_mapping
		   (organization_id, special_category, wage_type_code, datev_wage_type_code, created_by, updated_at)
		 values ($1, 'overtime', '1900', '1900', 't1898-owner', now())`,
		[ORG],
	);

	// Anna: Monday 8 h, Tuesday 8 h, a Tuesday-night shift into Wednesday, vacation on Thursday.
	await work(ORG, ids.anna, "2026-11-09T08:00:00Z", "2026-11-09T16:00:00Z", 480);
	annaTuesdayWorkId = await work(
		ORG,
		ids.anna,
		"2026-11-10T08:00:00Z",
		"2026-11-10T16:00:00Z",
		480,
	);
	// 22:00–06:00 in Berlin: 2 h on Tuesday, 6 h on Wednesday.
	await work(ORG, ids.anna, "2026-11-10T21:00:00Z", "2026-11-11T05:00:00Z", 480);
	await approvedAbsence(ids.anna, "2026-11-12", category[0].id);
	// An overtime payout dated on a day that will be settled.
	await admin.query(
		`insert into balance_adjustment (organization_id, employee_id, kind, day, minutes, reason, recorded_by)
		 values ($1, $2, 'overtime_payout', '2026-11-10', -120, 'Paid out with the payroll', 't1898-owner')`,
		[ORG, ids.anna],
	);
	await work(ORG, ids.ben, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
	await work(OTHER_ORG, ids.foreign, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
}

/**
 * A DATEV file of the employees for the week. By default as the workspace prepares it;
 * `settledDays: undefined` exports it as the settings page and scheduled exports do.
 */
async function exportFile(
	employeeIds: string[],
	options: { settledDays?: "leave_out" | "include" } = { settledDays: "leave_out" },
) {
	const { jobId } = await createExportJob({
		organizationId: ORG,
		formatId: "datev_lohn",
		requestedById: ids.holder,
		filters: {
			dateRange: {
				start: DateTime.fromISO(week.startDate, { zone: "utc" }),
				end: DateTime.fromISO(week.endDate, { zone: "utc" }),
			},
			employeeIds,
		},
		...options,
	});
	const { result } = await processExportJob({ jobId, organizationId: ORG });
	const rows = (result?.supportedOutputEvidence?.rows ?? []).map((row) => ({
		personnelNumber: row.personnelNumber,
		date: row.date,
		wageTypeCode: row.wageTypeCode,
		quantity: row.quantity,
	}));
	const { rows: job } = await admin.query(
		"select settled_days_left_out, includes_settled_days from payroll_export_job where id = $1",
		[jobId],
	);
	return { jobId, rows, job: job[0] };
}

// The file dates a whole line by its start, so the night shift counts on Tuesday.
const annaWeek = [
	{ personnelNumber: "ANN-1", date: "2026-11-09", wageTypeCode: "1000", quantity: "8.00" },
	{ personnelNumber: "ANN-1", date: "2026-11-10", wageTypeCode: "1000", quantity: "16.00" },
	{ personnelNumber: "ANN-1", date: "2026-11-10", wageTypeCode: "1900", quantity: "2.00" },
	{ personnelNumber: "ANN-1", date: "2026-11-12", wageTypeCode: "1500", quantity: "8.00" },
];
const benWeek = [
	{ personnelNumber: "BEN-1", date: "2026-11-10", wageTypeCode: "1000", quantity: "8.00" },
];

async function settleAnna(startDate: string, endDate: string) {
	await settleDays(ORG, holder, { employeeIds: [ids.anna] }, { startDate, endDate });
}

describe("payroll files leave settled days out on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	beforeEach(seed);
	afterAll(cleanup);

	it("carries every day of the week while nothing is settled", async () => {
		const { rows, job } = await exportFile([ids.anna, ids.ben]);

		expect(rows).toEqual([...annaWeek, ...benWeek]);
		expect(job).toEqual({ settled_days_left_out: 0, includes_settled_days: false });
	});

	it("leaves out the work and absences of settled days, cutting a night shift at local midnight", async () => {
		await settleAnna("2026-11-10", "2026-11-10");
		await settleAnna("2026-11-12", "2026-11-12");

		const { jobId, rows, job } = await exportFile([ids.anna, ids.ben]);

		expect(rows).toEqual([
			annaWeek[0],
			// The overtime payout keeps its own safeguard and stays in the file.
			annaWeek[2],
			// Wednesday's part of the night shift, which the settled Tuesday did not pay.
			{ personnelNumber: "ANN-1", date: "2026-11-11", wageTypeCode: "1000", quantity: "6.00" },
			...benWeek,
		]);
		expect(job).toEqual({ settled_days_left_out: 2, includes_settled_days: false });
		// A confirmation of this file settles only what it paid.
		const carried = await loadExportCarriedDays(db, { organizationId: ORG, jobId });
		expect(carried.filter((day) => day.employeeId === ids.anna).map((day) => day.date)).toEqual([
			"2026-11-09",
			"2026-11-11",
			"2026-11-13",
			"2026-11-14",
			"2026-11-15",
		]);
	});

	it("also leaves out a day changed since it was settled", async () => {
		await settleAnna("2026-11-10", "2026-11-10");
		await admin.query("update time_record set end_at = $2, duration_minutes = 540 where id = $1", [
			annaTuesdayWorkId,
			"2026-11-10T17:00:00Z",
		]);

		const { rows, job } = await exportFile([ids.anna]);

		expect(rows.filter((row) => row.date === "2026-11-10" && row.wageTypeCode === "1000")).toEqual(
			[],
		);
		expect(job).toEqual({ settled_days_left_out: 1, includes_settled_days: false });
	});

	it("puts settled and changed days back when settled days are included", async () => {
		await settleAnna("2026-11-10", "2026-11-12");

		const { jobId, rows, job } = await exportFile([ids.anna, ids.ben], {
			settledDays: "include",
		});

		expect(rows).toEqual([...annaWeek, ...benWeek]);
		expect(job).toEqual({ settled_days_left_out: 0, includes_settled_days: true });
		const carried = await loadExportCarriedDays(db, { organizationId: ORG, jobId });
		expect(carried.filter((day) => day.employeeId === ids.anna)).toHaveLength(7);
		const [history] = await getExportJobHistory(ORG);
		expect(history).toMatchObject({ id: jobId, settledDaysLeftOut: 0, includesSettledDays: true });
	});

	it("keeps settled days in settings and scheduled exports, and records every day they carried", async () => {
		await settleAnna("2026-11-10", "2026-11-12");

		const { jobId, rows, job } = await exportFile([ids.anna, ids.ben], {});

		expect(rows).toEqual([...annaWeek, ...benWeek]);
		expect(job).toEqual({ settled_days_left_out: 0, includes_settled_days: false });
		const carried = await loadExportCarriedDays(db, { organizationId: ORG, jobId });
		expect(carried.filter((day) => day.employeeId === ids.anna)).toHaveLength(7);
	});

	it("shows the left-out count in the export history", async () => {
		await settleAnna("2026-11-09", "2026-11-11");

		const { jobId } = await exportFile([ids.anna]);

		const [history] = await getExportJobHistory(ORG);
		expect(history).toMatchObject({ id: jobId, settledDaysLeftOut: 3, includesSettledDays: false });
	});

	it("reads the settled days of the scope and period within the organization", async () => {
		await settleAnna("2026-11-08", "2026-11-10");

		expect(await settledDaysFor(ORG, { employeeIds: [ids.anna, ids.ben] }, week)).toEqual([
			{ employeeId: ids.anna, date: "2026-11-09", timezone: "Europe/Berlin" },
			{ employeeId: ids.anna, date: "2026-11-10", timezone: "Europe/Berlin" },
		]);
		expect(await settledDaysFor(OTHER_ORG, { employeeIds: [ids.anna] }, week)).toEqual([]);
	});
});
