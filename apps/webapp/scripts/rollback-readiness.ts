import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { RollbackFinding, RollbackReadiness } from "@/lib/rollout/rollback/readiness";

const HELP = `Rollback readiness (server operator access and database credentials required)

  pnpm rollout:rollback-readiness --organization-id <org-id> [--json]

Reports, from one read-only snapshot, what a compatible rollback of the
organization (#331) must first drain, pause or accept: append adoption,
approval cards and their delivery, escalation transfers and durable work an
older release would ignore. It also lists the committed rows that pin the
oldest schema and release a rollback may target. Nothing is changed.

Options:
  --organization-id  Required organization scope
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

type RollbackReadinessCommand =
	| { kind: "help" }
	| { kind: "report"; organizationId: string; json: boolean };

export function parseRollbackReadinessCommand(args: string[]): RollbackReadinessCommand {
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

function findingLines(findings: readonly RollbackFinding[]): string[] {
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

function listed(items: readonly string[]): string {
	return items.length > 0 ? items.join(", ") : "none";
}

export function formatRollbackReadiness(report: RollbackReadiness): string[] {
	const { append, cards, escalation, durable, schemaFloor } = report;
	const { total, ...admitted } = append.positions;
	const lines = [
		`Rollback readiness for organization ${report.organizationId} (read-only snapshot): ${report.verdict.toUpperCase()}`,
		"",
		`Append adoption: ${append.verdict.toUpperCase()} (${
			append.mode === "active" ? `active since ${append.activatedAt}` : "inactive"
		}; positions ${total}: ${counts(
			Object.fromEntries(
				Object.entries(admitted).map(([admission, count]) => [
					admission.replaceAll("_", " "),
					count,
				]),
			),
		)})`,
		...findingLines(append.findings),
		`Approval cards: ${cards.verdict.toUpperCase()} (delivery controls ${listed(
			cards.deliveryControls.map((control) => `${control.workflowType}/${control.provider}`),
		)}; actionable ${listed(
			cards.actionable.map((control) => `${control.workflowType}/${control.provider}`),
		)}; open work ${listed(
			cards.openWork.map((work) => `${work.provider} ${work.effect} ${work.count}`),
		)})`,
		...findingLines(cards.findings),
		`Escalation: ${escalation.verdict.toUpperCase()} (owner ${escalation.owner ?? "legacy"}${
			escalation.owner === "escalation"
				? `, automation ${escalation.automationPaused ? "paused" : "running"}`
				: ""
		}; pending transferred ${listed(
			escalation.pendingTransferred.map(
				(group) => `${group.authorityMode} ${group.workflowType} ${group.count}`,
			),
		)})`,
		...findingLines(escalation.findings),
		`Durable work: ${durable.verdict.toUpperCase()} (${counts({
			"organization rebuild intents": durable.rebuildIntents.organization,
			"user rebuild intents": durable.rebuildIntents.user,
			"break adjustments": durable.breakAdjustments,
			"payroll jobs in flight": durable.payrollJobsInFlight,
			"held import rows": durable.heldImportRows,
		})})`,
		...findingLines(durable.findings),
		schemaFloor.migration === null
			? "Schema floor: none (no committed rows pin a migration)"
			: `Schema floor: ${schemaFloor.migration} (never narrow or drop below it; older code cannot read these rows)`,
		...schemaFloor.pins.map((pin) => `    ${pin.migration}: ${pin.subject} (${pin.rows})`),
		"",
		"Not visible to this report: deployed builds, old clients and their device queues (browser",
		"workers, desktop stores, retired extension and mobile readers), BullMQ queues, sent",
		"provider cards and code-only behaviour changes. See docs/refs/rollback.md.",
	];
	return lines;
}

interface RollbackReadinessDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	assess?: (input: { organizationId: string }) => Promise<RollbackReadiness>;
	output?: { log(line: string): void };
}

export async function runRollbackReadinessCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: RollbackReadinessDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseRollbackReadinessCommand(args);
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
		(await import("@/lib/rollout/rollback/readiness-reader")).assessOrganizationRollbackReadiness;
	try {
		const report = await assess({ organizationId: command.organizationId });
		if (command.json) {
			output.log(JSON.stringify(report, null, 2));
		} else {
			for (const line of formatRollbackReadiness(report)) output.log(line);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runRollbackReadinessCli(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
