import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	type ApprovalMaintenanceDatabase,
	deleteApproval,
	listApprovals,
} from "./approval-maintenance";

const HELP = `Approval maintenance (server operator access and database credentials required)

  pnpm approvals:list --organization-id <org-id>
  pnpm approvals:delete --organization-id <org-id> --id <approval-id>

List includes legacy requests and canonical workflows in all statuses.
Delete permanently removes the approval and its explicitly linked approval lifecycle.
Source time records, absences and other business records are preserved.

Options:
  --organization-id  Required organization scope
  --id               Approval UUID to delete (legacy request or workflow ID)
  --help             Show this help without connecting to the database
`;

type ApprovalMaintenanceCommand =
	| { kind: "help" }
	| { kind: "list"; organizationId: string }
	| { kind: "delete"; organizationId: string; id: string };

export function parseApprovalMaintenanceCommand(
	args: string[],
): ApprovalMaintenanceCommand {
	if (args.length === 1 && args[0] === "--help") return { kind: "help" };
	const [kind, ...options] = args;
	if (kind !== "list" && kind !== "delete") {
		throw new Error("Expected approval maintenance command: list or delete (use --help)");
	}
	const { values, tokens } = parseArgs({
		args: options,
		options: {
			"organization-id": { type: "string" },
			id: { type: "string" },
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
	if (kind === "list") {
		if (values.id !== undefined) throw new Error("list does not accept --id");
		return { kind, organizationId };
	}
	const id = values.id;
	if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
		throw new Error("delete requires --id with a valid approval UUID");
	}
	return { kind, organizationId, id };
}

interface MaintenanceConnection {
	db: ApprovalMaintenanceDatabase;
	pool: { end(): Promise<void> };
}

export async function runApprovalMaintenanceCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	loadDatabase: () => Promise<MaintenanceConnection> = () => import("@/db"),
	output: Pick<Console, "log" | "table"> = console,
): Promise<void> {
	const command = parseApprovalMaintenanceCommand(args);
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
	const { db, pool } = await loadDatabase();
	let commandFailed = false;
	let commandError: unknown;
	try {
		if (command.kind === "list") {
			const approvals = await listApprovals(db, command.organizationId);
			output.table(approvals);
			output.log(`${approvals.length} approval(s) in organization ${command.organizationId}`);
		} else {
			const result = await deleteApproval(db, command.organizationId, command.id);
			output.log(`Deleted approval ${command.id} in organization ${command.organizationId}`);
			output.table([
				...result.legacyRequests.map((id) => ({ storage_type: "legacy", id })),
				...result.workflows.map((id) => ({ storage_type: "workflow", id })),
				...result.chains.map((id) => ({ storage_type: "chain", id })),
			]);
		}
	} catch (error) {
		commandFailed = true;
		commandError = error;
	} finally {
		try {
			await pool.end();
		} catch (error) {
			if (!commandFailed) {
				commandFailed = true;
				commandError = error;
			}
		}
	}
	if (commandFailed) throw commandError;
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runApprovalMaintenanceCli(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
