/**
 * #1899: confirming a completed payroll export as paid, against a disposable
 * PostgreSQL database. The exports run through the real export service, which
 * records the employee-days each file carried; confirming settles exactly those
 * days with the values the file carried. Only object storage and the queue are
 * replaced.
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

const { parsePlainDate } = await import("@/lib/datetime/temporal-core");
const { createExportJob, processExportJob } = await import("@/lib/payroll-export/export-service");
const { readPeriod } = await import("./read-period");
const { settleDays, settlementHistory, unsettleDays } = await import("./settlement");
const { confirmExportAsPaid, listExportsToConfirm, previewConfirmExportAsPaid } =
	await import("./export-confirmation");

const admin = integrationAdminPool();
const ORG = "t1899-org";
const OTHER_ORG = "t1899-other";
const users = [
	"t1899-owner",
	"t1899-holder",
	"t1899-anna",
	"t1899-ben",
	"t1899-foreign",
	"t1899-cara",
];
const ids = {
	owner: "d1899000-0000-4000-8000-000000000001",
	holder: "d1899000-0000-4000-8000-000000000002",
	anna: "d1899000-0000-4000-8000-000000000003",
	ben: "d1899000-0000-4000-8000-000000000004",
	foreign: "d1899000-0000-4000-8000-000000000005",
	cara: "d1899000-0000-4000-8000-000000000006",
} as const;
const november = { startDate: "2026-11-01", endDate: "2026-11-30", label: "November 2026" };
const week = { startDate: "2026-11-09", endDate: "2026-11-15" };
const holder = { employeeId: ids.holder, userId: "t1899-holder", name: "Holder" };

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
		   't1899-owner', 't1899-owner', now()) returning id`,
		[organizationId, employeeId, startAt, endAt, minutes],
	);
	return rows[0].id as string;
}

/** An approved full-day canonical absence, encoded as the absence writers store it. */
async function approvedAbsence(organizationId: string, employeeId: string, date: string) {
	const { rows: category } = await admin.query(
		`insert into absence_category
		 (organization_id, type, name, color, requires_approval, counts_against_vacation, is_active, updated_at)
		 values ($1, 'vacation', 'Vacation', '#22c55e', true, true, true, now()) returning id`,
		[organizationId],
	);
	const { rows: record } = await admin.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
		   approval_state, origin, created_by, updated_at)
		 values (gen_random_uuid(), $1, $2, 'absence', $3::date,
		   ($3::date + interval '1 day' - interval '1 millisecond'), 'approved', 'manual',
		   't1899-owner', now()) returning id`,
		[organizationId, employeeId, date],
	);
	await admin.query(
		`insert into time_record_absence (record_id, organization_id, record_kind, absence_category_id)
		 values ($1, $2, 'absence', $3)`,
		[record[0].id, organizationId, category[0].id],
	);
	return category[0].id as string;
}

async function exportConfig(organizationId: string) {
	await admin.query(
		`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
		 values ($1, 'datev_lohn', $2::jsonb, 't1899-owner', now())`,
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

/** An effective departure whose last working day is `lastWorkingDay` (Europe/Berlin, winter). */
async function leftOn(employeeId: string, lastWorkingDay: string) {
	const cutoff = `${lastWorkingDay}T23:00:00Z`; // the next local midnight in winter time
	await admin.query("update employee set is_active = false where id = $1", [employeeId]);
	const { rows } = await admin.query(
		`insert into employee_employment_period
		   (organization_id, employee_id, status, started_at, ended_at, start_provenance)
		 values ($1, $2, 'closed', '2026-01-01T00:00:00Z', $3, 'recorded') returning id`,
		[ORG, employeeId, cutoff],
	);
	await admin.query(
		`insert into employee_departure
		   (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
		    cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
		 values ($1, $2, $3, 'scheduled', $4, 'Europe/Berlin', $5, 't1899-owner', gen_random_uuid(),
		         'test', 1, 'effective', $5)`,
		[ORG, employeeId, rows[0].id, lastWorkingDay, cutoff],
	);
}

let annaWorkId = "";
let vacationId = "";

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
		 values ($1, 't1899-owner', $2, 'admin', 'OWN-1', now())`,
		[ids.owner, ORG],
	);
	await employee(ids.holder, "t1899-holder", ORG, "HLD-1");
	await employee(ids.anna, "t1899-anna", ORG, "ANN-1");
	await employee(ids.ben, "t1899-ben", ORG, "BEN-1");
	await employee(ids.foreign, "t1899-foreign", OTHER_ORG, "FOR-1");
	await employee(ids.cara, "t1899-cara", ORG, "CAR-1");
	// An approved member: the grant then also covers its employees who left (#1894).
	await admin.query(
		`insert into member (id, organization_id, user_id, role, status, created_at)
		 values ('t1899-m-holder', $1, 't1899-holder', 'member', 'approved', now())`,
		[ORG],
	);

	// The holder's grant covers Anna and Cara.
	const { rows: grant } = await admin.query(
		`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
		 values ($1, $2, 'specific', 't1899-owner', now()) returning id`,
		[ORG, ids.holder],
	);
	await admin.query(
		`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
		 values ($1, $2, $3, 't1899-owner'), ($1, $2, $4, 't1899-owner')`,
		[ORG, grant[0].id, ids.anna, ids.cara],
	);

	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at)
		 values ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()) on conflict (id) do nothing`,
	);
	await exportConfig(ORG);
	await exportConfig(OTHER_ORG);

	annaWorkId = await work(ORG, ids.anna, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
	await work(ORG, ids.ben, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
	await work(OTHER_ORG, ids.foreign, "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
	vacationId = await approvedAbsence(ORG, ids.anna, "2026-11-12");
}

/** A completed DATEV file of the employees for the range, as the workspace exports it. */
async function exportFile(
	employeeIds: string[],
	range = week,
	organizationId: string = ORG,
	requestedById: string = ids.holder,
) {
	const { jobId } = await createExportJob({
		organizationId,
		formatId: "datev_lohn",
		requestedById,
		filters: {
			dateRange: {
				start: parsePlainDate(range.startDate),
				end: parsePlainDate(range.endDate),
			},
			employeeIds,
		},
		settledDays: "leave_out",
	});
	await processExportJob({ jobId, organizationId });
	return jobId;
}

async function annaDay(date: string) {
	const read = await readPeriod(ORG, holder, november);
	return read.employees[0]?.days.find((day) => day.date === date);
}

async function settledRowCount(organizationId = ORG) {
	const { rows } = await admin.query(
		"select count(*)::int as count from payroll_settled_day where organization_id = $1",
		[organizationId],
	);
	return rows[0].count as number;
}

describe("confirming a payroll export as paid on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	beforeEach(seed);
	afterAll(cleanup);

	it("settles exactly the employee-days the export carried, with the values it carried", async () => {
		const jobId = await exportFile([ids.anna]);
		// A correction after the file was made: the export paid 480 minutes, not 540.
		await admin.query("update time_record set end_at = $2, duration_minutes = 540 where id = $1", [
			annaWorkId,
			"2026-11-10T17:00:00Z",
		]);

		const result = await confirmExportAsPaid(ORG, holder, jobId);

		expect(result).toMatchObject({ status: "settled", alreadySettled: [] });
		expect(result.status === "settled" && result.newlySettled).toEqual(
			["09", "10", "11", "12", "13", "14", "15"].map((day) => ({
				employeeId: ids.anna,
				date: `2026-11-${day}`,
			})),
		);
		// The correction made after the file shows as changed since settled (#1897).
		expect((await annaDay("2026-11-10"))?.settlement).toMatchObject({
			state: "changed_since_settled",
			method: "export",
			payrollExportJobId: jobId,
			paid: { creditedMinutes: 480, absences: [] },
		});
		expect((await annaDay("2026-11-12"))?.settlement).toMatchObject({
			state: "settled",
			method: "export",
			paid: {
				creditedMinutes: 0,
				absences: [{ categoryId: vacationId, categoryType: "vacation", period: "full_day" }],
			},
		});
		expect((await annaDay("2026-11-16"))?.settlement).toEqual({ state: "unsettled" });
	});

	it("previews the newly settled, already settled and unclosed-month days without settling", async () => {
		const jobId = await exportFile([ids.anna]);
		// Settling by hand settles the days with entries: the 10th and the 12th.
		await settleDays(
			ORG,
			holder,
			{ employeeIds: [ids.anna] },
			{ startDate: "2026-11-10", endDate: "2026-11-12" },
		);

		const preview = await previewConfirmExportAsPaid(ORG, holder, jobId);

		expect(preview).toMatchObject({ status: "ready" });
		if (preview.status !== "ready") return;
		expect(preview.newlySettled).toHaveLength(5);
		expect(preview.alreadySettled).toEqual([
			{ employeeId: ids.anna, date: "2026-11-10" },
			{ employeeId: ids.anna, date: "2026-11-12" },
		]);
		expect(preview.inUnclosedMonths).toHaveLength(5);
		expect(await settledRowCount()).toBe(2);
	});

	it("settles nothing new when the export is confirmed again", async () => {
		const jobId = await exportFile([ids.anna]);
		await confirmExportAsPaid(ORG, holder, jobId);

		const again = await confirmExportAsPaid(ORG, holder, jobId);

		expect(again).toMatchObject({ status: "settled", newlySettled: [] });
		expect(again.status === "settled" && again.alreadySettled).toHaveLength(7);
		expect(await settledRowCount()).toBe(7);
	});

	it("does not settle again a day whose settlement from the same export was unsettled", async () => {
		const jobId = await exportFile([ids.anna]);
		await confirmExportAsPaid(ORG, holder, jobId);
		await unsettleDays(
			ORG,
			holder,
			[{ employeeId: ids.anna, date: "2026-11-10" }],
			"Paid the wrong hours",
		);

		const preview = await previewConfirmExportAsPaid(ORG, holder, jobId);
		const again = await confirmExportAsPaid(ORG, holder, jobId);

		const tuesday = [{ employeeId: ids.anna, date: "2026-11-10" }];
		expect(preview).toMatchObject({
			status: "ready",
			newlySettled: [],
			previouslyUnsettled: tuesday,
		});
		expect(preview.status === "ready" && preview.alreadySettled).toHaveLength(6);
		expect(again).toMatchObject({
			status: "settled",
			newlySettled: [],
			previouslyUnsettled: tuesday,
		});
		expect((await annaDay("2026-11-10"))?.settlement).toEqual({ state: "unsettled" });
		expect(await settledRowCount()).toBe(7);
	});

	it("records the export as the settling method in the history", async () => {
		const jobId = await exportFile([ids.anna]);
		await confirmExportAsPaid(ORG, holder, jobId);

		const history = await settlementHistory(
			ORG,
			holder,
			{ employeeIds: [ids.anna] },
			{ startDate: "2026-11-10", endDate: "2026-11-10" },
		);

		expect(history).toMatchObject([
			{
				employeeId: ids.anna,
				date: "2026-11-10",
				kind: "settled",
				method: "export",
				payrollExportJobId: jobId,
				actorUserId: "t1899-holder",
				paid: { creditedMinutes: 480, absences: [] },
			},
		]);
	});

	it("rejects an export that is not completed", async () => {
		const failed = await exportFile([ids.anna]);
		await admin.query("update payroll_export_job set status = 'failed' where id = $1", [failed]);
		const pending = await exportFile([ids.anna]);
		await admin.query("update payroll_export_job set status = 'pending' where id = $1", [pending]);

		expect(await confirmExportAsPaid(ORG, holder, failed)).toEqual({ status: "not_completed" });
		expect(await confirmExportAsPaid(ORG, holder, pending)).toEqual({ status: "not_completed" });
		expect(await previewConfirmExportAsPaid(ORG, holder, failed)).toEqual({
			status: "not_completed",
		});
		expect(await settledRowCount()).toBe(0);
	});

	it("keeps exports inside their organization", async () => {
		const foreignJob = await exportFile([ids.foreign], week, OTHER_ORG, ids.foreign);

		expect(await confirmExportAsPaid(ORG, holder, foreignJob)).toEqual({ status: "not_found" });
		expect(await confirmExportAsPaid(ORG, holder, "not-a-uuid")).toEqual({ status: "not_found" });
		expect(await confirmExportAsPaid(OTHER_ORG, holder, foreignJob)).toMatchObject({
			status: "out_of_scope",
		});
		expect(await settledRowCount(OTHER_ORG)).toBe(0);
	});

	it("rejects an export that carried employees outside the grant, settling nothing", async () => {
		const jobId = await exportFile([ids.anna, ids.ben]);

		const result = await confirmExportAsPaid(ORG, holder, jobId);

		expect(result).toEqual({ status: "out_of_scope", employeeIds: [ids.ben] });
		expect(await settledRowCount()).toBe(0);
	});

	it("settles an employee of the grant who left, up to the last working day", async () => {
		await leftOn(ids.cara, "2026-11-11");
		await work(ORG, ids.cara, "2026-11-10T08:00:00Z", "2026-11-10T12:00:00Z", 240);
		const jobId = await exportFile([ids.anna, ids.cara]);

		const result = await confirmExportAsPaid(ORG, holder, jobId);

		expect(
			result.status === "settled" &&
				result.newlySettled.filter((day) => day.employeeId === ids.cara),
		).toEqual([
			{ employeeId: ids.cara, date: "2026-11-09" },
			{ employeeId: ids.cara, date: "2026-11-10" },
			{ employeeId: ids.cara, date: "2026-11-11" },
		]);
	});

	it("lists the grant's completed exports with how many of their days are settled", async () => {
		const jobId = await exportFile([ids.anna]);
		await exportFile([ids.anna, ids.ben]);
		await settleDays(
			ORG,
			holder,
			{ employeeIds: [ids.anna] },
			{ startDate: "2026-11-10", endDate: "2026-11-10" },
		);

		const before = await listExportsToConfirm(ORG, holder);
		await confirmExportAsPaid(ORG, holder, jobId);
		const after = await listExportsToConfirm(ORG, holder);

		expect(before).toMatchObject([
			{ jobId, startDate: week.startDate, endDate: week.endDate, carriedDays: 7, settledDays: 1 },
		]);
		expect(after).toMatchObject([{ jobId, carriedDays: 7, settledDays: 7 }]);
	});
});
