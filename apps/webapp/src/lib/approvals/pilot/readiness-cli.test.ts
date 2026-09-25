import { describe, expect, it, vi } from "vitest";
import {
	parseApprovalPilotReadinessCommand,
	runApprovalPilotReadinessCli,
} from "../../../../scripts/approval-pilot-readiness";
import type { ApprovalPilotReadiness } from "./readiness";

const DATABASE_ENVIRONMENT = {
	POSTGRES_HOST: "127.0.0.1",
	POSTGRES_PORT: "5432",
	POSTGRES_DB: "z8",
	POSTGRES_USER: "z8",
	POSTGRES_PASSWORD: "secret",
};

const REPORT: ApprovalPilotReadiness = {
	organizationId: "org-pilot",
	kinds: [
		{
			workflowType: "absence",
			authority: "canonical",
			lifecycleMode: "canonical",
			evidenceMode: "capture",
			pending: { total: 3, current: 1, notCaptured: 1, materialChange: 1, authorityChange: 0 },
		},
	],
	combinations: [
		{
			workflowType: "absence",
			provider: "telegram",
			delivery: {
				active: true,
				activatedAt: "2026-09-25T10:00:00.000Z",
				work: { delivered: 4, exhausted: 1 },
			},
			verdict: "hold",
			findings: [
				{ code: "evidence_held", severity: "hold", count: 2 },
				{ code: "delivery_exhausted", severity: "hold", count: 1 },
			],
		},
		{
			workflowType: "absence",
			provider: "teams",
			delivery: { active: false, activatedAt: null, work: {} },
			verdict: "blocked",
			findings: [{ code: "provider_not_configured", severity: "blocker" }],
		},
	],
	escalation: {
		owner: "legacy",
		automationPaused: false,
		ownedSince: null,
		policy: null,
		transfers: { canonical: 0, legacy: 0, pendingLegacyEvents: 0 },
		openAttention: {},
		verdict: "blocked",
		findings: [
			{ code: "escalation_legacy_owner", severity: "hold" },
			{ code: "escalation_policy_missing", severity: "blocker" },
		],
	},
};

function captureOutput() {
	const lines: string[] = [];
	return { lines, output: { log: (line: string) => lines.push(line) } };
}

describe("approval pilot readiness CLI", () => {
	it("parses the organization scope and the JSON switch", () => {
		expect(parseApprovalPilotReadinessCommand(["--organization-id", "org-pilot"])).toEqual({
			kind: "report",
			organizationId: "org-pilot",
			json: false,
		});
		expect(
			parseApprovalPilotReadinessCommand(["--organization-id", "org-pilot", "--json"]),
		).toEqual({ kind: "report", organizationId: "org-pilot", json: true });
		expect(parseApprovalPilotReadinessCommand(["--help"])).toEqual({ kind: "help" });
	});

	it("refuses to run without exactly one organization scope", () => {
		expect(() => parseApprovalPilotReadinessCommand([])).toThrow("--organization-id is required");
		// A following option is never taken as the scope value.
		expect(() => parseApprovalPilotReadinessCommand(["--organization-id", "--json"])).toThrow(
			"--organization-id",
		);
		expect(() =>
			parseApprovalPilotReadinessCommand(["--organization-id", "a", "--organization-id", "b"]),
		).toThrow("Duplicate option --organization-id");
		expect(() => parseApprovalPilotReadinessCommand(["--organization-id", "a", "--fix"])).toThrow();
	});

	it("shows help without database credentials or a connection", async () => {
		const loadDatabase = vi.fn();
		const { lines, output } = captureOutput();

		await runApprovalPilotReadinessCli(["--help"], {}, { loadDatabase, output });

		expect(loadDatabase).not.toHaveBeenCalled();
		expect(lines.join("\n")).toContain("pnpm approvals:pilot-readiness --organization-id");
	});

	it("requires the database environment before connecting", async () => {
		const loadDatabase = vi.fn();

		await expect(
			runApprovalPilotReadinessCli(["--organization-id", "org-pilot"], {}, { loadDatabase }),
		).rejects.toThrow("Missing required environment variable POSTGRES_HOST");
		expect(loadDatabase).not.toHaveBeenCalled();
	});

	it("prints each verdict with its findings, then what the report cannot see, and closes the pool", async () => {
		const end = vi.fn(async () => undefined);
		const assess = vi.fn(async () => REPORT);
		const { lines, output } = captureOutput();

		await runApprovalPilotReadinessCli(["--organization-id", "org-pilot"], DATABASE_ENVIRONMENT, {
			loadDatabase: async () => ({ pool: { end } }),
			assess,
			output,
		});

		expect(assess).toHaveBeenCalledWith({ organizationId: "org-pilot" });
		expect(end).toHaveBeenCalledOnce();
		expect(lines).toEqual([
			"Pilot readiness for organization org-pilot (read-only snapshot)",
			"",
			"Kinds",
			"  absence: canonical authority (rollout canonical), evidence capture",
			"    pending 3: current 1, not captured 1, material change 1, authority change 0",
			"",
			"Card combinations",
			"  absence/telegram: HOLD (delivery active since 2026-09-25T10:00:00.000Z; work delivered 4, exhausted 1)",
			"    hold evidence_held (2)",
			"    hold delivery_exhausted (1)",
			"  absence/teams: BLOCKED (delivery inactive)",
			"    blocker provider_not_configured",
			"",
			"Escalation: BLOCKED (owner legacy, automation running, no policy; transfers canonical 0, legacy 0)",
			"    hold escalation_legacy_owner",
			"    blocker escalation_policy_missing",
			"",
			"Not visible to this report: deployed versions, worker drain, scheduler retirement,",
			"live provider click-through and Tolgee sync. See docs/refs/approval-pilot.md.",
		]);
	});

	it("prints the report as JSON for recorded evidence", async () => {
		const { lines, output } = captureOutput();

		await runApprovalPilotReadinessCli(
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
			runApprovalPilotReadinessCli(["--organization-id", "org-missing"], DATABASE_ENVIRONMENT, {
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
