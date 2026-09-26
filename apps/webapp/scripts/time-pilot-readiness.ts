import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { TimePilotFinding, TimePilotReadiness } from "@/lib/time-tracking/pilot/readiness";

const HELP = `Time pilot readiness (server operator access and database credentials required)

  pnpm time:pilot-readiness --organization-id <org-id> [--json]

Reports, from one read-only snapshot, whether the organization's completed work,
append adoption, time approvals, reviewed imports and follow-up work can enter
or continue the time pilot (#329). Nothing is changed. The history read covers
every employee's whole retained history, so it is slow for large organizations.

Options:
  --organization-id  Required organization scope
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

type TimePilotReadinessCommand =
	| { kind: "help" }
	| { kind: "report"; organizationId: string; json: boolean };

export function parseTimePilotReadinessCommand(args: string[]): TimePilotReadinessCommand {
	const { values, tokens } = parseArgs({
		args,
		options: {
			"organization-id": { type: "string" },
			json: { type: "boolean" },
			help: { type: "boolean" },
		},
		strict: true,
		allowPositionals: false,
		tokens: true,
	});
	const seen = new Set<string>();
	for (const token of tokens) {
		if (token.kind !== "option") continue;
		if (seen.has(token.name)) throw new Error(`Duplicate option --${token.name}`);
		seen.add(token.name);
	}
	if (values.help) return { kind: "help" };
	const organizationId = values["organization-id"];
	if (!organizationId?.trim() || organizationId.startsWith("--")) {
		throw new Error("--organization-id is required");
	}
	return { kind: "report", organizationId, json: values.json === true };
}

function findingLines(findings: readonly TimePilotFinding[]): string[] {
	return findings.map(
		(finding) =>
			`    ${finding.severity} ${finding.code}${finding.count === undefined ? "" : ` (${finding.count})`}`,
	);
}

function counts(entries: Record<string, number | undefined>): string {
	return Object.entries(entries)
		.map(([name, count]) => `${name} ${count ?? 0}`)
		.join(", ");
}

function spaced(name: string): string {
	return name.replaceAll("_", " ");
}

export function formatTimePilotReadiness(report: TimePilotReadiness): string[] {
	const { adoption, history, approvals, operations, imports, followUps } = report;
	const admitted = Object.fromEntries(
		Object.entries(adoption.employees.admitted).map(([admission, count]) => [
			spaced(admission),
			count,
		]),
	);
	const lines = [
		`Time pilot readiness for organization ${report.organizationId} (read-only snapshot): ${report.verdict.toUpperCase()}`,
		"",
		`Append adoption: ${adoption.verdict.toUpperCase()} (${
			adoption.appendMode === "active" ? `active since ${adoption.activatedAt}` : "inactive"
		}; employees ${adoption.employees.total}: ${counts({
			...admitted,
			"not admitted": adoption.employees.notAdmitted,
		})}; open work ${adoption.openWork})`,
		...findingLines(adoption.findings),
		`Historical work: ${history.verdict.toUpperCase()} (${counts(
			Object.fromEntries(
				Object.entries(history.treatments).map(([treatment, count]) => [spaced(treatment), count]),
			),
		)})`,
		...findingLines(history.findings),
	];
	if (Object.keys(history.blockingKinds).length > 0) {
		lines.push(`    blocking kinds: ${counts(history.blockingKinds)}`);
	}
	lines.push(
		`Time approvals: ${approvals.verdict.toUpperCase()} (unclassified pending ${approvals.unclassifiedPending})`,
		...findingLines(approvals.findings),
	);
	for (const kind of approvals.kinds) {
		lines.push(
			`  ${kind.workflowType}: ${kind.verdict.toUpperCase()} (${kind.authority} authority, rollout ${
				kind.lifecycleMode ?? "none"
			}, evidence ${kind.evidenceMode}; pending ${kind.pending.total}: ${counts({
				current: kind.pending.current,
				"not captured": kind.pending.notCaptured,
				"material change": kind.pending.materialChange,
				"multi-stage": kind.pending.multiStage,
			})})`,
			...findingLines(kind.findings),
		);
	}
	const receipts = Object.keys(operations.receiptsSinceActivation).length
		? counts(operations.receiptsSinceActivation)
		: "none";
	lines.push(
		`Writers since activation: ${operations.verdict.toUpperCase()} (${receipts})`,
		...findingLines(operations.findings),
		`Reviewed imports: ${imports.verdict.toUpperCase()} (${counts({
			"held rows": imports.heldRows,
			"failed batches": imports.failedBatches,
			"in progress": imports.inProgressBatches,
		})})`,
		...findingLines(imports.findings),
		`Follow-up work: ${followUps.verdict.toUpperCase()} (payroll collection ${
			followUps.payrollCollection
		}, historical repair ${followUps.historicalRepair}, ${counts({
			"rebuild intents": followUps.pendingRebuildIntents,
			"open proposals": followUps.openProposals,
			"break adjustments": followUps.pendingBreakAdjustments,
		})})`,
		...findingLines(followUps.findings),
		"",
		"Not visible to this report: deployed builds and old clients (browser workers, calendar",
		"bundles, desktop, retired extension and mobile), device queues, provider click-through,",
		"measured latency and Tolgee sync. See docs/refs/time-pilot.md.",
	);
	return lines;
}

interface TimePilotReadinessDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	assess?: (input: { organizationId: string }) => Promise<TimePilotReadiness>;
	output?: { log(line: string): void };
}

export async function runTimePilotReadinessCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: TimePilotReadinessDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseTimePilotReadinessCommand(args);
	if (command.kind === "help") {
		output.log(HELP);
		return;
	}
	for (const name of [
		"POSTGRES_HOST",
		"POSTGRES_PORT",
		"POSTGRES_DB",
		"POSTGRES_USER",
		"POSTGRES_PASSWORD",
	]) {
		if (!environment[name]?.trim()) {
			throw new Error(`Missing required environment variable ${name}`);
		}
	}
	const { pool } = await (dependencies.loadDatabase ?? (() => import("@/db")))();
	const assess =
		dependencies.assess ??
		(await import("@/lib/time-tracking/pilot/readiness-reader"))
			.assessOrganizationTimePilotReadiness;
	try {
		const report = await assess({ organizationId: command.organizationId });
		if (command.json) {
			output.log(JSON.stringify(report, null, 2));
		} else {
			for (const line of formatTimePilotReadiness(report)) output.log(line);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runTimePilotReadinessCli(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
