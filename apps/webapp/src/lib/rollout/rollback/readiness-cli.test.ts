import { describe, expect, it, vi } from "vitest";
import {
	parseRollbackReadinessCommand,
	runRollbackReadinessCli,
} from "../../../../scripts/rollback-readiness";
import { assessRollbackReadiness } from "./readiness";

const DATABASE_ENVIRONMENT = {
	POSTGRES_HOST: "127.0.0.1",
	POSTGRES_PORT: "5432",
	POSTGRES_DB: "z8",
	POSTGRES_USER: "z8",
	POSTGRES_PASSWORD: "secret",
};

const REPORT = assessRollbackReadiness({
	organizationId: "org-rollback",
	append: {
		mode: "active",
		activatedAt: "2026-09-20T06:00:00.000Z",
		positions: { empty_history: 1, verified_lineage: 2, authorized_continuation: 0 },
	},
	receipts: { kinds: { close_active_work: 3 }, writers: { web_clock_out: 3 } },
	cards: {
		deliveryControls: [{ workflowType: "absence", provider: "slack", lifecycleMode: "canonical" }],
		presentationControls: [{ workflowType: "absence", provider: "telegram", mode: "review_only" }],
		openWork: [{ provider: "slack", effect: "initial", count: 1 }],
		messages: { telegram: 2 },
		invocations: {},
		legacyLifecycleRows: 0,
		cycleRows: 0,
		replacementRows: 0,
		legacyReplacementRows: 0,
	},
	escalation: {
		owner: "escalation",
		automationPaused: true,
		pendingTransferred: [
			{ authorityMode: "legacy", workflowType: "manual_time_submission", count: 1 },
		],
	},
	durable: {
		rebuildIntents: { organization: 1, user: 0 },
		breakAdjustments: 0,
		payrollJobsInFlight: 0,
		payrollStoredInputs: 0,
		payrollControl: false,
		heldImportRows: 0,
		proposals: 0,
		repairControl: false,
	},
});

function captureOutput() {
	const lines: string[] = [];
	return { lines, output: { log: (line: string) => lines.push(line) } };
}

describe("rollback readiness CLI", () => {
	it("parses the organization scope and the JSON switch", () => {
		expect(parseRollbackReadinessCommand(["--organization-id", "org-rollback"])).toEqual({
			kind: "report",
			organizationId: "org-rollback",
			json: false,
		});
		expect(parseRollbackReadinessCommand(["--organization-id", "org-rollback", "--json"])).toEqual({
			kind: "report",
			organizationId: "org-rollback",
			json: true,
		});
		expect(parseRollbackReadinessCommand(["--help"])).toEqual({ kind: "help" });
	});

	it("refuses to run without exactly one organization scope", () => {
		expect(() => parseRollbackReadinessCommand([])).toThrow("--organization-id is required");
		expect(() => parseRollbackReadinessCommand(["--organization-id", "--json"])).toThrow(
			"--organization-id",
		);
		expect(() =>
			parseRollbackReadinessCommand(["--organization-id", "a", "--organization-id", "b"]),
		).toThrow("Duplicate option --organization-id");
		expect(() => parseRollbackReadinessCommand(["--organization-id", "a", "--apply"])).toThrow();
	});

	it("shows help without database credentials or a connection", async () => {
		const loadDatabase = vi.fn();
		const { lines, output } = captureOutput();

		await runRollbackReadinessCli(["--help"], {}, { loadDatabase, output });

		expect(loadDatabase).not.toHaveBeenCalled();
		expect(lines.join("\n")).toContain("pnpm rollout:rollback-readiness --organization-id");
	});

	it("requires the database environment before connecting", async () => {
		const loadDatabase = vi.fn();

		await expect(
			runRollbackReadinessCli(["--organization-id", "org-rollback"], {}, { loadDatabase }),
		).rejects.toThrow("Missing required environment variable POSTGRES_HOST");
		expect(loadDatabase).not.toHaveBeenCalled();
	});

	it("prints each section with its findings, the schema floor, then what the report cannot see", async () => {
		const end = vi.fn(async () => undefined);
		const assess = vi.fn(async () => REPORT);
		const { lines, output } = captureOutput();

		await runRollbackReadinessCli(["--organization-id", "org-rollback"], DATABASE_ENVIRONMENT, {
			loadDatabase: async () => ({ pool: { end } }),
			assess,
			output,
		});

		expect(assess).toHaveBeenCalledWith({ organizationId: "org-rollback" });
		expect(end).toHaveBeenCalledOnce();
		expect(lines).toEqual([
			"Rollback readiness for organization org-rollback (read-only snapshot): BLOCKED",
			"",
			"Append adoption: BLOCKED (active since 2026-09-20T06:00:00.000Z; positions 3: empty history 1, verified lineage 2, authorized continuation 0)",
			"    blocker append_pause_unavailable",
			"Approval cards: HOLD (delivery controls absence/slack; actionable none; open work slack initial 1)",
			"    hold delivery_pause_gap (1)",
			"    hold delivery_work_pending (1)",
			"Escalation: BLOCKED (owner escalation, automation paused; pending transferred legacy manual_time_submission 1)",
			"    blocker legacy_transfers_pending (1)",
			"Durable work: BLOCKED (organization rebuild intents 1, user rebuild intents 0, break adjustments 0, payroll jobs in flight 0, held import rows 0)",
			"    blocker rebuild_intents_pending (1)",
			"Schema floor: 0099_work_balance_rebuild_intent (never narrow or drop the schema below it)",
			"Release floor: 0083_completed_work_operation (the oldest code a rollback may target)",
			"    0079_time_entry_append_position: append positions (3)",
			"    0083_completed_work_operation: receipt kind close_active_work (3), limits the release",
			"    0083_completed_work_operation: receipt writer web_clock_out (3), limits the release",
			"    0086_approval_delivery: telegram delivery messages (2)",
			"    0099_work_balance_rebuild_intent: organization rebuild intents (1)",
			"",
			"Not visible to this report: deployed builds, old clients and their device queues (browser",
			"workers, desktop stores, retired extension and mobile readers), BullMQ queues, sent",
			"provider cards and code-only behaviour changes. See docs/refs/rollback.md.",
		]);
	});

	it("prints the report as JSON for recorded evidence", async () => {
		const { lines, output } = captureOutput();

		await runRollbackReadinessCli(
			["--organization-id", "org-rollback", "--json"],
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
			runRollbackReadinessCli(["--organization-id", "org-missing"], DATABASE_ENVIRONMENT, {
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
