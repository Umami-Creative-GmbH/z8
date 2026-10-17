import { describe, expect, it, vi } from "vitest";
import {
	parseMinimisePurgedDocumentAuditsCommand,
	runMinimisePurgedDocumentAuditsCli,
} from "../../../scripts/minimise-purged-document-audits";
import type { PurgedDocumentAuditBackfillReport } from "./audit-minimisation-backfill";

const DATABASE_ENVIRONMENT = {
	POSTGRES_HOST: "127.0.0.1",
	POSTGRES_PORT: "5432",
	POSTGRES_DB: "z8",
	POSTGRES_USER: "z8",
	POSTGRES_PASSWORD: "secret",
};

const CLEAN: PurgedDocumentAuditBackfillReport = {
	organizationId: "org-b",
	purgeRecords: 3,
	minimised: 7,
	unprocessable: [],
	documentStillPresent: [],
	employeeUnknown: [],
};

const NEEDS_ATTENTION: PurgedDocumentAuditBackfillReport = {
	organizationId: "org-a",
	purgeRecords: 2,
	minimised: 1,
	unprocessable: [
		{
			auditId: "audit-1",
			entityType: "employee_document",
			entityId: "doc-1",
			reason: "invalid_json",
		},
	],
	documentStillPresent: [{ auditId: "audit-2", documentId: "doc-2" }],
	employeeUnknown: [{ auditId: "audit-3", documentId: "doc-3" }],
};

function captureOutput() {
	const lines: string[] = [];
	return { lines, output: { log: (line: string) => lines.push(line) } };
}

const connected = (end = vi.fn(async () => undefined)) => ({
	loadDatabase: async () => ({ pool: { end } }),
});

describe("minimise purged document audits CLI (#923 backfill)", () => {
	it("runs for every organization, or only the one named", () => {
		expect(parseMinimisePurgedDocumentAuditsCommand([])).toEqual({
			kind: "backfill",
			organizationId: null,
			json: false,
		});
		expect(
			parseMinimisePurgedDocumentAuditsCommand(["--organization-id", "org-a", "--json"]),
		).toEqual({ kind: "backfill", organizationId: "org-a", json: true });
		expect(parseMinimisePurgedDocumentAuditsCommand(["--help"])).toEqual({ kind: "help" });
		expect(() => parseMinimisePurgedDocumentAuditsCommand(["--organization-id", "--json"])).toThrow(
			"--organization-id",
		);
		expect(() => parseMinimisePurgedDocumentAuditsCommand(["--force"])).toThrow();
	});

	it("shows help without a connection and requires the database environment", async () => {
		const loadDatabase = vi.fn();
		const { lines, output } = captureOutput();
		await runMinimisePurgedDocumentAuditsCli(["--help"], {}, { loadDatabase, output });
		expect(loadDatabase).not.toHaveBeenCalled();
		expect(lines.join("\n")).toContain("pnpm personnel-files:minimise-purged-audits");

		await expect(runMinimisePurgedDocumentAuditsCli([], {}, { loadDatabase })).rejects.toThrow(
			"Missing required environment variable POSTGRES_HOST",
		);
		expect(loadDatabase).not.toHaveBeenCalled();
	});

	it("reports each organization and succeeds when nothing needs attention", async () => {
		const end = vi.fn(async () => undefined);
		const backfill = vi.fn(async () => [CLEAN]);
		const { lines, output } = captureOutput();

		await runMinimisePurgedDocumentAuditsCli(["--organization-id", "org-b"], DATABASE_ENVIRONMENT, {
			...connected(end),
			backfill,
			output,
		});

		expect(backfill).toHaveBeenCalledWith({ organizationIds: ["org-b"] });
		expect(end).toHaveBeenCalledOnce();
		expect(lines).toEqual([
			"Organization org-b: purge records 3, minimised 7, unprocessable 0, document still present 0, employee unknown 0",
			"",
			"Total over 1 organizations: minimised 7, records needing attention 0",
		]);
	});

	it("lists every record it could not process and fails, so completion is never claimed for them", async () => {
		const { lines, output } = captureOutput();

		await expect(
			runMinimisePurgedDocumentAuditsCli([], DATABASE_ENVIRONMENT, {
				...connected(),
				backfill: async () => [NEEDS_ATTENTION, CLEAN],
				output,
			}),
		).rejects.toThrow("3 records need attention");
		expect(lines).toEqual([
			"Organization org-a: purge records 2, minimised 1, unprocessable 1, document still present 1, employee unknown 1",
			"    unprocessable audit-1 (employee_document doc-1): invalid_json",
			"    document still present: purge record audit-2 names doc-2, which still exists",
			"    employee unknown: purge record audit-3 (doc-3) names no employee; ZIP records were not searched",
			"Organization org-b: purge records 3, minimised 7, unprocessable 0, document still present 0, employee unknown 0",
			"",
			"Total over 2 organizations: minimised 8, records needing attention 3",
		]);
	});

	it("prints JSON for recorded evidence and closes the pool when the run fails", async () => {
		const { lines, output } = captureOutput();
		await runMinimisePurgedDocumentAuditsCli(["--json"], DATABASE_ENVIRONMENT, {
			...connected(),
			backfill: async () => [CLEAN],
			output,
		});
		expect(JSON.parse(lines.join("\n"))).toEqual([CLEAN]);

		const end = vi.fn(async () => undefined);
		await expect(
			runMinimisePurgedDocumentAuditsCli([], DATABASE_ENVIRONMENT, {
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
