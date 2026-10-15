import { describe, expect, it, vi } from "vitest";
import {
	parseAttachMissingWorkRecordsCommand,
	runAttachMissingWorkRecordsCli,
} from "../../../../scripts/attach-missing-work-records";
import type { OrganizationWorkRecordAttachment } from "./attach-missing-work-records";

const DATABASE_ENVIRONMENT = {
	POSTGRES_HOST: "127.0.0.1",
	POSTGRES_PORT: "5432",
	POSTGRES_DB: "z8",
	POSTGRES_USER: "z8",
	POSTGRES_PASSWORD: "secret",
};

const REPORTS: OrganizationWorkRecordAttachment[] = [
	{
		organizationId: "org-a",
		attached: ["wp-1", "wp-2"],
		closedMonthSkips: [{ workPeriodId: "wp-3", month: "2026-03" }],
		refused: [
			{
				workPeriodId: "wp-4",
				employeeId: "emp-1",
				startAt: "2026-04-08T08:00:00.000Z",
				endAt: "2026-04-08T16:00:00.000Z",
				refusal: "canonical_divergence",
				reason: "duration_missing",
			},
		],
	},
	{ organizationId: "org-b", attached: [], closedMonthSkips: [], refused: [] },
];

function captureOutput() {
	const lines: string[] = [];
	return { lines, output: { log: (line: string) => lines.push(line) } };
}

describe("attach missing work records CLI (deploy backfill of 0234)", () => {
	it("runs for every organization, or only the one named", () => {
		expect(parseAttachMissingWorkRecordsCommand([])).toEqual({
			kind: "attach",
			organizationId: null,
			json: false,
		});
		expect(parseAttachMissingWorkRecordsCommand(["--organization-id", "org-a", "--json"])).toEqual({
			kind: "attach",
			organizationId: "org-a",
			json: true,
		});
		expect(parseAttachMissingWorkRecordsCommand(["--help"])).toEqual({ kind: "help" });
		expect(() => parseAttachMissingWorkRecordsCommand(["--organization-id", "--json"])).toThrow(
			"--organization-id",
		);
		expect(() =>
			parseAttachMissingWorkRecordsCommand(["--organization-id", "a", "--organization-id", "b"]),
		).toThrow("Duplicate option --organization-id");
		expect(() => parseAttachMissingWorkRecordsCommand(["--force"])).toThrow();
	});

	it("shows help, saying to run right after migrate, without a connection", async () => {
		const loadDatabase = vi.fn();
		const { lines, output } = captureOutput();

		await runAttachMissingWorkRecordsCli(["--help"], {}, { loadDatabase, output });

		expect(loadDatabase).not.toHaveBeenCalled();
		expect(lines.join("\n")).toContain("pnpm work-records:attach-missing");
		expect(lines.join("\n")).toContain("Run right after migrate");
	});

	it("requires the database environment before connecting", async () => {
		const loadDatabase = vi.fn();

		await expect(runAttachMissingWorkRecordsCli([], {}, { loadDatabase })).rejects.toThrow(
			"Missing required environment variable POSTGRES_HOST",
		);
		expect(loadDatabase).not.toHaveBeenCalled();
	});

	it("reports each organization's attached, closed-month skips and refused periods with their reason", async () => {
		const end = vi.fn(async () => undefined);
		const attach = vi.fn(async () => REPORTS);
		const { lines, output } = captureOutput();

		await runAttachMissingWorkRecordsCli([], DATABASE_ENVIRONMENT, {
			loadDatabase: async () => ({ pool: { end } }),
			attach,
			output,
		});

		expect(attach).toHaveBeenCalledWith({});
		expect(end).toHaveBeenCalledOnce();
		expect(lines).toEqual([
			"Organization org-a: attached 2, closed-month skips 1, refused 1",
			"    refused wp-4 (employee emp-1, 2026-04-08T08:00:00.000Z to 2026-04-08T16:00:00.000Z): duration_missing",
			"Organization org-b: attached 0, closed-month skips 0, refused 0",
			"",
			"Total over 2 organizations: attached 2, closed-month skips 1, refused 1",
		]);
	});

	it("scopes the run to one organization and prints JSON for recorded evidence", async () => {
		const attach = vi.fn(async () => [REPORTS[0] as OrganizationWorkRecordAttachment]);
		const { lines, output } = captureOutput();

		await runAttachMissingWorkRecordsCli(
			["--organization-id", "org-a", "--json"],
			DATABASE_ENVIRONMENT,
			{ loadDatabase: async () => ({ pool: { end: async () => undefined } }), attach, output },
		);

		expect(attach).toHaveBeenCalledWith({ organizationIds: ["org-a"] });
		expect(JSON.parse(lines.join("\n"))).toEqual([REPORTS[0]]);
	});

	it("closes the pool when the run fails", async () => {
		const end = vi.fn(async () => undefined);

		await expect(
			runAttachMissingWorkRecordsCli([], DATABASE_ENVIRONMENT, {
				loadDatabase: async () => ({ pool: { end } }),
				attach: async () => {
					throw new Error("deadlock detected");
				},
				output: captureOutput().output,
			}),
		).rejects.toThrow("deadlock detected");
		expect(end).toHaveBeenCalledOnce();
	});
});
