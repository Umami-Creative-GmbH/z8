/**
 * #1001, #1050: overtime payouts in the DATEV and SAP SuccessFactors CSV
 * payroll files, against a disposable
 * PostgreSQL database. Payouts are balance adjustments (#993) read at
 * processing time; the export runs through the real export service. Only
 * object storage is replaced.
 */

import { DateTime } from "luxon";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl: async () => "https://example.test/export",
	uploadExport: async () => undefined,
}));

const { createExportJob, getExportJobHistory, processExportJob, unmappedOvertimePayoutsForExport } =
	await import("./export-service");

const admin = integrationAdminPool();
const ORG = "t1001-org";
const OTHER_ORG = "t1001-other";
const users = ["t1001-owner", "t1001-worker", "t1001-peer", "t1001-foreign"];
const ids = {
	owner: "d1001000-0000-4000-8000-000000000001",
	worker: "d1001000-0000-4000-8000-000000000002",
	peer: "d1001000-0000-4000-8000-000000000003",
	foreign: "d1001000-0000-4000-8000-000000000004",
} as const;

const DATEV = {
	mandantennummer: "12345",
	beraternummer: "1234567",
	personnelNumberType: "employeeNumber",
	includeZeroHours: false,
};
const HEADER = '"Personalnummer";"Lohnart";"Betrag";"Datum";"Bemerkung"';
const SUCCESSFACTORS = { employeeMatchStrategy: "userId", includeZeroHours: false };
const SF_HEADER = '﻿"User ID";"Date";"Time Type";"Hours";"Comment"';

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, OTHER_ORG]);
	await admin.query('delete from "user" where id = any($1::text[])', [users]);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ($1, $1, $1, 'Europe/Berlin', now()), ($2, $2, $2, 'Europe/Berlin', now())`,
		[ORG, OTHER_ORG],
	);
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at)
		 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
		[users],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, updated_at) values
		 ($1, 't1001-owner', $5, 'admin', 'OWN-1', now()),
		 ($2, 't1001-worker', $5, 'employee', 'WRK-1', now()),
		 ($3, 't1001-peer', $5, 'employee', 'PER-1', now()),
		 ($4, 't1001-foreign', $6, 'employee', 'FOR-1', now())`,
		[ids.owner, ids.worker, ids.peer, ids.foreign, ORG, OTHER_ORG],
	);
	await admin.query(
		`insert into payroll_export_format (id, name, version, updated_at) values
		 ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()),
		 ('successfactors_csv', 'SAP SuccessFactors (CSV)', '1.0.0', now())
		 on conflict (id) do nothing`,
	);
	await admin.query(
		`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
		 values ($1, 'datev_lohn', $2::jsonb, 't1001-owner', now()),
		        ($1, 'successfactors_csv', $3::jsonb, 't1001-owner', now())`,
		[ORG, JSON.stringify(DATEV), JSON.stringify(SUCCESSFACTORS)],
	);
}

async function mapOvertime(
	datevCode: string | null,
	codes: { sage?: string; successFactors?: string } = {},
) {
	await admin.query(
		`insert into payroll_wage_type_mapping
		   (organization_id, special_category, wage_type_code, datev_wage_type_code, lexware_wage_type_code,
		    sage_wage_type_code, successfactors_time_type_code, created_by, updated_at)
		 values ($1, 'overtime', $2, $3, 'LX-OT', $4, $5, 't1001-owner', now())`,
		[ORG, datevCode ?? "LX-OT", datevCode, codes.sage ?? null, codes.successFactors ?? null],
	);
}

async function adjustment(input: {
	organizationId?: string;
	employeeId: string;
	kind?: "overtime_payout" | "opening_balance";
	day: string;
	minutes: number;
	cancelled?: boolean;
}): Promise<string> {
	const { rows } = await admin.query(
		`insert into balance_adjustment (organization_id, employee_id, kind, day, minutes, reason, recorded_by)
		 values ($1, $2, $3, $4, $5, 'Paid out with the payroll', 't1001-owner') returning id`,
		[
			input.organizationId ?? ORG,
			input.employeeId,
			input.kind ?? "overtime_payout",
			input.day,
			input.minutes,
		],
	);
	if (input.cancelled) {
		await admin.query(
			`update balance_adjustment
			 set cancelled_at = now(), cancelled_by = 't1001-owner', cancellation_reason = 'Recorded twice'
			 where id = $1`,
			[rows[0].id],
		);
	}
	return rows[0].id;
}

