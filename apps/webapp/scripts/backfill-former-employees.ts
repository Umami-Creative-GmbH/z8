import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type {
	DeactivationBackfillEmployee,
	DeactivationBackfillReport,
} from "@/lib/employee-lifecycle/deactivation/backfill";

const HELP = `Give employees deactivated before #1440 a deactivation's consequences (one-time backfill, #1442)

  pnpm employees:backfill-deactivations [--apply] [--organization-id <org-id>] [--json]

Without --apply this is a dry run: it reports, per organization, everything it
would change and changes nothing. Run it on production first, review the
report, then run again with --apply.

For every former employee who is inactive with no departure and no
deactivation record (or only those of the organization named), it:

  1. recovers when they left from the latest surviving "employee.deactivated"
     audit entry or SCIM leave event (audit entries live 365 days); without
     evidence the date stays "not recorded".
  2. applies a deactivation's consequences from that instant, else from the run
     instant: manager links of reports who keep another current manager and
     their own manager links end, team memberships and project links end,
     approval duties are handed over, later shifts open, later absences are
     cancelled, grants, driving authorizations, kiosk badges and share links
     end. Every change is audited with the reason employee_deactivation_backfill.
  3. keeps the manager link of reports who would be left with no current
     manager, lists them, and tells each organization's current owners and
     admins once (in-app and their chosen channels).

Each employee is applied in its own transaction and recorded, so an
interrupted run keeps its progress and a second run changes nothing.
Employees it could not backfill are listed and the run exits non-zero; nothing
was changed for them. Fix the cause and run again.

Options:
  --apply            Change data (default: dry run)
  --organization-id  Only this organization
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

type BackfillFormerEmployeesCommand =
	| { kind: "help" }
	| { kind: "backfill"; organizationId: string | null; json: boolean; apply: boolean };

export function parseBackfillFormerEmployeesCommand(
	args: string[],
): BackfillFormerEmployeesCommand {
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

function counts(entry: DeactivationBackfillEmployee): string {
	const { plan } = entry;
	const parts: Array<[string, number]> = [
		[
			"manager links ending",
			plan.managerLinks.reportsKeepingAnotherManager.length +
				plan.managerLinks.ownManagerLinks.length,
		],
		["manager links kept", plan.managerLinks.reportsNeedingReplacement.length],
		["teams", plan.teamLinks.teams.length],
		[
			"project links",
			plan.teamLinks.projectAssignments.length + plan.teamLinks.projectManagerLinks.length,
		],
		["approval handovers", plan.approvalDuties.handovers.length],
		["reviews", plan.approvalDuties.reviews.length],
		["shifts opened", plan.shifts.shiftsToOpen.length],
		["absences cancelled", plan.absences.absencesToCancel.length],
		[
			"access ended",
			plan.accessEnds.grants.length +
				plan.accessEnds.drivingAuthorizations.length +
				plan.accessEnds.kioskBadges.length +
				plan.accessEnds.shareLinks.length,
		],
	];
	return parts.map(([label, count]) => `${label} ${count}`).join(", ");
}

const SOURCE_LABEL: Record<NonNullable<DeactivationBackfillEmployee["leftAtSource"]>, string> = {
	employee: "already recorded",
	audit_log: "audit log",
	scim: "SCIM",
};

export function formatBackfillFormerEmployees(
	reports: readonly DeactivationBackfillReport[],
	apply: boolean,
): string[] {
	const mode = apply ? "applied" : "dry run";
	const lines: string[] = [];
	for (const report of reports) {
		lines.push(
			`Organization ${report.organizationId} (${mode}): former employees ${report.employees.length}, failed ${report.failed.length}`,
		);
		for (const entry of report.employees) {
			const left = entry.leftAt
				? `left ${entry.leftAt} (${entry.leftAtSource ? SOURCE_LABEL[entry.leftAtSource] : "unknown"})`
				: "left: not recorded";
			lines.push(
				`    ${entry.name || entry.employeeId} (${entry.employeeId}): ${left}; consequences from ${entry.consequencesFrom}; audited as ${entry.actorUserId}`,
				`        ${counts(entry)}`,
			);
		}
		if (report.reportsWithoutManager.length > 0) {
			const names = report.reportsWithoutManager
				.map((item) => `${item.name || item.employeeId} (${item.employeeId})`)
				.join(", ");
			lines.push(
				`    reports with no current manager (${apply ? "told" : "would tell"} ${report.adminUserIds.length} admins): ${names}`,
			);
		}
		for (const failure of report.failed) {
			lines.push(
				`    failed ${failure.name || failure.employeeId} (${failure.employeeId}): ${failure.error}`,
			);
		}
		for (const warning of report.warnings) {
			lines.push(`    warning ${warning.employeeId}: ${warning.message}`);
		}
	}
	const total = (count: (report: DeactivationBackfillReport) => number) =>
		reports.reduce((sum, report) => sum + count(report), 0);
	lines.push(
		"",
		`Total over ${reports.length} organizations (${mode}): former employees ${total((r) => r.employees.length)}, failed ${total((r) => r.failed.length)}`,
	);
	if (!apply) lines.push("Nothing was changed. Review the report, then run again with --apply.");
	return lines;
}

interface BackfillFormerEmployeesDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	backfill?: (options: {
		organizationIds?: readonly string[];
		apply: boolean;
	}) => Promise<DeactivationBackfillReport[]>;
	output?: { log(line: string): void };
}

export async function runBackfillFormerEmployeesCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: BackfillFormerEmployeesDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseBackfillFormerEmployeesCommand(args);
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
				const [{ db }, { backfillDeactivatedEmployees }] = await Promise.all([
					import("@/db"),
					import("@/lib/employee-lifecycle/deactivation/backfill"),
				]);
				return backfillDeactivatedEmployees(db, options);
			});
		const reports = await backfill({
			...(command.organizationId ? { organizationIds: [command.organizationId] } : {}),
			apply: command.apply,
		});
		if (command.json) {
			output.log(JSON.stringify(reports, null, 2));
		} else {
			for (const line of formatBackfillFormerEmployees(reports, command.apply)) output.log(line);
		}
		const failed = reports.reduce((sum, report) => sum + report.failed.length, 0);
		if (failed > 0) {
			throw new Error(
				`${failed} employee${failed === 1 ? " was" : "s were"} not backfilled; review them and run again`,
			);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runBackfillFormerEmployeesCli(process.argv.slice(2))
		.then(() => process.exit(0))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
