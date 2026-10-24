import { describe, expect, it, vi } from "vitest";
import {
	parseBackfillFormerEmployeesCommand,
	runBackfillFormerEmployeesCli,
} from "../../../../scripts/backfill-former-employees";
import type { DeactivationBackfillEmployee, DeactivationBackfillReport } from "./backfill";
import type { DeactivationPlan } from "./types";

const DATABASE_ENVIRONMENT = {
	POSTGRES_HOST: "127.0.0.1",
	POSTGRES_PORT: "5432",
	POSTGRES_DB: "z8",
	POSTGRES_USER: "z8",
	POSTGRES_PASSWORD: "secret",
};

const EMPTY_PLAN: DeactivationPlan = {
	at: "2026-08-03T09:00:00Z",
	timeZone: "Europe/Berlin",
	managerLinks: {
		reportsNeedingReplacement: [],
		reportsKeepingAnotherManager: [],
		ownManagerLinks: [],
		replacementOptions: [],
	},
	teamLinks: { teams: [], projectAssignments: [], projectManagerLinks: [] },
	approvalDuties: { handovers: [], reviews: [] },
	shifts: { shiftsToOpen: [], plannerRecipientUserIds: [] },
	absences: { absencesToCancel: [], absencesSpanning: [] },
	accessEnds: { grants: [], drivingAuthorizations: [], kioskBadges: [], shareLinks: [] },
	retentionStarts: true,
	seatReleased: true,
	refusals: [],
};

const FIONA: DeactivationBackfillEmployee = {
	employeeId: "emp-fiona",
	name: "Fiona Former",
	leftAt: "2026-08-03T09:00:00Z",
	leftAtSource: "audit_log",
	consequencesFrom: "2026-08-03T09:00:00Z",
	actorUserId: "user-mara",
	deactivationId: null,
	plan: {
		...EMPTY_PLAN,
		managerLinks: {
			...EMPTY_PLAN.managerLinks,
			reportsNeedingReplacement: [
				{
					employeeId: "emp-otto",
					name: "Otto Orphan",
					wasPrimary: true,
					replacementEmployeeId: null,
					refusal: null,
				},
			],
			reportsKeepingAnotherManager: [
				{ employeeId: "emp-kai", name: "Kai Kept", newPrimaryManagerId: "emp-mara" },
			],
			ownManagerLinks: [{ employeeId: "emp-mara", name: "Mara Manager", isPrimary: true }],
		},
		shifts: {
			shiftsToOpen: [
				{ shiftId: "shift-1", date: "2026-09-10", startTime: "08:00", endTime: "16:00" },
			],
			plannerRecipientUserIds: ["user-mara"],
		},
	},
};

const NILS: DeactivationBackfillEmployee = {
	employeeId: "emp-nils",
	name: "Nils Nodate",
	leftAt: null,
	leftAtSource: null,
	consequencesFrom: "2026-10-24T08:00:00Z",
	actorUserId: "user-owner",
	deactivationId: null,
	plan: { ...EMPTY_PLAN, at: "2026-10-24T08:00:00Z" },
};

const ORG_A: DeactivationBackfillReport = {
	organizationId: "org-a",
	mode: "dry_run",
	employees: [FIONA, NILS],
	reportsWithoutManager: [{ employeeId: "emp-otto", name: "Otto Orphan" }],
	adminUserIds: ["user-mara", "user-owner"],
	failed: [],
	warnings: [],
};

const ORG_B_FAILED: DeactivationBackfillReport = {
	organizationId: "org-b",
	mode: "apply",
	employees: [],
	reportsWithoutManager: [],
	adminUserIds: [],
	failed: [{ employeeId: "emp-gus", name: "Gus Gone", error: "month closed" }],
	warnings: [{ employeeId: "emp-sam", message: "queue unavailable" }],
};

function captureOutput() {
	const lines: string[] = [];
	return { lines, output: { log: (line: string) => lines.push(line) } };
}

const connected = (end = vi.fn(async () => undefined)) => ({
	loadDatabase: async () => ({ pool: { end } }),
});

