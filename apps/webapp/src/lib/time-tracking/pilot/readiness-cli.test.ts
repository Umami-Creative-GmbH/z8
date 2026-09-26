import { describe, expect, it, vi } from "vitest";
import {
	parseTimePilotReadinessCommand,
	runTimePilotReadinessCli,
} from "../../../../scripts/time-pilot-readiness";
import { assessTimePilotReadiness } from "./readiness";

const DATABASE_ENVIRONMENT = {
	POSTGRES_HOST: "127.0.0.1",
	POSTGRES_PORT: "5432",
	POSTGRES_DB: "z8",
	POSTGRES_USER: "z8",
	POSTGRES_PASSWORD: "secret",
};

const REPORT = assessTimePilotReadiness({
	organizationId: "org-pilot",
	append: { mode: "active", activatedAt: "2026-09-20T06:00:00.000Z" },
	employees: [
		{
			employeeId: "e1",
			admission: "verified_lineage",
			lineage: "single",
			continuity: "established",
		},
		{ employeeId: "e2", admission: null, lineage: "review_required", continuity: "not_adopted" },
	],
	openWork: 1,
	historyFindings: [
		{ kind: "duration_conflict", treatment: "integrity_incident", blocking: true },
		{ kind: "capture_inferred", treatment: "disclosed", blocking: false },
	],
	approvalKinds: [
		{
			workflowType: "manual_time_submission",
			lifecycleMode: "legacy",
			evidenceMode: "capture",
			pending: { current: 1, notCaptured: 1, materialChange: 0, multiStage: 0 },
		},
	],
	unclassifiedPending: 0,
	operations: {
		sinceActivation: { manager_on_behalf: 1, web_clock_out: 4 },
		legacyAdmissionSinceActivation: 0,
		serverIdentityOnBehalf: 1,
	},
	imports: { heldRows: 0, failedBatches: 0, inProgressBatches: 0 },
	followUps: {
		payrollCollection: "active",
		historicalRepair: "inactive",
		pendingRebuildIntents: 0,
		openProposals: 0,
		pendingBreakAdjustments: 0,
	},
});

function captureOutput() {
	const lines: string[] = [];
	return { lines, output: { log: (line: string) => lines.push(line) } };
}

describe("time pilot readiness CLI", () => {
	it("parses the organization scope and the JSON switch", () => {
		expect(parseTimePilotReadinessCommand(["--organization-id", "org-pilot"])).toEqual({
			kind: "report",
			organizationId: "org-pilot",
			json: false,
		});
		expect(parseTimePilotReadinessCommand(["--organization-id", "org-pilot", "--json"])).toEqual({
			kind: "report",
			organizationId: "org-pilot",
			json: true,
		});
		expect(parseTimePilotReadinessCommand(["--help"])).toEqual({ kind: "help" });
	});

	it("refuses to run without exactly one organization scope", () => {
		expect(() => parseTimePilotReadinessCommand([])).toThrow("--organization-id is required");
		// A following option is never taken as the scope value.
		expect(() => parseTimePilotReadinessCommand(["--organization-id", "--json"])).toThrow(
			"--organization-id",
		);
		expect(() =>
			parseTimePilotReadinessCommand(["--organization-id", "a", "--organization-id", "b"]),
		).toThrow("Duplicate option --organization-id");
		expect(() => parseTimePilotReadinessCommand(["--organization-id", "a", "--fix"])).toThrow();
	});

	it("shows help without database credentials or a connection", async () => {
		const loadDatabase = vi.fn();
		const { lines, output } = captureOutput();

		await runTimePilotReadinessCli(["--help"], {}, { loadDatabase, output });

		expect(loadDatabase).not.toHaveBeenCalled();
		expect(lines.join("\n")).toContain("pnpm time:pilot-readiness --organization-id");
	});

	it("requires the database environment before connecting", async () => {
		const loadDatabase = vi.fn();

		await expect(
			runTimePilotReadinessCli(["--organization-id", "org-pilot"], {}, { loadDatabase }),
		).rejects.toThrow("Missing required environment variable POSTGRES_HOST");
		expect(loadDatabase).not.toHaveBeenCalled();
	});

	it("prints each section's verdict with its findings, then what the report cannot see", async () => {
		const end = vi.fn(async () => undefined);
		const assess = vi.fn(async () => REPORT);
		const { lines, output } = captureOutput();

		await runTimePilotReadinessCli(["--organization-id", "org-pilot"], DATABASE_ENVIRONMENT, {
			loadDatabase: async () => ({ pool: { end } }),
			assess,
			output,
		});

		expect(assess).toHaveBeenCalledWith({ organizationId: "org-pilot" });
		expect(end).toHaveBeenCalledOnce();
		expect(lines).toEqual([
			"Time pilot readiness for organization org-pilot (read-only snapshot): BLOCKED",
			"",
			"Append adoption: HOLD (active since 2026-09-20T06:00:00.000Z; employees 2: empty history 0, verified lineage 1, authorized continuation 0, not admitted 1; open work 1)",
			"    hold lineage_review_required (1)",
			"Historical work: BLOCKED (historical gap 0, review required 0, integrity incident 1, investigation required 0, disclosed 1)",
			"    blocker history_integrity_incident (1)",
			"    blocking kinds: duration_conflict 1",
			"Time approvals: HOLD (unclassified pending 0)",
			"  manual_time_submission: HOLD (legacy authority, rollout legacy, evidence capture; pending 2: current 1, not captured 1, material change 0, multi-stage 0)",
			"    hold evidence_held (1)",
			"Writers since activation: HOLD (manager_on_behalf 1, web_clock_out 4)",
			"    hold server_identity_on_behalf (1)",
			"Reviewed imports: READY (held rows 0, failed batches 0, in progress 0)",
			"Follow-up work: READY (payroll collection active, historical repair inactive, rebuild intents 0, open proposals 0, break adjustments 0)",
			"",
			"Not visible to this report: deployed builds and old clients (browser workers, calendar",
			"bundles, desktop, retired extension and mobile), device queues, provider click-through,",
			"measured latency and Tolgee sync. See docs/refs/time-pilot.md.",
		]);
	});

	it("prints the report as JSON for recorded evidence", async () => {
		const { lines, output } = captureOutput();

		await runTimePilotReadinessCli(
			["--organization-id", "org-pilot", "--json"],
			DATABASE_ENVIRONMENT,
			{
				loadDatabase: async () => ({ pool: { end: async () => undefined } }),
				assess: async () => REPORT,
				output,
			},
		);

		expect(JSON.parse(lines.join("\n"))).toEqual(REPORT);
	});

	it("closes the pool when the assessment fails", async () => {
		const end = vi.fn(async () => undefined);

		await expect(
			runTimePilotReadinessCli(["--organization-id", "org-missing"], DATABASE_ENVIRONMENT, {
				loadDatabase: async () => ({ pool: { end } }),
				assess: async () => {
					throw new Error("Unknown organization org-missing");
				},
				output: captureOutput().output,
			}),
		).rejects.toThrow("Unknown organization org-missing");
		expect(end).toHaveBeenCalledOnce();
	});
});