async function exportJuly(employeeIds?: string[], formatId = "datev_lohn") {
	const { jobId } = await createExportJob({
		organizationId: ORG,
		formatId,
		requestedById: ids.owner,
		filters: {
			dateRange: {
				start: DateTime.fromISO("2026-07-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-07-31", { zone: "utc" }),
			},
			employeeIds,
		},
	});
	const { result } = await processExportJob({ jobId, organizationId: ORG });
	return { jobId, result, rows: String(result?.content ?? "").split("\r\n") };
}

describe("overtime payouts in payroll files on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	beforeEach(seed);
	afterAll(cleanup);

	it("exports each uncancelled payout dated in the range under the mapped wage type, and nothing else", async () => {
		await mapOvertime("1900");
		await adjustment({ employeeId: ids.worker, day: "2026-07-15", minutes: -300 });
		await adjustment({ employeeId: ids.worker, day: "2026-07-01", minutes: -60 });
		await adjustment({ employeeId: ids.worker, day: "2026-07-31", minutes: -30 });
		// Not exported: cancelled, outside the range, an opening balance, another organization.
		await adjustment({ employeeId: ids.worker, day: "2026-07-16", minutes: -120, cancelled: true });
		await adjustment({ employeeId: ids.worker, day: "2026-06-30", minutes: -45 });
		await adjustment({ employeeId: ids.worker, day: "2026-08-01", minutes: -45 });
		await adjustment({
			employeeId: ids.worker,
			kind: "opening_balance",
			day: "2026-06-01",
			minutes: 600,
		});
		await adjustment({
			organizationId: OTHER_ORG,
			employeeId: ids.foreign,
			day: "2026-07-15",
			minutes: -300,
		});

		const { rows, result } = await exportJuly();

		expect(rows).toEqual([
			HEADER,
			'"WRK-1";"1900";1.00;"2026-07-01";"Überstundenauszahlung"',
			'"WRK-1";"1900";5.00;"2026-07-15";"Überstundenauszahlung"',
			'"WRK-1";"1900";0.50;"2026-07-31";"Überstundenauszahlung"',
		]);
		expect(result?.metadata.unmappedOvertimePayouts).toEqual([]);
	});

	it("exports only the payouts of the employees the export is restricted to", async () => {
		await mapOvertime("1900");
		await adjustment({ employeeId: ids.worker, day: "2026-07-15", minutes: -300 });
		await adjustment({ employeeId: ids.peer, day: "2026-07-15", minutes: -180 });

		const scoped = await exportJuly([ids.worker]);
		const everyone = await exportJuly();

		expect(scoped.rows).toEqual([
			HEADER,
			'"WRK-1";"1900";5.00;"2026-07-15";"Überstundenauszahlung"',
		]);
		expect(everyone.rows).toEqual([
			HEADER,
			'"PER-1";"1900";3.00;"2026-07-15";"Überstundenauszahlung"',
			'"WRK-1";"1900";5.00;"2026-07-15";"Überstundenauszahlung"',
		]);
	});

	it("without a DATEV code for overtime, emits no line and records the payouts as unmapped on the job", async () => {
		await mapOvertime(null);
		const payoutId = await adjustment({ employeeId: ids.worker, day: "2026-07-15", minutes: -300 });

		const { jobId, rows, result } = await exportJuly();

		expect(rows).toEqual([HEADER]);
		const unmapped = [{ id: payoutId, employeeId: ids.worker, day: "2026-07-15", minutes: 300 }];
		expect(result?.metadata.unmappedOvertimePayouts).toEqual(unmapped);
		const { rows: jobs } = await admin.query(
			"select status, unmapped_overtime_payouts from payroll_export_job where id = $1",
			[jobId],
		);
		expect(jobs).toEqual([{ status: "completed", unmapped_overtime_payouts: unmapped }]);
		const [summary] = await getExportJobHistory(ORG);
		expect(summary).toMatchObject({ id: jobId, unmappedOvertimePayoutCount: 1 });
	});
});

