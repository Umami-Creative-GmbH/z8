import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	type Clock,
	type Instant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type {
	CloseOpenWorkPeriodsOptions,
	OrganizationOpenWorkPeriodReport,
} from "@/lib/time-tracking/close-open-work-periods";

const DEFAULT_OLDER_THAN_HOURS = 12;

const HELP = `Close prior open work periods through canonical work-record closure

  pnpm time:close-open-periods [--apply] [--organization-id <org-id>] [--older-than-hours <hours> | --before <iso-timestamp>] [--max-duration-minutes <minutes>] [--json]

Without --apply this is a dry run: it reports, per organization, every open
work period matching the cutoff and the timestamp it would be closed at,
without changing any data. Run it first, review the report, then run again
with --apply.

Each qualifying open work period (deleted_at IS NULL, end_time IS NULL,
is_active = true, clock_out_id IS NULL) is closed in its own coordinated work
transaction through Z8's canonical work-record writer (creating the clock-out
time entry with captured UTC offset, closing the work period, writing the
canonical time record and allocations, and marking work balances dirty).

Closure timestamp per period:
  1. If a break in progress started earlier than the cap, closes at break start.
  2. If the employee has a later work period starting earlier than the cap,
     caps at that next work period's start to prevent overlapping work.
  3. Otherwise caps at start_time + max-duration-minutes (defaults to the
     organization's automatic clock-out cap, 720 minutes / 12h), never in the future.

Periods in closed months, anomalous rows (end_time IS NULL with is_active = false
or clock_out_id set), and employees requiring append-history review are skipped
and reported without aborting the rest of the run.

Options:
  --apply                 Commit closures (default: dry run)
  --organization-id       Only this organization
  --older-than-hours      Close open periods started at least N hours ago (default: 12; 0 = all started before now)
  --before                Close open periods started on or before this ISO-8601 instant (e.g. 2026-11-21T00:00:00Z)
  --max-duration-minutes  Override maximum shift duration cap in minutes (default: org auto-clock-out setting / 720)
  --json                  Print the full report as JSON
  --help                  Show this help without connecting to the database
`;

export type CloseOpenWorkPeriodsCommand =
	| { kind: "help" }
	| {
			kind: "close";
			apply: boolean;
			organizationId: string | null;
			startedBefore: Instant;
			maxDurationMinutes: number | null;
			json: boolean;
	  };

