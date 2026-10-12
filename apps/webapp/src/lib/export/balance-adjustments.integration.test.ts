/**
 * #1003 (spec #804): the organization data export carries every balance
 * adjustment of the organization, opening balances and overtime payouts,
 * cancelled ones with their cancellation, and the absence category property
 * "draws on work balance". Runs against PostgreSQL.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
}));

const { fetchExportData } = await import("./data-fetchers");
const { buildExportFiles } = await import("./zip-builder");

const ids = {
	organization: "t1003-org",
	other: "t1003-other-org",
	admin: "t1003-admin",
	payroll: "t1003-payroll",
	worker: "t1003-worker",
	otherOwner: "t1003-other-owner",
	otherWorker: "t1003-other-worker",
	adminEmployee: "10030000-0000-4000-8000-0000000000e1",
	workerEmployee: "10030000-0000-4000-8000-0000000000e2",
	otherWorkerEmployee: "10030000-0000-4000-8000-0000000000e3",
	openingBalance: "10030000-0000-4000-8000-0000000000a1",
	payout: "10030000-0000-4000-8000-0000000000a2",
	cancelledPayout: "10030000-0000-4000-8000-0000000000a3",
	otherPayout: "10030000-0000-4000-8000-0000000000a4",
	toilCategory: "10030000-0000-4000-8000-0000000000c1",
	vacationCategory: "10030000-0000-4000-8000-0000000000c2",
	otherCategory: "10030000-0000-4000-8000-0000000000c3",
} as const;
const users = [ids.admin, ids.payroll, ids.worker, ids.otherOwner, ids.otherWorker];

const requester = { exportId: "t1003-export", requestedByEmployeeId: ids.adminEmployee };

describe("balance adjustments in the organization data export on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	function exportFile(data: Record<string, unknown>, name: string) {
		const file = buildExportFiles(ids.organization, data).find((entry) => entry.name === name);
		if (!file) throw new Error(`missing ${name}`);
		return file.content;
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T1003', $1, 'Europe/Berlin', now()), ($2, 'T1003 other', $2, 'UTC', now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, first_name, last_name, email, created_at, updated_at) values
			 ($1, 'Ada Admin', 'Ada', 'Admin', 't1003-admin@example.test', now(), now()),
			 ($2, 'Pia Payroll', 'Pia', 'Payroll', 't1003-payroll@example.test', now(), now()),
			 ($3, 'Wim Worker', 'Wim', 'Worker', 't1003-worker@example.test', now(), now()),
			 ($4, 'Otto Owner', 'Otto', 'Owner', 't1003-other-owner@example.test', now(), now()),
			 ($5, 'Fay Foreign', 'Fay', 'Foreign', 't1003-other-worker@example.test', now(), now())`,
			users,
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, employee_number, updated_at) values
			 ($1, $2, $3, 'admin', 'A-1', now()),
			 ($4, $5, $3, 'employee', 'W-7', now()),
			 ($6, $7, $8, 'employee', 'F-1', now())`,
			[
				ids.adminEmployee,
				ids.admin,
				ids.organization,
				ids.workerEmployee,
				ids.worker,
				ids.otherWorkerEmployee,
				ids.otherWorker,
				ids.other,
			],
		);
		await admin.query(
			`insert into balance_adjustment
			 (id, organization_id, employee_id, kind, day, minutes, reason, recorded_by, recorded_at,
			  cancelled_at, cancelled_by, cancellation_reason) values
			 ($1, $5, $6, 'opening_balance', '2025-10-31', 840, 'Carried over from the old tool, 2024',
			  $7, '2025-11-03T09:15:00Z', null, null, null),
			 ($2, $5, $6, 'overtime_payout', '2026-01-31', -300, 'Paid with the January salary',
			  $8, '2026-02-02T10:00:00Z', null, null, null),
			 ($3, $5, $6, 'overtime_payout', '2026-02-28', -120, 'Paid with the February salary',
			  $8, '2026-03-02T10:00:00Z', '2026-03-03T08:30:00Z', $7, 'Recorded twice, "duplicate"'),
			 ($4, $9, $10, 'overtime_payout', '2026-01-31', -60, 'Foreign payout',
			  $11, '2026-02-02T10:00:00Z', null, null, null)`,
			[
				ids.openingBalance,
				ids.payout,
				ids.cancelledPayout,
				ids.otherPayout,
				ids.organization,
				ids.workerEmployee,
				ids.admin,
				ids.payroll,
				ids.other,
				ids.otherWorkerEmployee,
				ids.otherOwner,
			],
		);
	});
	afterAll(cleanup);

	it("exports every adjustment of the organization, cancelled ones with their cancellation", async () => {
		const data = await fetchExportData(ids.organization, ["balance_adjustments"], requester);

		expect(exportFile(data, "balance_adjustments.csv").split("\n")).toEqual([
			"id,employeeId,employeeNumber,employeeName,kind,day,minutes,reason,recordedBy,recordedByName,recordedAt,cancelledBy,cancelledByName,cancelledAt,cancellationReason",
			`${ids.openingBalance},${ids.workerEmployee},W-7,Wim Worker,opening_balance,2025-10-31,840,"Carried over from the old tool, 2024",${ids.admin},Ada Admin,2025-11-03T09:15:00.000Z,,,,`,
			`${ids.payout},${ids.workerEmployee},W-7,Wim Worker,overtime_payout,2026-01-31,-300,Paid with the January salary,${ids.payroll},Pia Payroll,2026-02-02T10:00:00.000Z,,,,`,
			`${ids.cancelledPayout},${ids.workerEmployee},W-7,Wim Worker,overtime_payout,2026-02-28,-120,Paid with the February salary,${ids.payroll},Pia Payroll,2026-03-02T10:00:00.000Z,${ids.admin},Ada Admin,2026-03-03T08:30:00.000Z,"Recorded twice, ""duplicate"""`,
		]);
	});

	it("exports only the exporting organization's adjustments", async () => {
		const data = await fetchExportData(ids.other, ["balance_adjustments"], {
			exportId: "t1003-other-export",
			requestedByEmployeeId: ids.otherWorkerEmployee,
		});
		const lines = exportFile(data, "balance_adjustments.csv").split("\n");

		expect(lines).toHaveLength(2);
		expect(lines[1]).toMatch(new RegExp(`^${ids.otherPayout},${ids.otherWorkerEmployee},F-1,`));
	});

	it("keeps an adjustment whose recorder was deleted, without the recorder", async () => {
		await admin.query('delete from "user" where id = $1', [ids.payroll]);

		const data = await fetchExportData(ids.organization, ["balance_adjustments"], requester);

		expect(exportFile(data, "balance_adjustments.csv").split("\n")[2]).toBe(
			`${ids.payout},${ids.workerEmployee},W-7,Wim Worker,overtime_payout,2026-01-31,-300,Paid with the January salary,,,2026-02-02T10:00:00.000Z,,,,`,
		);
	});

	it("exports the absence categories with whether they draw on the work balance", async () => {
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_work_time, counts_against_vacation,
			  draws_on_work_balance, updated_at) values
			 ($1, $4, 'time_off_in_lieu', 'Time off in lieu', false, false, true, now()),
			 ($2, $4, 'vacation', 'Vacation', false, true, false, now()),
			 ($3, $5, 'time_off_in_lieu', 'Foreign time off', false, false, true, now())`,
			[ids.toilCategory, ids.vacationCategory, ids.otherCategory, ids.organization, ids.other],
		);

		const data = await fetchExportData(ids.organization, ["absences"], requester);
		const file = JSON.parse(exportFile(data, "absences_categories.json")) as {
			data: { id: string; drawsOnWorkBalance: boolean }[];
		};

		expect(
			file.data
				.map(({ id, drawsOnWorkBalance }) => ({ id, drawsOnWorkBalance }))
				.sort((a, b) => a.id.localeCompare(b.id)),
		).toEqual([
			{ id: ids.toilCategory, drawsOnWorkBalance: true },
			{ id: ids.vacationCategory, drawsOnWorkBalance: false },
		]);
	});
});
