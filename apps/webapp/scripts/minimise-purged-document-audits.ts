import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { PurgedDocumentAuditBackfillReport } from "@/lib/personnel-file/audit-minimisation-backfill";

const HELP = `Remove purged personnel file documents' descriptions from audit records (one-time backfill, #923)

  pnpm personnel-files:minimise-purged-audits [--organization-id <org-id>] [--json]

Run once after the release that minimises audit records at purge. Purges
before it kept the document's title, file name, ZIP entry name, title-change
values and free-text reasons in earlier audit records. For every document with
a purge record (or only those of the organization named), those descriptions
are removed now, by the same rules as new purges. Audit rows, ids and
timestamps stay, so the 365-day audit-log lifetime is unchanged.

Only a purge record counts as evidence: documents deleted by hand are left
alone, and a purge record whose document still exists is reported, not
trusted. Batches commit one by one; safe to run again: a second run changes
nothing and finishes what an interrupted run left.

Records it cannot process (unreadable JSON, a purge record naming no
employee, a document that still exists) are listed, and the run exits
non-zero. Fix or review them and run again.

Options:
  --organization-id  Only this organization
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

type MinimisePurgedDocumentAuditsCommand =
	| { kind: "help" }
	| { kind: "backfill"; organizationId: string | null; json: boolean };

export function parseMinimisePurgedDocumentAuditsCommand(
	args: string[],
): MinimisePurgedDocumentAuditsCommand {
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
	return { kind: "backfill", organizationId: organizationId ?? null, json: values.json === true };
}

function needingAttention(report: PurgedDocumentAuditBackfillReport): number {
	return (
		report.unprocessable.length + report.documentStillPresent.length + report.employeeUnknown.length
	);
}

export function formatMinimisePurgedDocumentAudits(
	reports: readonly PurgedDocumentAuditBackfillReport[],
): string[] {
	const lines: string[] = [];
	for (const report of reports) {
		lines.push(
			`Organization ${report.organizationId}: purge records ${report.purgeRecords}, minimised ${report.minimised}, unprocessable ${report.unprocessable.length}, document still present ${report.documentStillPresent.length}, employee unknown ${report.employeeUnknown.length}`,
		);
		for (const record of report.unprocessable) {
			lines.push(
				`    unprocessable ${record.auditId} (${record.entityType} ${record.entityId}): ${record.reason}`,
			);
		}
		for (const record of report.documentStillPresent) {
			lines.push(
				`    document still present: purge record ${record.auditId} names ${record.documentId}, which still exists`,
			);
		}
		for (const record of report.employeeUnknown) {
			lines.push(
				`    employee unknown: purge record ${record.auditId} (${record.documentId}) names no employee; ZIP records were not searched`,
			);
		}
	}
	const total = (count: (report: PurgedDocumentAuditBackfillReport) => number) =>
		reports.reduce((sum, report) => sum + count(report), 0);
	lines.push(
		"",
		`Total over ${reports.length} organizations: minimised ${total((r) => r.minimised)}, records needing attention ${total(needingAttention)}`,
	);
	return lines;
}

interface MinimisePurgedDocumentAuditsDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	backfill?: (options: {
		organizationIds?: readonly string[];
	}) => Promise<PurgedDocumentAuditBackfillReport[]>;
	output?: { log(line: string): void };
}

export async function runMinimisePurgedDocumentAuditsCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: MinimisePurgedDocumentAuditsDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseMinimisePurgedDocumentAuditsCommand(args);
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
			(async (options: { organizationIds?: readonly string[] }) => {
				const [{ db }, { backfillPurgedDocumentAudits }] = await Promise.all([
					import("@/db"),
					import("@/lib/personnel-file/audit-minimisation-backfill"),
				]);
				return backfillPurgedDocumentAudits(db, options);
			});
		const reports = await backfill(
			command.organizationId ? { organizationIds: [command.organizationId] } : {},
		);
		if (command.json) {
			output.log(JSON.stringify(reports, null, 2));
		} else {
			for (const line of formatMinimisePurgedDocumentAudits(reports)) output.log(line);
		}
		const attention = reports.reduce((sum, report) => sum + needingAttention(report), 0);
		if (attention > 0) {
			throw new Error(
				`${attention} record${attention === 1 ? " needs" : "s need"} attention; review them and run again`,
			);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runMinimisePurgedDocumentAuditsCli(process.argv.slice(2))
		.then(() => process.exit(0))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
