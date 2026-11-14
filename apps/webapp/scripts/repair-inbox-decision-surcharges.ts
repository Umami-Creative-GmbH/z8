import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { InboxDecisionSurchargeRepairReport } from "@/lib/surcharges/inbox-decision-repair";

const HELP = `Repair surcharges the approval inbox skipped (one-time repair, #1690 after #1674)

  pnpm surcharges:repair-inbox-decisions [--apply] [--organization-id <org-id>] [--json]

Without --apply this is a dry run: it reports, per organization, what it would
change and changes nothing. Run it on production first, review the report,
then run again with --apply.

From 2026-07-24 until #1674, deciding a manual time submission or a policy
clock-out at its terminal stage from the approval inbox skipped the
decision's surcharge maintenance. Stored data does not say which entry point
decided, so for every organization with surcharges enabled (or only the one
named) it revisits every such terminal decision since 2026-07-24 whose work
period is still in the decided state, and compares the period's surcharge
rows with the rows that decision's maintenance writes:

  approved  the period, and the second half of a policy clock-out split by
            its owed break, gets the rows its captured surcharge snapshot
            credits (SurchargeService.reconcileWorkPeriods);
  rejected  surcharge rows the period still holds are removed.

Periods whose rows already match are left alone, so a second run changes
nothing. Periods changed since the decision, approvals without a captured
snapshot and historical policy clock-out rejections are reported as skipped
and left alone. Each period is reconciled in its own transaction; a period
that cannot be repaired is listed and the run exits non-zero. Fix the cause
and run again.

Options:
  --apply            Change data (default: dry run)
  --organization-id  Only this organization
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

type RepairInboxSurchargesCommand =
	| { kind: "help" }
	| { kind: "repair"; organizationId: string | null; json: boolean; apply: boolean };

export function parseRepairInboxSurchargesCommand(args: string[]): RepairInboxSurchargesCommand {
	const { values, tokens } = parseArgs({
		args,
		options: {
			apply: { type: "boolean" },
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
	if (organizationId !== undefined && (!organizationId.trim() || organizationId.startsWith("--"))) {
		throw new Error("--organization-id needs an organization id");
	}
	return {
		kind: "repair",
		organizationId: organizationId ?? null,
		json: values.json === true,
		apply: values.apply === true,
	};
}

export function formatRepairInboxSurcharges(
	reports: readonly InboxDecisionSurchargeRepairReport[],
	apply: boolean,
): string[] {
	const mode = apply ? "applied" : "dry run";
	const verb = apply ? "repaired" : "to repair";
	const lines: string[] = [];
	for (const report of reports) {
		lines.push(
			`Organization ${report.organizationId} (${mode}): decided ${report.decided}, approved ${verb} ${report.approvedRepairs}, rejected ${verb} ${report.rejectedRepairs}, unchanged ${report.unchanged}, skipped ${report.skipped.length}, failed ${report.failed.length}`,
		);
		for (const skip of report.skipped) {
			lines.push(`    skipped ${skip.workPeriodId}: ${skip.reason}`);
		}
		for (const failure of report.failed) {
			lines.push(`    failed ${failure.workPeriodId}: ${failure.error}`);
		}
	}
	const total = (count: (report: InboxDecisionSurchargeRepairReport) => number) =>
		reports.reduce((sum, report) => sum + count(report), 0);
	lines.push(
		"",
		`Total over ${reports.length} organizations (${mode}): approved ${verb} ${total((r) => r.approvedRepairs)}, rejected ${verb} ${total((r) => r.rejectedRepairs)}, unchanged ${total((r) => r.unchanged)}, skipped ${total((r) => r.skipped.length)}, failed ${total((r) => r.failed.length)}`,
	);
	if (!apply) lines.push("Nothing was changed. Review the report, then run again with --apply.");
	return lines;
}

interface RepairInboxSurchargesDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	repair?: (options: {
		organizationIds?: readonly string[];
		apply: boolean;
	}) => Promise<InboxDecisionSurchargeRepairReport[]>;
	output?: { log(line: string): void };
}

export async function runRepairInboxSurchargesCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: RepairInboxSurchargesDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseRepairInboxSurchargesCommand(args);
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
	try {
		const repair =
			dependencies.repair ??
			(async (options: { organizationIds?: readonly string[]; apply: boolean }) => {
				const [{ db }, { repairInboxDecisionSurcharges }] = await Promise.all([
					import("@/db"),
					import("@/lib/surcharges/inbox-decision-repair"),
				]);
				return repairInboxDecisionSurcharges(db, options);
			});
		const reports = await repair({
			...(command.organizationId ? { organizationIds: [command.organizationId] } : {}),
			apply: command.apply,
		});
		if (command.json) {
			output.log(JSON.stringify(reports, null, 2));
		} else {
			for (const line of formatRepairInboxSurcharges(reports, command.apply)) output.log(line);
		}
		const failed = reports.reduce((sum, report) => sum + report.failed.length, 0);
		if (failed > 0) {
			throw new Error(
				`${failed} work period${failed === 1 ? " was" : "s were"} not repaired; review them and run again`,
			);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runRepairInboxSurchargesCli(process.argv.slice(2))
		.then(() => process.exit(0))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
