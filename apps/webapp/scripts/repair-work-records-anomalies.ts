import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type {
	AnomalyCategory,
	OrganizationAnomalyRepairReport,
	RepairWorkRecordsAnomaliesOptions,
} from "@/lib/time-tracking/repair-work-records-anomalies";

const ANOMALY_CATEGORIES: readonly AnomalyCategory[] = [
	"missing-end-at",
	"orphaned-pending",
	"unlinked-records",
];

const HELP = `Repair historical canonical work-record anomalies (missing end_at, orphaned pending flags, unlinked residue)

  pnpm time:repair-work-records-anomalies [--apply] [--organization-id <org-id>] [--only <categories>] [--json]

Without --apply this is a dry run: it reports, per organization, every anomaly
it would repair and changes nothing. Run it on production first, review the
report, then run again with --apply.

Categories (all three run by default; filter with --only):
  missing-end-at    Closed work_period rows whose linked canonical time_record
                    still has end_at IS NULL. Copies end_time through work
                    records' canonical repair.
  orphaned-pending  Closed work_period rows stuck in approval_status='pending'
                    (and/or pending_changes set) with approval_workflow_id IS NULL
                    and zero pending approval_request or approval_workflow rows.
                    Finalizes both work_period and time_record to approved and
                    clears pending_changes through work records' amend.
  unlinked-records  Unreferenced time_record (record_kind='work') rows not linked
                    by any work_period, approval_request, or approval decision
                    where an undeleted linked work_period already exists at the
                    same start_at. Prunes redundant residue through work records.

Each item runs in its own coordinated work transaction. Items in closed months,
still-referenced records, or mismatched pairs are skipped and reported without
aborting the run.

Options:
  --apply            Commit repairs (default: dry run)
  --organization-id  Only this organization
  --only             Comma-separated subset of: missing-end-at, orphaned-pending, unlinked-records
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

export type RepairWorkRecordsAnomaliesCommand =
	| { kind: "help" }
	| {
			kind: "repair";
			apply: boolean;
			organizationId: string | null;
			categories: AnomalyCategory[];
			json: boolean;
	  };

const VALID_CATEGORIES = new Set<string>(ANOMALY_CATEGORIES);

export function parseRepairWorkRecordsAnomaliesCommand(
	args: string[],
): RepairWorkRecordsAnomaliesCommand {
	const { values, tokens } = parseArgs({
		args,
		options: {
			apply: { type: "boolean" },
			"organization-id": { type: "string" },
			only: { type: "string" },
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

	let categories: AnomalyCategory[] = [...ANOMALY_CATEGORIES];
	if (values.only !== undefined) {
		const raw = values.only
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		if (raw.length === 0) {
			throw new Error(`--only needs at least one category (${ANOMALY_CATEGORIES.join(", ")})`);
		}
		for (const item of raw) {
			if (!VALID_CATEGORIES.has(item)) {
				throw new Error(
					`Unknown category "${item}" (expected one of: ${ANOMALY_CATEGORIES.join(", ")})`,
				);
			}
		}
		categories = [...new Set(raw)] as AnomalyCategory[];
	}

	return {
		kind: "repair",
		apply: values.apply === true,
		organizationId: organizationId?.trim() ?? null,
		categories,
		json: values.json === true,
	};
}

export function formatRepairWorkRecordsAnomalies(
	reports: readonly OrganizationAnomalyRepairReport[],
	apply: boolean,
): string[] {
	const mode = apply ? "applied" : "dry run";
	const verb = apply ? "repaired" : "to repair";
	const lines: string[] = [];

	for (const report of reports) {
		const byCategory = (category: AnomalyCategory) =>
			report.repaired.filter((item) => item.category === category).length;
		lines.push(
			`Organization ${report.organizationId} (${mode}): ` +
				`missing-end-at ${byCategory("missing-end-at")}/${report.scanned["missing-end-at"]}, ` +
				`orphaned-pending ${byCategory("orphaned-pending")}/${report.scanned["orphaned-pending"]}, ` +
				`unlinked-records ${byCategory("unlinked-records")}/${report.scanned["unlinked-records"]}, ` +
				`skipped ${report.skipped.length}, failed ${report.failed.length}`,
		);
		for (const item of report.repaired) {
			// Keep unlinked-records concise when hundreds exist; list missing-end-at & orphaned-pending individually.
			if (item.category === "unlinked-records") continue;
			lines.push(
				`    [${item.category}] ${verb} record ${item.recordId}` +
					(item.workPeriodId ? ` / period ${item.workPeriodId}` : "") +
					` (employee ${item.employeeId}, ${item.startAt}): ${item.detail}`,
			);
		}
		for (const skip of report.skipped) {
			lines.push(
				`    [${skip.category}] skipped ${skip.recordId ?? skip.workPeriodId ?? "unknown"}` +
					` (employee ${skip.employeeId}, ${skip.startAt}): ${skip.reason}`,
			);
		}
		for (const failure of report.failed) {
			lines.push(
				`    [${failure.category}] failed ${failure.recordId ?? failure.workPeriodId ?? "unknown"}` +
					` (employee ${failure.employeeId}, ${failure.startAt}): ${failure.error}`,
			);
		}
	}

	const totalRepaired = (category?: AnomalyCategory) =>
		reports.reduce(
			(sum, report) =>
				sum +
				(category
					? report.repaired.filter((item) => item.category === category).length
					: report.repaired.length),
			0,
		);
	const totalSkipped = reports.reduce((sum, report) => sum + report.skipped.length, 0);
	const totalFailed = reports.reduce((sum, report) => sum + report.failed.length, 0);

	lines.push(
		"",
		`Total over ${reports.length} organizations (${mode}): ` +
			`${verb} ${totalRepaired()} ` +
			`(missing-end-at ${totalRepaired("missing-end-at")}, ` +
			`orphaned-pending ${totalRepaired("orphaned-pending")}, ` +
			`unlinked-records ${totalRepaired("unlinked-records")}), ` +
			`skipped ${totalSkipped}, failed ${totalFailed}`,
	);
	if (!apply) {
		lines.push("Nothing was changed. Review the report, then run again with --apply.");
	}
	return lines;
}

interface RepairWorkRecordsAnomaliesDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	repair?: (
		options: RepairWorkRecordsAnomaliesOptions,
	) => Promise<OrganizationAnomalyRepairReport[]>;
	output?: { log(line: string): void };
}

export async function runRepairWorkRecordsAnomaliesCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: RepairWorkRecordsAnomaliesDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseRepairWorkRecordsAnomaliesCommand(args);
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
			(async (options: RepairWorkRecordsAnomaliesOptions) => {
				const [{ db }, { repairWorkRecordsAnomalies }] = await Promise.all([
					import("@/db"),
					import("@/lib/time-tracking/repair-work-records-anomalies"),
				]);
				return repairWorkRecordsAnomalies(db, options);
			});
		const reports = await repair({
			apply: command.apply,
			...(command.organizationId ? { organizationIds: [command.organizationId] } : {}),
			categories: command.categories,
		});
		if (command.json) {
			output.log(JSON.stringify(reports, null, 2));
		} else {
			for (const line of formatRepairWorkRecordsAnomalies(reports, command.apply)) {
				output.log(line);
			}
		}
		const failed = reports.reduce((sum, report) => sum + report.failed.length, 0);
		if (failed > 0) {
			throw new Error(
				`${failed} anomaly repair${failed === 1 ? "" : "s"} failed; review them and run again`,
			);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runRepairWorkRecordsAnomaliesCli(process.argv.slice(2))
		.then(() => process.exit(0))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
