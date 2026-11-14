import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { JoiningBackfillReport } from "@/lib/employee-lifecycle/joining/backfill";

const HELP = `Join every approved member who has no employee (one-time backfill, #1671)

  pnpm employees:backfill-joining [--apply] [--organization-id <org-id>] [--json]

Without --apply this is a dry run: it lists, per organization, the members it
would join and changes nothing. Run it on production first, review the report,
then run again with --apply.

For every approved member with no employee row in their organization (or only
those of the organization named), it joins them as joining does (spec #1664):
an owner or admin membership becomes an admin employee with organization-wide
team permissions, any other membership an employee. A member who already has an
employee row, current or not, is never touched, so nobody deactivated is switched
back on. No invitation draft is applied and no seat signal is sent; the hourly
seat reconciliation counts them. Consumed invitation drafts are cleared.

Each member is joined in their own transaction, so an interrupted run keeps its
progress and a second run joins nobody. Members it could not join are listed and
the run exits non-zero; nothing was changed for them. Fix the cause and run again.

Options:
  --apply            Change data (default: dry run)
  --organization-id  Only this organization
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

type BackfillMemberEmployeesCommand =
	| { kind: "help" }
	| { kind: "backfill"; organizationId: string | null; json: boolean; apply: boolean };

export function parseBackfillMemberEmployeesCommand(
	args: string[],
): BackfillMemberEmployeesCommand {
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
		kind: "backfill",
		organizationId: organizationId ?? null,
		json: values.json === true,
		apply: values.apply === true,
	};
}

export function formatBackfillMemberEmployees(
	reports: readonly JoiningBackfillReport[],
	apply: boolean,
): string[] {
	const mode = apply ? "applied" : "dry run";
	const counted = apply ? "members joined" : "members to join";
	const lines: string[] = [];
	for (const report of reports) {
		lines.push(
			`Organization ${report.organizationId} (${mode}): ${counted} ${report.members.length}, failed ${report.failed.length}`,
		);
		for (const entry of report.members) {
			const joined = entry.employeeId ? `: employee ${entry.employeeId}` : "";
			lines.push(
				`    ${entry.name || entry.userId} (${entry.userId}), membership ${entry.memberId} (${entry.role ?? "no role"})${joined}`,
			);
		}
		for (const failure of report.failed) {
			lines.push(
				`    failed ${failure.name || failure.userId} (${failure.userId}), membership ${failure.memberId}: ${failure.error}`,
			);
		}
	}
	const total = (count: (report: JoiningBackfillReport) => number) =>
		reports.reduce((sum, report) => sum + count(report), 0);
	lines.push(
		"",
		`Total over ${reports.length} organizations (${mode}): ${counted} ${total((r) => r.members.length)}, failed ${total((r) => r.failed.length)}`,
	);
	if (!apply) lines.push("Nothing was changed. Review the report, then run again with --apply.");
	return lines;
}

interface BackfillMemberEmployeesDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	backfill?: (options: {
		organizationIds?: readonly string[];
		apply: boolean;
	}) => Promise<JoiningBackfillReport[]>;
	output?: { log(line: string): void };
}

export async function runBackfillMemberEmployeesCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: BackfillMemberEmployeesDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseBackfillMemberEmployeesCommand(args);
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
		const backfill =
			dependencies.backfill ??
			(async (options: { organizationIds?: readonly string[]; apply: boolean }) => {
				const [{ db }, { backfillMembersWithoutEmployee }] = await Promise.all([
					import("@/db"),
					import("@/lib/employee-lifecycle/joining/backfill"),
				]);
				return backfillMembersWithoutEmployee(db, options);
			});
		const reports = await backfill({
			...(command.organizationId ? { organizationIds: [command.organizationId] } : {}),
			apply: command.apply,
		});
		if (command.json) {
			output.log(JSON.stringify(reports, null, 2));
		} else {
			for (const line of formatBackfillMemberEmployees(reports, command.apply)) output.log(line);
		}
		const failed = reports.reduce((sum, report) => sum + report.failed.length, 0);
		if (failed > 0) {
			throw new Error(
				`${failed} member${failed === 1 ? " was" : "s were"} not joined; review them and run again`,
			);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runBackfillMemberEmployeesCli(process.argv.slice(2))
		.then(() => process.exit(0))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
