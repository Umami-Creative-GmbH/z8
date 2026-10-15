import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { OrganizationWorkRecordAttachment } from "@/lib/time-record/migration/attach-missing-work-records";

const HELP = `Attach missing canonical work records (deploy backfill of migration 0234, spec #1212)

  pnpm work-records:attach-missing [--organization-id <org-id>] [--json]

Run right after migrate. Every completed work period without a canonical work
record gets one through work records' attach, one period at a time, for every
organization (or only the one named). Work touching a closed month is skipped
and stays a half pair until the month reopens. Attaching changes no work: no
period submission is sent back and no balance is marked. Safe to run again:
a second run attaches only what is still missing.

Reports per organization: attached, closed-month skips and refused periods with
their reason. Refused periods stay for work diagnostics and its repairs; they
do not block payroll.

Options:
  --organization-id  Only this organization
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

type AttachMissingWorkRecordsCommand =
	| { kind: "help" }
	| { kind: "attach"; organizationId: string | null; json: boolean };

export function parseAttachMissingWorkRecordsCommand(
	args: string[],
): AttachMissingWorkRecordsCommand {
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
	if (organizationId !== undefined && (!organizationId.trim() || organizationId.startsWith("--"))) {
		throw new Error("--organization-id needs an organization id");
	}
	return { kind: "attach", organizationId: organizationId ?? null, json: values.json === true };
}

export function formatAttachMissingWorkRecords(
	reports: readonly OrganizationWorkRecordAttachment[],
): string[] {
	const lines: string[] = [];
	for (const report of reports) {
		lines.push(
			`Organization ${report.organizationId}: attached ${report.attached.length}, closed-month skips ${report.closedMonthSkips.length}, refused ${report.refused.length}`,
		);
		for (const refused of report.refused) {
			lines.push(
				`    refused ${refused.workPeriodId} (employee ${refused.employeeId}, ${refused.startAt} to ${refused.endAt}): ${refused.reason}`,
			);
		}
	}
	const total = (count: (report: OrganizationWorkRecordAttachment) => number) =>
		reports.reduce((sum, report) => sum + count(report), 0);
	lines.push(
		"",
		`Total over ${reports.length} organizations: attached ${total((r) => r.attached.length)}, closed-month skips ${total((r) => r.closedMonthSkips.length)}, refused ${total((r) => r.refused.length)}`,
	);
	return lines;
}

interface AttachMissingWorkRecordsDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	attach?: (options: {
		organizationIds?: readonly string[];
	}) => Promise<OrganizationWorkRecordAttachment[]>;
	output?: { log(line: string): void };
}

export async function runAttachMissingWorkRecordsCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: AttachMissingWorkRecordsDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseAttachMissingWorkRecordsCommand(args);
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
	const attach =
		dependencies.attach ??
		(await import("@/lib/time-record/migration/attach-missing-work-records"))
			.attachMissingWorkRecordsInEveryOrganization;
	try {
		const reports = await attach(
			command.organizationId ? { organizationIds: [command.organizationId] } : {},
		);
		if (command.json) {
			output.log(JSON.stringify(reports, null, 2));
		} else {
			for (const line of formatAttachMissingWorkRecords(reports)) output.log(line);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runAttachMissingWorkRecordsCli(process.argv.slice(2))
		.then(() => process.exit(0))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