describe("overtime payouts in the SAP SuccessFactors CSV file on PostgreSQL (#1050)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	beforeEach(seed);
	afterAll(cleanup);

	const exportSuccessFactors = (employeeIds?: string[]) =>
		exportJuly(employeeIds, "successfactors_csv");

	it("exports each uncancelled payout dated in the range under the mapped time type, and nothing else", async () => {
		await mapOvertime("1900", { successFactors: "OT_PAY" });
		await adjustment({ employeeId: ids.worker, day: "2026-07-15", minutes: -300 });
		await adjustment({ employeeId: ids.worker, day: "2026-07-01", minutes: -60 });
		// Not exported: cancelled, outside the range, an opening balance, another organization.
		await adjustment({ employeeId: ids.worker, day: "2026-07-16", minutes: -120, cancelled: true });
		await adjustment({ employeeId: ids.worker, day: "2026-06-30", minutes: -45 });
		await adjustment({ employeeId: ids.worker, day: "2026-08-01", minutes: -45 });
		await adjustment({
			employeeId: ids.worker,
			kind: "opening_balance",
			day: "2026-06-01",
			minutes: 600,
		});
		await adjustment({
			organizationId: OTHER_ORG,
			employeeId: ids.foreign,
			day: "2026-07-15",
			minutes: -300,
		});

		const { rows, result } = await exportSuccessFactors();

		expect(rows).toEqual([
			SF_HEADER,
			'"WRK-1";"2026-07-01";"OT_PAY";"1.00";"Overtime payout"',
			'"WRK-1";"2026-07-15";"OT_PAY";"5.00";"Overtime payout"',
		]);
		expect(result?.metadata.unmappedOvertimePayouts).toEqual([]);
		expect(result?.metadata.dateRange).toEqual({ start: "2026-07-01", end: "2026-07-15" });
	});

	it("exports only the payouts of the employees the export is restricted to", async () => {
		await mapOvertime("1900", { successFactors: "OT_PAY" });
		await adjustment({ employeeId: ids.worker, day: "2026-07-15", minutes: -300 });
		await adjustment({ employeeId: ids.peer, day: "2026-07-15", minutes: -180 });

		const scoped = await exportSuccessFactors([ids.worker]);

		expect(scoped.rows).toEqual([
			SF_HEADER,
			'"WRK-1";"2026-07-15";"OT_PAY";"5.00";"Overtime payout"',
		]);
	});

	it("without a SuccessFactors code for overtime, writes no payout row and records the payouts as unmapped", async () => {
		// Codes for DATEV, Lexware and Sage: SuccessFactors never borrows another format's code.
		await mapOvertime("1900", { sage: "2900" });
		const payoutId = await adjustment({ employeeId: ids.worker, day: "2026-07-15", minutes: -300 });
		const filters = {
			dateRange: {
				start: DateTime.fromISO("2026-07-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-07-31", { zone: "utc" }),
			},
		};
		const unmapped = [{ id: payoutId, employeeId: ids.worker, day: "2026-07-15", minutes: 300 }];

		await expect(
			unmappedOvertimePayoutsForExport(ORG, "successfactors_csv", filters),
		).resolves.toEqual(unmapped);
		const { jobId, rows, result } = await exportSuccessFactors();

		expect(rows).toEqual([SF_HEADER]);
		expect(result?.metadata.unmappedOvertimePayouts).toEqual(unmapped);
		const { rows: jobs } = await admin.query(
			"select status, unmapped_overtime_payouts from payroll_export_job where id = $1",
			[jobId],
		);
		expect(jobs).toEqual([{ status: "completed", unmapped_overtime_payouts: unmapped }]);
		const [summary] = await getExportJobHistory(ORG);
		expect(summary).toMatchObject({ id: jobId, unmappedOvertimePayoutCount: 1 });
	});
});
