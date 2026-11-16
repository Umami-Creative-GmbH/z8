import { describe, expect, it, vi } from "vitest";
import {
	parseBackfillMemberEmployeesCommand,
	runBackfillMemberEmployeesCli,
} from "../../../../scripts/backfill-member-employees";
import type { JoiningBackfillReport } from "./backfill";

const DATABASE_ENVIRONMENT = {
	POSTGRES_HOST: "127.0.0.1",
	POSTGRES_PORT: "5432",
	POSTGRES_DB: "z8",
	POSTGRES_USER: "z8",
	POSTGRES_PASSWORD: "secret",
};

const ORG_A_DRY_RUN: JoiningBackfillReport = {
	organizationId: "org-a",
	mode: "dry_run",
	members: [
		{ memberId: "m-ada", userId: "u-ada", name: "Ada Admin", role: "admin", employeeId: null },
		{ memberId: "m-max", userId: "u-max", name: "", role: "member", employeeId: null },
	],
	failed: [],
};

const ORG_B_APPLIED: JoiningBackfillReport = {
	organizationId: "org-b",
	mode: "apply",
	members: [
		{ memberId: "m-bea", userId: "u-bea", name: "Bea", role: "member", employeeId: "emp-bea" },
	],
	failed: [{ memberId: "m-gus", userId: "u-gus", name: "Gus", error: "missing user" }],
};

function captureOutput() {
	const lines: string[] = [];
	return { lines, output: { log: (line: string) => lines.push(line) } };
}

const connected = (end = vi.fn(async () => undefined)) => ({
	loadDatabase: async () => ({ pool: { end } }),
});

describe("backfill member employees CLI (#1671)", () => {
	it("is a dry run unless --apply is given, for every organization or the one named", () => {
		expect(parseBackfillMemberEmployeesCommand([])).toEqual({
			kind: "backfill",
			organizationId: null,
			json: false,
			apply: false,
		});
		expect(
			parseBackfillMemberEmployeesCommand(["--apply", "--organization-id", "org-a", "--json"]),
		).toEqual({ kind: "backfill", organizationId: "org-a", json: true, apply: true });
		expect(parseBackfillMemberEmployeesCommand(["--help"])).toEqual({ kind: "help" });
		expect(() => parseBackfillMemberEmployeesCommand(["--organization-id", "--json"])).toThrow(
			"--organization-id",
		);
		expect(() => parseBackfillMemberEmployeesCommand(["--apply", "--apply"])).toThrow(
			"Duplicate option --apply",
		);
	});

	it("shows help without a connection and requires the database environment", async () => {
		const loadDatabase = vi.fn();
		const { lines, output } = captureOutput();
		await runBackfillMemberEmployeesCli(["--help"], {}, { loadDatabase, output });
		expect(loadDatabase).not.toHaveBeenCalled();
		expect(lines.join("\n")).toContain("pnpm employees:backfill-joining");

		await expect(runBackfillMemberEmployeesCli([], {}, { loadDatabase })).rejects.toThrow(
			"Missing required environment variable POSTGRES_HOST",
		);
	});

	it("reports how many members it would join per organization", async () => {
		const end = vi.fn(async () => undefined);
		const backfill = vi.fn(async () => [ORG_A_DRY_RUN]);
		const { lines, output } = captureOutput();

		await runBackfillMemberEmployeesCli(["--organization-id", "org-a"], DATABASE_ENVIRONMENT, {
			...connected(end),
			backfill,
			output,
		});

		expect(backfill).toHaveBeenCalledWith({ organizationIds: ["org-a"], apply: false });
		expect(end).toHaveBeenCalledOnce();
		expect(lines).toEqual([
			"Organization org-a (dry run): members to join 2, failed 0",
			"    Ada Admin (u-ada), membership m-ada (admin)",
			"    u-max (u-max), membership m-max (member)",
			"",
			"Total over 1 organizations (dry run): members to join 2, failed 0",
			"Nothing was changed. Review the report, then run again with --apply.",
		]);
	});

	it("applies with --apply, lists members it could not join and fails", async () => {
		const { lines, output } = captureOutput();

		await expect(
			runBackfillMemberEmployeesCli(["--apply"], DATABASE_ENVIRONMENT, {
				...connected(),
				backfill: async () => [ORG_B_APPLIED],
				output,
			}),
		).rejects.toThrow("1 member was not joined");
		expect(lines).toEqual([
			"Organization org-b (applied): members joined 1, failed 1",
			"    Bea (u-bea), membership m-bea (member): employee emp-bea",
			"    failed Gus (u-gus), membership m-gus: missing user",
			"",
			"Total over 1 organizations (applied): members joined 1, failed 1",
		]);
	});

	it("prints JSON for recorded evidence and closes the pool when the run fails", async () => {
		const { lines, output } = captureOutput();
		await runBackfillMemberEmployeesCli(["--json"], DATABASE_ENVIRONMENT, {
			...connected(),
			backfill: async () => [ORG_A_DRY_RUN],
			output,
		});
		expect(JSON.parse(lines.join("\n"))).toEqual([ORG_A_DRY_RUN]);

		const end = vi.fn(async () => undefined);
		await expect(
			runBackfillMemberEmployeesCli([], DATABASE_ENVIRONMENT, {
				...connected(end),
				backfill: async () => {
					throw new Error("deadlock detected");
				},
				output: captureOutput().output,
			}),
		).rejects.toThrow("deadlock detected");
		expect(end).toHaveBeenCalledOnce();
	});
});