export function parseCloseOpenWorkPeriodsCommand(
	args: string[],
	now: Instant = systemClock.nowInstant(),
): CloseOpenWorkPeriodsCommand {
	const { values, tokens } = parseArgs({
		args,
		options: {
			apply: { type: "boolean" },
			"organization-id": { type: "string" },
			"older-than-hours": { type: "string" },
			before: { type: "string" },
			"max-duration-minutes": { type: "string" },
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

	const olderThanRaw = values["older-than-hours"];
	const beforeRaw = values.before;
	if (olderThanRaw !== undefined && beforeRaw !== undefined) {
		throw new Error("Use either --older-than-hours or --before, not both");
	}

	let startedBefore: Instant;
	if (beforeRaw !== undefined) {
		if (!beforeRaw.trim() || beforeRaw.startsWith("--")) {
			throw new Error("--before needs an ISO-8601 instant (e.g. 2026-11-21T00:00:00Z)");
		}
		try {
			startedBefore = parseInstant(beforeRaw.trim());
		} catch {
			throw new Error(`Invalid --before instant: ${beforeRaw}`);
		}
	} else {
		const hours =
			olderThanRaw === undefined ? DEFAULT_OLDER_THAN_HOURS : Number(olderThanRaw.trim());
		if (!Number.isFinite(hours) || hours < 0) {
			throw new Error("--older-than-hours must be a non-negative number");
		}
		startedBefore = now.subtract({ milliseconds: Math.round(hours * 3_600_000) });
	}

	let maxDurationMinutes: number | null = null;
	const maxDurationRaw = values["max-duration-minutes"];
	if (maxDurationRaw !== undefined) {
		const parsed = Number(maxDurationRaw.trim());
		if (!Number.isSafeInteger(parsed) || parsed < 1) {
			throw new Error("--max-duration-minutes must be a positive integer");
		}
		maxDurationMinutes = parsed;
	}

	return {
		kind: "close",
		apply: values.apply === true,
		organizationId: organizationId?.trim() ?? null,
		startedBefore,
		maxDurationMinutes,
		json: values.json === true,
	};
}

export function formatCloseOpenWorkPeriods(
	reports: readonly OrganizationOpenWorkPeriodReport[],
	apply: boolean,
): string[] {
	const mode = apply ? "applied" : "dry run";
	const verb = apply ? "closed" : "to close";
	const lines: string[] = [];
	for (const report of reports) {
		if (report.scanned === 0) continue;
		lines.push(
			`Organization ${report.organizationId} (${mode}): scanned ${report.scanned}, ${verb} ${report.closed.length}, skipped ${report.skipped.length}, failed ${report.failed.length}`,
		);
		for (const item of report.closed) {
			const replayTag = item.replayed ? " [replayed]" : "";
			lines.push(
				`    ${verb} ${item.workPeriodId} (employee ${item.employeeId}): ${item.startAt} -> ${item.closeAt} (${item.durationMinutes}m, ${item.closeReason}, ${item.timezone})${replayTag}`,
			);
		}
		for (const skip of report.skipped) {
			lines.push(
				`    skipped ${skip.workPeriodId} (employee ${skip.employeeId}, started ${skip.startAt}): ${skip.reason}`,
			);
		}
		for (const failure of report.failed) {
			lines.push(
				`    failed ${failure.workPeriodId} (employee ${failure.employeeId}, started ${failure.startAt}): ${failure.error}`,
			);
		}
	}
	const total = (count: (report: OrganizationOpenWorkPeriodReport) => number) =>
		reports.reduce((sum, report) => sum + count(report), 0);
	lines.push(
		"",
		`Total over ${reports.length} organizations (${mode}): scanned ${total((r) => r.scanned)}, ${verb} ${total((r) => r.closed.length)}, skipped ${total((r) => r.skipped.length)}, failed ${total((r) => r.failed.length)}`,
	);
	if (!apply) {
		lines.push("Nothing was changed. Review the report, then run again with --apply.");
	}
	return lines;
}

interface CloseOpenWorkPeriodsDependencies {
	clock?: Clock;
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	closeOpen?: (
		options: CloseOpenWorkPeriodsOptions,
	) => Promise<OrganizationOpenWorkPeriodReport[]>;
	output?: { log(line: string): void };
}

export async function runCloseOpenWorkPeriodsCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: CloseOpenWorkPeriodsDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const clock = dependencies.clock ?? systemClock;
	const command = parseCloseOpenWorkPeriodsCommand(args, clock.nowInstant());
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
		const closeOpen =
			dependencies.closeOpen ??
			(async (options: CloseOpenWorkPeriodsOptions) => {
				const [{ db }, { closeOpenWorkPeriods }] = await Promise.all([
					import("@/db"),
					import("@/lib/time-tracking/close-open-work-periods"),
				]);
				return closeOpenWorkPeriods(db, options);
			});
		const reports = await closeOpen({
			apply: command.apply,
			...(command.organizationId ? { organizationIds: [command.organizationId] } : {}),
			startedBefore: command.startedBefore,
			maxDurationMinutes: command.maxDurationMinutes,
			clock,
		});
		if (command.json) {
			output.log(JSON.stringify(reports, null, 2));
		} else {
			for (const line of formatCloseOpenWorkPeriods(reports, command.apply)) {
				output.log(line);
			}
		}
		const failed = reports.reduce((sum, report) => sum + report.failed.length, 0);
		if (failed > 0) {
			throw new Error(
				`${failed} open work period${failed === 1 ? " was" : "s were"} not closed; review them and run again`,
			);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runCloseOpenWorkPeriodsCli(process.argv.slice(2))
		.then(() => process.exit(0))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
