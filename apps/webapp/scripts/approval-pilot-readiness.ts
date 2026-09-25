import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type {
	ApprovalPilotReadiness,
	PilotEscalationReadiness,
	PilotFinding,
} from "@/lib/approvals/pilot/readiness";

const HELP = `Approval pilot readiness (server operator access and database credentials required)

  pnpm approvals:pilot-readiness --organization-id <org-id> [--json]

Reports, from one read-only snapshot, whether the organization's absence and
expense card combinations can enter or continue the non-time approval pilot
(#328), and the organization's escalation ownership. Nothing is changed.

Options:
  --organization-id  Required organization scope
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

type ApprovalPilotReadinessCommand =
	| { kind: "help" }
	| { kind: "report"; organizationId: string; json: boolean };

export function parseApprovalPilotReadinessCommand(args: string[]): ApprovalPilotReadinessCommand {
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

function findingLines(findings: readonly PilotFinding[]): string[] {
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

function escalationSummary(escalation: PilotEscalationReadiness): string {
	const policy = escalation.policy
		? `policy ${escalation.policy.enabled ? "enabled" : "disabled"}, ${escalation.policy.responseWindowHours}h window, conflicts ${escalation.policy.conflictReviewStatus}`
		: "no policy";
	const state = [
		`owner ${escalation.owner}`,
		escalation.automationPaused ? "automation paused" : "automation running",
		policy,
	].join(", ");
	return `${state}; transfers canonical ${escalation.transfers.canonical}, legacy ${escalation.transfers.legacy}`;
}

export function formatApprovalPilotReadiness(report: ApprovalPilotReadiness): string[] {
	const lines = [
		`Pilot readiness for organization ${report.organizationId} (read-only snapshot)`,
		"",
		"Kinds",
	];
	for (const kind of report.kinds) {
		lines.push(
			`  ${kind.workflowType}: ${kind.authority} authority (rollout ${kind.lifecycleMode ?? "none"}), evidence ${kind.evidenceMode}`,
			`    pending ${kind.pending.total}: ${counts({
				current: kind.pending.current,
				"not captured": kind.pending.notCaptured,
				"material change": kind.pending.materialChange,
				"authority change": kind.pending.authorityChange,
			})}`,
		);
	}
	lines.push("", "Card combinations");
	for (const entry of report.combinations) {
		const work = Object.keys(entry.delivery.work).length
			? `; work ${counts(entry.delivery.work)}`
			: "";
		const delivery = entry.delivery.active
			? `delivery active since ${entry.delivery.activatedAt}${work}`
			: `delivery inactive${work}`;
		lines.push(
			`  ${entry.workflowType}/${entry.provider}: ${entry.verdict.toUpperCase()} (${delivery})`,
			...findingLines(entry.findings),
		);
	}
	const escalation = report.escalation;
	lines.push(
		"",
		`Escalation: ${escalation.verdict.toUpperCase()} (${escalationSummary(escalation)})`,
		...findingLines(escalation.findings),
		"",
		"Not visible to this report: deployed versions, worker drain, scheduler retirement,",
		"live provider click-through and Tolgee sync. See docs/refs/approval-pilot.md.",
	);
	return lines;
}

interface PilotReadinessDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	assess?: (input: { organizationId: string }) => Promise<ApprovalPilotReadiness>;
	output?: { log(line: string): void };
}

export async function runApprovalPilotReadinessCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: PilotReadinessDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseApprovalPilotReadinessCommand(args);
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
		(await import("@/lib/approvals/pilot/readiness")).assessApprovalPilotReadiness;
	try {
		const report = await assess({ organizationId: command.organizationId });
		if (command.json) {
			output.log(JSON.stringify(report, null, 2));
		} else {
			for (const line of formatApprovalPilotReadiness(report)) output.log(line);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runApprovalPilotReadinessCli(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
