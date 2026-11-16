import { describe, expect, it, vi } from "vitest";
import {
	parseRepairInboxSurchargesCommand,
	runRepairInboxSurchargesCli,
} from "../../../scripts/repair-inbox-decision-surcharges";
import type { InboxDecisionSurchargeRepairReport } from "./inbox-decision-repair";

const DATABASE_ENVIRONMENT = {
	POSTGRES_HOST: "127.0.0.1",
	POSTGRES_PORT: "5432",
	POSTGRES_DB: "z8",
	POSTGRES_USER: "z8",
	POSTGRES_PASSWORD: "secret",
};

const CLEAN: InboxDecisionSurchargeRepairReport = {
	organizationId: "org-b",
	decided: 4,
	approvedRepairs: 2,
	rejectedRepairs: 1,
	unchanged: 1,
	skipped: [],
	failed: [],
};

const NEEDS_ATTENTION: InboxDecisionSurchargeRepairReport = {
	organizationId: "org-a",
	decided: 3,
	approvedRepairs: 0,
	rejectedRepairs: 0,
	unchanged: 1,
	skipped: [{ workPeriodId: "period-1", reason: "changed_since_decision" }],
	failed: [{ workPeriodId: "period-2", error: "Surcharge reconciliation failed" }],
};

function captureOutput() {
	const lines: string[] = [];
	return { lines, output: { log: (line: string) => lines.push(line) } };
}

const connected = (end = vi.fn(async () => undefined)) => ({
	loadDatabase: async () => ({ pool: { end } }),
});

describe("repair inbox decision surcharges CLI (#1690)", () => {
	it("is a dry run unless --apply is given, for every organization or only the one named", () => {
		expect(parseRepairInboxSurchargesCommand([])).toEqual({
			kind: "repair",
			organizationId: null,
			json: false,
			apply: false,
		});
		expect(
			parseRepairInboxSurchargesCommand(["--apply", "--organization-id", "org-a", "--json"]),
		).toEqual({ kind: "repair", organizationId: "org-a", json: true, apply: true });
		expect(parseRepairInboxSurchargesCommand(["--help"])).toEqual({ kind: "help" });
		expect(() => parseRepairInboxSurchargesCommand(["--organization-id", "--json"])).toThrow(
			"--organization-id",
		);
		expect(() => parseRepairInboxSurchargesCommand(["--apply", "--apply"])).toThrow("Duplicate");
		expect(() => parseRepairInboxSurchargesCommand(["--dry-run=false"])).toThrow();
	});

	it("shows help without a connection and requires the database environment", async () => {
		const loadDatabase = vi.fn();
		const { lines, output } = captureOutput();
		await runRepairInboxSurchargesCli(["--help"], {}, { loadDatabase, output });
		expect(loadDatabase).not.toHaveBeenCalled();
		expect(lines.join("\n")).toContain("pnpm surcharges:repair-inbox-decisions");

		await expect(runRepairInboxSurchargesCli([], {}, { loadDatabase })).rejects.toThrow(
			"Missing required environment variable POSTGRES_HOST",
		);
		expect(loadDatabase).not.toHaveBeenCalled();
	});

	it("dry run reports the counts per organization and says nothing was changed", async () => {
		const end = vi.fn(async () => undefined);
		const repair = vi.fn(async () => [CLEAN]);
		const { lines, output } = captureOutput();

		await runRepairInboxSurchargesCli(["--organization-id", "org-b"], DATABASE_ENVIRONMENT, {
			...connected(end),
			repair,
			output,
		});

		expect(repair).toHaveBeenCalledWith({ organizationIds: ["org-b"], apply: false });
		expect(end).toHaveBeenCalledOnce();
		expect(lines).toEqual([
			"Organization org-b (dry run): decided 4, approved to repair 2, rejected to repair 1, unchanged 1, skipped 0, failed 0",
			"",
			"Total over 1 organizations (dry run): approved to repair 2, rejected to repair 1, unchanged 1, skipped 0, failed 0",
			"Nothing was changed. Review the report, then run again with --apply.",
		]);
	});

	it("applies with --apply, lists skipped and failed periods, and fails when one failed", async () => {
		const repair = vi.fn(async () => [NEEDS_ATTENTION, CLEAN]);
		const { lines, output } = captureOutput();

		await expect(
			runRepairInboxSurchargesCli(["--apply"], DATABASE_ENVIRONMENT, {
				...connected(),
				repair,
				output,
			}),
		).rejects.toThrow("1 work period was not repaired");
		expect(repair).toHaveBeenCalledWith({ apply: true });
		expect(lines).toEqual([
			"Organization org-a (applied): decided 3, approved repaired 0, rejected repaired 0, unchanged 1, skipped 1, failed 1",
			"    skipped period-1: changed_since_decision",
			"    failed period-2: Surcharge reconciliation failed",
			"Organization org-b (applied): decided 4, approved repaired 2, rejected repaired 1, unchanged 1, skipped 0, failed 0",
			"",
			"Total over 2 organizations (applied): approved repaired 2, rejected repaired 1, unchanged 2, skipped 1, failed 1",
		]);
	});

	it("prints JSON for recorded evidence and closes the pool when the run fails", async () => {
		const { lines, output } = captureOutput();
		await runRepairInboxSurchargesCli(["--json"], DATABASE_ENVIRONMENT, {
			...connected(),
			repair: async () => [CLEAN],
			output,
		});
		expect(JSON.parse(lines.join("\n"))).toEqual([CLEAN]);

		const end = vi.fn(async () => undefined);
		await expect(
			runRepairInboxSurchargesCli([], DATABASE_ENVIRONMENT, {
				...connected(end),
				repair: async () => {
					throw new Error("deadlock detected");
				},
				output: captureOutput().output,
			}),
		).rejects.toThrow("deadlock detected");
		expect(end).toHaveBeenCalledOnce();
	});
});
