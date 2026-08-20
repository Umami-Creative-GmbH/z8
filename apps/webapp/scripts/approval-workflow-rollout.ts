import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type SQL, sql } from "drizzle-orm";
import { acquireApprovalCutoverLock } from "@/lib/approvals/workflow/cutover";
import type { ApprovalTransactionClient } from "@/lib/approvals/workflow/ports";
import {
	APPROVAL_WORKFLOW_TYPES,
	type ApprovalWorkflowType,
} from "@/lib/approvals/workflow/types";
import { currentTimestamp } from "@/lib/datetime/drizzle-schema";
import { loadAndValidateApprovalExpansionSchema } from "./approval-workflow-schema-contract";

export type ApprovalRolloutCommand =
	| { kind: "bootstrap" }
	| {
			kind: "enter-shadow";
			organizationId: string;
			workflowType: ApprovalWorkflowType;
			operatorUserId: string;
			evidence: string;
	  };

export interface ApprovalRolloutDatabase {
	transaction<T>(
		callback: (transaction: ApprovalTransactionClient) => Promise<T>,
	): Promise<T>;
}

function option(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	const value = args[index + 1];
	return value && !value.startsWith("--") ? value : undefined;
}

export function parseApprovalWorkflowRolloutCommand(
	args: string[],
): ApprovalRolloutCommand {
	const [command, ...options] = args;
	if (command === "bootstrap") {
		if (options.length > 0) throw new Error("bootstrap accepts no arguments");
		return { kind: "bootstrap" };
	}
	if (command !== "enter-shadow") {
		throw new Error(
			`Unknown approval rollout command: ${command ?? "<missing>"}`,
		);
	}

	const organizationId = option(options, "--organization-id");
	const workflowType = option(options, "--workflow-type");
	const operatorUserId = option(options, "--operator-user-id");
	const evidence = option(options, "--evidence");
	if (!organizationId || !workflowType || !operatorUserId || !evidence) {
		throw new Error(
			"enter-shadow requires --organization-id, --workflow-type, --operator-user-id, and --evidence",
		);
	}
	if (!APPROVAL_WORKFLOW_TYPES.includes(workflowType as ApprovalWorkflowType)) {
		throw new Error(`Unsupported approval workflow type: ${workflowType}`);
	}
	if (options.length !== 8)
		throw new Error("Unexpected enter-shadow arguments");

	return {
		kind: "enter-shadow",
		organizationId,
		workflowType: workflowType as ApprovalWorkflowType,
		operatorUserId,
		evidence,
	};
}

function rowsFrom(result: unknown): unknown[] {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	return Array.isArray(result.rows) ? result.rows : [];
}

function bootstrapSql(): SQL {
	const workflowRows = APPROVAL_WORKFLOW_TYPES.map(
		(workflowType) => sql`(${workflowType}::approval_workflow_type)`,
	);
	const updatedAt = currentTimestamp();
	return sql`
		insert into approval_workflow_rollout (
			organization_id, workflow_type, lifecycle_mode, side_effect_mode, updated_at
		)
		select organization.id, workflow_type.value, ${"legacy"}, ${"legacy"}, ${updatedAt}
		from organization
		cross join (values ${sql.join(workflowRows, sql`, `)}) as workflow_type(value)
		on conflict (organization_id, workflow_type) do nothing
	`;
}

function currentRollout(result: unknown): { id: string; mode: string } | null {
	const row = rowsFrom(result)[0];
	if (
		!row ||
		typeof row !== "object" ||
		!("id" in row) ||
		!("lifecycle_mode" in row) ||
		typeof row.id !== "string" ||
		typeof row.lifecycle_mode !== "string"
	) {
		return null;
	}
	return { id: row.id, mode: row.lifecycle_mode };
}

export async function executeApprovalWorkflowRollout(
	command: ApprovalRolloutCommand,
	database: ApprovalRolloutDatabase,
): Promise<void> {
	if (command.kind === "bootstrap") {
		await database.transaction(async (transaction) => {
			await transaction.execute(bootstrapSql());
		});
		return;
	}

	await database.transaction(async (transaction) => {
		const dbService = { db: transaction };
		await acquireApprovalCutoverLock(dbService, command);
		const rollout = await transaction.execute(sql`
			select id, lifecycle_mode
			from approval_workflow_rollout
			where organization_id = ${command.organizationId}
				and workflow_type = ${command.workflowType}
			for update
		`);
		const current = currentRollout(rollout);
		if (current?.mode !== "legacy") {
			throw new Error(
				current
					? `enter-shadow requires legacy mode, found ${current.mode}`
					: "Missing rollout row; run bootstrap first",
			);
		}
		const schemaCatalog =
			await loadAndValidateApprovalExpansionSchema(transaction);

		const recordedAt = currentTimestamp();

		await transaction.execute(sql`
			update approval_workflow_rollout
			set lifecycle_mode = ${"shadow"},
				side_effect_mode = ${"legacy"},
				backfilled_through = null,
				mismatch_count = 0,
				last_reconciled_at = null,
				updated_at = ${recordedAt}
			where organization_id = ${command.organizationId}
				and workflow_type = ${command.workflowType}
		`);

		const changes = JSON.stringify({ from: current.mode, to: "shadow" });
		const auditMetadata = JSON.stringify({
			workflowType: command.workflowType,
			evidence: command.evidence,
			schemaVerification: {
				verified: true,
				tableCount: schemaCatalog.tables.length,
				enumCount: Object.keys(schemaCatalog.enums).length,
			},
			readiness: { backfilledThrough: null },
		});
		await transaction.execute(sql`
			insert into audit_log (
				organization_id, entity_type, entity_id, action, performed_by,
				changes, metadata, timestamp
			) values (
				${command.organizationId}, ${"approval_workflow_rollout"}, ${current.id},
				${"approval_workflow.rollout_mode_changed"}, ${command.operatorUserId},
				${changes}, ${auditMetadata}, ${recordedAt}
			)
		`);
	});
}

function assertDatabaseEnvironment(environment: NodeJS.ProcessEnv): void {
	for (const name of [
		"POSTGRES_HOST",
		"POSTGRES_PORT",
		"POSTGRES_DB",
		"POSTGRES_USER",
		"POSTGRES_PASSWORD",
	]) {
		if (!environment[name])
			throw new Error(`Missing required environment variable ${name}`);
	}
}

async function main(): Promise<void> {
	await runApprovalWorkflowRolloutCli(process.argv.slice(2), process.env);
}

export async function runApprovalWorkflowRolloutCli(
	args: string[],
	environment: NodeJS.ProcessEnv,
	loadDatabase: () => Promise<unknown> = () => import("@/db"),
): Promise<void> {
	const command = parseApprovalWorkflowRolloutCommand(args);
	assertDatabaseEnvironment(environment);
	const loaded = (await loadDatabase()) as {
		db: {
			transaction<T>(
				callback: (transaction: unknown) => Promise<T>,
			): Promise<T>;
		};
		pool: { end(): Promise<void> };
	};
	const database: ApprovalRolloutDatabase = {
		transaction: (callback) =>
			loaded.db.transaction((transaction) =>
				callback(transaction as ApprovalTransactionClient),
			),
	};
	let commandFailed = false;
	let commandError: unknown;
	let closeFailed = false;
	let closeError: unknown;
	try {
		await executeApprovalWorkflowRollout(command, database);
	} catch (error) {
		commandFailed = true;
		commandError = error;
	} finally {
		try {
			await loaded.pool.end();
		} catch (error) {
			closeFailed = true;
			closeError = error;
		}
	}
	if (commandFailed) throw commandError;
	if (closeFailed) throw closeError;
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
