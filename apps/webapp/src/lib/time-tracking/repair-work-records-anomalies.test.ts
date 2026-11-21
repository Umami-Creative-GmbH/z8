import { describe, expect, it, vi } from "vitest";
import {
	formatRepairWorkRecordsAnomalies,
	parseRepairWorkRecordsAnomaliesCommand,
	runRepairWorkRecordsAnomaliesCli,
} from "../../../scripts/repair-work-records-anomalies";
import type { OrganizationAnomalyRepairReport } from "./repair-work-records-anomalies";
import { pruneOrphanedWorkRecord } from "./work-records/prune-orphaned-records";
import { sealWorkTransactionScope } from "./work-transaction";

describe("repair-work-records-anomalies CLI", () => {
	const env = {
		POSTGRES_HOST: "localhost",
		POSTGRES_PORT: "5432",
		POSTGRES_DB: "z8",
		POSTGRES_USER: "z8",
		POSTGRES_PASSWORD: "secret",
	};

	it("defaults to dry-run across all three anomaly categories", () => {
		expect(parseRepairWorkRecordsAnomaliesCommand([])).toEqual({
			kind: "repair",
			apply: false,
			organizationId: null,
			categories: ["missing-end-at", "orphaned-pending", "unlinked-records"],
			json: false,
		});
	});

	it("parses --apply, --organization-id, --only, and --json", () => {
		expect(
			parseRepairWorkRecordsAnomaliesCommand([
				"--apply",
				"--organization-id",
				"org-1",
				"--only",
				"missing-end-at,orphaned-pending",
				"--json",
			]),
		).toEqual({
			kind: "repair",
			apply: true,
			organizationId: "org-1",
			categories: ["missing-end-at", "orphaned-pending"],
			json: true,
		});
	});

	it("rejects unknown --only categories", () => {
		expect(() => parseRepairWorkRecordsAnomaliesCommand(["--only", "bogus"])).toThrow(
			/Unknown category "bogus"/,
		);
	});

	it("formats dry-run and applied summaries clearly", () => {
		const reports: OrganizationAnomalyRepairReport[] = [
			{
				organizationId: "org-1",
				scanned: {
					"missing-end-at": 24,
					"orphaned-pending": 5,
					"unlinked-records": 402,
				},
				repaired: [
					{
						category: "missing-end-at",
						employeeId: "emp-1",
						workPeriodId: "wp-1",
						recordId: "wp-1",
						startAt: "2026-09-22T15:06:19.165Z",
						endAt: "2026-09-22T16:06:55.216Z",
						detail: "set time_record.end_at=2026-09-22T16:06:55.216Z (61m)",
					},
					{
						category: "orphaned-pending",
						employeeId: "emp-2",
						workPeriodId: "wp-2",
						recordId: "rec-2",
						startAt: "2026-05-11T08:00:00Z",
						endAt: "2026-05-11T16:00:00Z",
						detail: "set approval_status=approved, time_record.approval_state=approved, clear pending_changes",
					},
					{
						category: "unlinked-records",
						employeeId: "emp-3",
						workPeriodId: "wp-3",
						recordId: "rec-orphan",
						startAt: "2026-10-02T15:12:04.344Z",
						endAt: "2026-10-02T15:21:27.216Z",
						detail: "prune unlinked clock/approved duplicate",
					},
				],
				skipped: [
					{
						category: "unlinked-records",
						employeeId: "emp-4",
						recordId: "rec-keep",
						startAt: "2026-10-05T08:00:00Z",
						reason: "no_linked_replacement",
					},
				],
				failed: [],
			},
		];

		const dryRun = formatRepairWorkRecordsAnomalies(reports, false).join("\n");
		expect(dryRun).toContain("dry run");
		expect(dryRun).toContain("missing-end-at 1/24");
		expect(dryRun).toContain("orphaned-pending 1/5");
		expect(dryRun).toContain("unlinked-records 1/402");
		expect(dryRun).toContain("[missing-end-at] to repair record wp-1");
		expect(dryRun).toContain("[orphaned-pending] to repair record rec-2");
		expect(dryRun).toContain("skipped rec-keep");
		expect(dryRun).toContain("Nothing was changed.");

		const applied = formatRepairWorkRecordsAnomalies(reports, true).join("\n");
		expect(applied).toContain("applied");
		expect(applied).not.toContain("Nothing was changed.");
	});

	it("closes DB pool and exits with an error if any anomaly repair fails", async () => {
		const poolEnd = vi.fn(async () => undefined);
		const logged: string[] = [];
		const repair = vi.fn(async () => [
			{
				organizationId: "org-1",
				scanned: { "missing-end-at": 1, "orphaned-pending": 0, "unlinked-records": 0 },
				repaired: [],
				skipped: [],
				failed: [
					{
						category: "missing-end-at" as const,
						employeeId: "emp-1",
						workPeriodId: "wp-1",
						recordId: "wp-1",
						startAt: "2026-09-22T15:06:19.165Z",
						error: "db error",
					},
				],
			},
		]);

		await expect(
			runRepairWorkRecordsAnomaliesCli(["--apply", "--only", "missing-end-at"], env, {
				loadDatabase: async () => ({ pool: { end: poolEnd } }),
				repair,
				output: { log: (line) => logged.push(line) },
			}),
		).rejects.toThrow("1 anomaly repair failed");

		expect(repair).toHaveBeenCalledWith({
			apply: true,
			categories: ["missing-end-at"],
		});
		expect(poolEnd).toHaveBeenCalledOnce();
		expect(logged.join("\n")).toContain("failed wp-1");
	});
});

describe("pruneOrphanedWorkRecord safety guards", () => {
	function fakeScope(selectResults: unknown[][], deleteReturning: unknown[] = [{ id: "rec-1" }]) {
		let selectIndex = 0;
		const deleteFn = vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(async () => deleteReturning),
			})),
		}));
		const tx = {
			select: vi.fn(() => {
				const rows = selectResults[selectIndex++] ?? [];
				const chain = {
					from: () => chain,
					where: () => chain,
					for: async () => rows,
					limit: async () => rows,
				};
				return chain;
			}),
			delete: deleteFn,
		};
		const scope = sealWorkTransactionScope({
			db: tx as never,
			admission: "legacy" as const,
			assertEmployee: () => undefined,
		});
		return { scope, deleteFn };
	}

	const baseRecord = {
		id: "rec-1",
		startAt: new Date("2026-10-02T15:12:04.344Z"),
		endAt: new Date("2026-10-02T15:21:27.216Z"),
		approvalState: "pending",
		origin: "clock",
	};

	it("refuses to delete a record still referenced by a work_period", async () => {
		const { scope, deleteFn } = fakeScope([[baseRecord], [{ id: "wp-1" }]]);

		await expect(
			pruneOrphanedWorkRecord(scope, {
				organizationId: "org-1",
				employeeId: "emp-1",
				recordId: "rec-1",
			}),
		).resolves.toEqual({ kind: "still_referenced", by: "work_period" });
		expect(deleteFn).not.toHaveBeenCalled();
	});

	it("refuses to delete a record without a linked replacement work_period", async () => {
		const { scope, deleteFn } = fakeScope([[baseRecord], [], [], [], []]);

		await expect(
			pruneOrphanedWorkRecord(scope, {
				organizationId: "org-1",
				employeeId: "emp-1",
				recordId: "rec-1",
			}),
		).resolves.toEqual({ kind: "no_linked_replacement" });
		expect(deleteFn).not.toHaveBeenCalled();
	});
});