describe("backfill former employees CLI (#1442)", () => {
	it("is a dry run unless --apply is given, for every organization or the one named", () => {
		expect(parseBackfillFormerEmployeesCommand([])).toEqual({
			kind: "backfill",
			organizationId: null,
			json: false,
			apply: false,
		});
		expect(
			parseBackfillFormerEmployeesCommand(["--apply", "--organization-id", "org-a", "--json"]),
		).toEqual({ kind: "backfill", organizationId: "org-a", json: true, apply: true });
		expect(parseBackfillFormerEmployeesCommand(["--help"])).toEqual({ kind: "help" });
		expect(() => parseBackfillFormerEmployeesCommand(["--organization-id", "--json"])).toThrow(
			"--organization-id",
		);
		expect(() => parseBackfillFormerEmployeesCommand(["--apply", "--apply"])).toThrow(
			"Duplicate option --apply",
		);
		expect(() => parseBackfillFormerEmployeesCommand(["--dry-run=false"])).toThrow();
	});

	it("shows help without a connection and requires the database environment", async () => {
		const loadDatabase = vi.fn();
		const { lines, output } = captureOutput();
		await runBackfillFormerEmployeesCli(["--help"], {}, { loadDatabase, output });
		expect(loadDatabase).not.toHaveBeenCalled();
		expect(lines.join("\n")).toContain("pnpm employees:backfill-deactivations");

		await expect(runBackfillFormerEmployeesCli([], {}, { loadDatabase })).rejects.toThrow(
			"Missing required environment variable POSTGRES_HOST",
		);
		expect(loadDatabase).not.toHaveBeenCalled();
	});

	it("reports per organization what the dry run would change", async () => {
		const end = vi.fn(async () => undefined);
		const backfill = vi.fn(async () => [ORG_A]);
		const { lines, output } = captureOutput();

		await runBackfillFormerEmployeesCli(["--organization-id", "org-a"], DATABASE_ENVIRONMENT, {
			...connected(end),
			backfill,
			output,
		});

		expect(backfill).toHaveBeenCalledWith({ organizationIds: ["org-a"], apply: false });
		expect(end).toHaveBeenCalledOnce();
		expect(lines).toEqual([
			"Organization org-a (dry run): former employees 2, failed 0",
			"    Fiona Former (emp-fiona): left 2026-08-03T09:00:00Z (audit log); consequences from 2026-08-03T09:00:00Z; audited as user-mara",
			"        manager links ending 2, manager links kept 1, teams 0, project links 0, approval handovers 0, reviews 0, shifts opened 1, absences cancelled 0, access ended 0",
			"    Nils Nodate (emp-nils): left: not recorded; consequences from 2026-10-24T08:00:00Z; audited as user-owner",
			"        manager links ending 0, manager links kept 0, teams 0, project links 0, approval handovers 0, reviews 0, shifts opened 0, absences cancelled 0, access ended 0",
			"    reports with no current manager (would tell 2 admins): Otto Orphan (emp-otto)",
			"",
			"Total over 1 organizations (dry run): former employees 2, failed 0",
			"Nothing was changed. Review the report, then run again with --apply.",
		]);
	});

	it("applies with --apply, lists employees it could not backfill and fails", async () => {
		const backfill = vi.fn(async () => [ORG_B_FAILED]);
		const { lines, output } = captureOutput();

		await expect(
			runBackfillFormerEmployeesCli(["--apply"], DATABASE_ENVIRONMENT, {
				...connected(),
				backfill,
				output,
			}),
		).rejects.toThrow("1 employee was not backfilled");
		expect(backfill).toHaveBeenCalledWith({ apply: true });
		expect(lines).toEqual([
			"Organization org-b (applied): former employees 0, failed 1",
			"    failed Gus Gone (emp-gus): month closed",
			"    warning emp-sam: queue unavailable",
			"",
			"Total over 1 organizations (applied): former employees 0, failed 1",
		]);
	});

	it("prints JSON for recorded evidence and closes the pool when the run fails", async () => {
		const { lines, output } = captureOutput();
		await runBackfillFormerEmployeesCli(["--json"], DATABASE_ENVIRONMENT, {
			...connected(),
			backfill: async () => [ORG_A],
			output,
		});
		expect(JSON.parse(lines.join("\n"))).toEqual([ORG_A]);

		const end = vi.fn(async () => undefined);
		await expect(
			runBackfillFormerEmployeesCli([], DATABASE_ENVIRONMENT, {
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
