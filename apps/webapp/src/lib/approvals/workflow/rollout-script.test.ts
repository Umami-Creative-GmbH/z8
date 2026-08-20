import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as rolloutScript from "../../../../scripts/approval-workflow-rollout";
import {
	type ApprovalRolloutDatabase,
	executeApprovalWorkflowRollout,
	parseApprovalWorkflowRolloutCommand,
} from "../../../../scripts/approval-workflow-rollout";
import {
	APPROVAL_EXPANSION_CONTRACT,
	type ApprovalExpansionCatalog,
} from "../../../../scripts/approval-workflow-schema-contract";
import { getCutoverBehavior } from "./cutover";
import type { ApprovalTransactionClient } from "./ports";

const webappRoot = resolve(import.meta.dirname, "../../../..");
const scriptPath = "scripts/approval-workflow-rollout.ts";

function expectChildCompleted(result: ReturnType<typeof spawnSync>): void {
	if (result.error) {
		throw new Error(
			`Approval rollout subprocess did not complete: ${result.error.message}`,
			{ cause: result.error },
		);
	}
}

function cli(args: readonly string[]) {
	const environment = { ...process.env };
	for (const name of [
		"POSTGRES_HOST",
		"POSTGRES_PORT",
		"POSTGRES_DB",
		"POSTGRES_USER",
		"POSTGRES_PASSWORD",
	]) {
		delete environment[name];
	}
	return spawnSync("pnpm", ["exec", "tsx", scriptPath, ...args], {
		cwd: webappRoot,
		env: environment,
		encoding: "utf8",
		timeout: 12_000,
	});
}

function validCatalog(): ApprovalExpansionCatalog {
	return structuredClone(
		APPROVAL_EXPANSION_CONTRACT,
	) as ApprovalExpansionCatalog;
}

describe("approval workflow rollout CLI", () => {
	it("bounds blocking child processes below the Vitest subprocess timeout", () => {
		const source = readFileSync(import.meta.filename, "utf8");
		const timeoutOption = ["timeout", "12_000"].join(": ");
		expect(source.split(timeoutOption)).toHaveLength(3);
		expect(source.match(/expectChildCompleted\(result\)/g)).toHaveLength(3);
	});

	it("wires the dedicated workflow contract check into the webapp typecheck", () => {
		const packageJson = JSON.parse(
			readFileSync(resolve(webappRoot, "package.json"), "utf8"),
		) as { scripts?: Record<string, string> };
		expect(packageJson.scripts?.typecheck).toContain(
			"tsconfig.workflow-contracts.json",
		);
	});

	it("can be imported through tsx without executing main", () => {
		const result = spawnSync(
			"pnpm",
			["exec", "tsx", "--eval", `import('./${scriptPath}')`],
			{ cwd: webappRoot, encoding: "utf8", timeout: 12_000 },
		);
		expectChildCompleted(result);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).toBe("");
	}, 15_000);

	it.each([[[]], [["unknown"]]] as const)(
		"fails closed on a missing or unknown command before reading database env: %j",
		(args) => {
			const result = cli(args);
			expectChildCompleted(result);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toMatch(/unknown approval rollout command/i);
			expect(result.stderr).not.toMatch(
				/temporal-polyfill|package_path_not_exported/i,
			);
			expect(result.stderr).not.toMatch(/missing required environment/i);
		},
		15_000,
	);

	it("reaches main and checks environment after parsing a valid command", () => {
		const result = cli(["bootstrap"]);
		expectChildCompleted(result);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(
			/missing required environment variable postgres_host/i,
		);
		expect(result.stderr).not.toMatch(
			/temporal-polyfill|package_path_not_exported/i,
		);
	});

	it("closes the dynamically loaded CLI pool after success", async () => {
		const runCli = (
			rolloutScript as typeof rolloutScript & {
				runApprovalWorkflowRolloutCli?: (
					args: string[],
					environment: NodeJS.ProcessEnv,
					loadDatabase: () => Promise<unknown>,
				) => Promise<void>;
			}
		).runApprovalWorkflowRolloutCli;
		expect(runCli).toBeTypeOf("function");
		if (!runCli) return;
		const timeline: string[] = [];
		await runCli(
			["bootstrap"],
			{
				POSTGRES_HOST: "disposable",
				POSTGRES_PORT: "5432",
				POSTGRES_DB: "disposable",
				POSTGRES_USER: "disposable",
				POSTGRES_PASSWORD: "disposable",
			},
			async () => ({
				db: {
					transaction: async (
						callback: (tx: ApprovalTransactionClient) => Promise<void>,
					) => {
						timeline.push("transaction");
						await callback({ execute: async () => ({ rows: [] }) });
					},
				},
				pool: {
					end: async () => {
						timeline.push("close");
					},
				},
			}),
		);
		expect(timeline).toEqual(["transaction", "close"]);
	});

	it("closes on failure without masking the original command error", async () => {
		const runCli = (
			rolloutScript as typeof rolloutScript & {
				runApprovalWorkflowRolloutCli?: (
					args: string[],
					environment: NodeJS.ProcessEnv,
					loadDatabase: () => Promise<unknown>,
				) => Promise<void>;
			}
		).runApprovalWorkflowRolloutCli;
		expect(runCli).toBeTypeOf("function");
		if (!runCli) return;
		let closeCalls = 0;
		await expect(
			runCli(
				["bootstrap"],
				{
					POSTGRES_HOST: "disposable",
					POSTGRES_PORT: "5432",
					POSTGRES_DB: "disposable",
					POSTGRES_USER: "disposable",
					POSTGRES_PASSWORD: "disposable",
				},
				async () => ({
					db: {
						transaction: async () => {
							throw new Error("command failed");
						},
					},
					pool: {
						end: async () => {
							closeCalls += 1;
							throw new Error("close failed");
						},
					},
				}),
			),
		).rejects.toThrow("command failed");
		expect(closeCalls).toBe(1);
	});

	it.each([
		["close success", false],
		["close failure", true],
	] as const)(
		"preserves an undefined command rejection through %s",
		async (_name, closeFails) => {
			const runCli = rolloutScript.runApprovalWorkflowRolloutCli;
			const notRejected = Symbol("not rejected");
			let rejection: unknown = notRejected;
			await runCli(
				["bootstrap"],
				{
					POSTGRES_HOST: "disposable",
					POSTGRES_PORT: "5432",
					POSTGRES_DB: "disposable",
					POSTGRES_USER: "disposable",
					POSTGRES_PASSWORD: "disposable",
				},
				async () => ({
					db: { transaction: async () => Promise.reject(undefined) },
					pool: {
						end: async () => {
							if (closeFails) throw new Error("close failed");
						},
					},
				}),
			).then(
				() => undefined,
				(error: unknown) => {
					rejection = error;
				},
			);

			expect(rejection).not.toBe(notRejected);
			expect(rejection).toBeUndefined();
		},
	);

	it("rejects with the close error when the command succeeds", async () => {
		await expect(
			rolloutScript.runApprovalWorkflowRolloutCli(
				["bootstrap"],
				{
					POSTGRES_HOST: "disposable",
					POSTGRES_PORT: "5432",
					POSTGRES_DB: "disposable",
					POSTGRES_USER: "disposable",
					POSTGRES_PASSWORD: "disposable",
				},
				async () => ({
					db: {
						transaction: async (
							callback: (tx: ApprovalTransactionClient) => Promise<void>,
						) => callback({ execute: async () => ({ rows: [] }) }),
					},
					pool: { end: async () => Promise.reject(new Error("close failed")) },
				}),
			),
		).rejects.toThrow("close failed");
	});

	it("parses only bootstrap and explicit enter-shadow commands", () => {
		expect(parseApprovalWorkflowRolloutCommand(["bootstrap"])).toEqual({
			kind: "bootstrap",
		});
		expect(
			parseApprovalWorkflowRolloutCommand([
				"enter-shadow",
				"--organization-id",
				"org-1",
				"--workflow-type",
				"absence",
				"--operator-user-id",
				"user-1",
				"--evidence",
				"change-approval-42",
			]),
		).toEqual({
			kind: "enter-shadow",
			organizationId: "org-1",
			workflowType: "absence",
			operatorUserId: "user-1",
			evidence: "change-approval-42",
		});
		expect(() => parseApprovalWorkflowRolloutCommand(["canonical"])).toThrow(
			/unknown .*command/i,
		);
		expect(() =>
			parseApprovalWorkflowRolloutCommand([
				"enter-shadow",
				"--organization-id",
				"org-1",
			]),
		).toThrow(/workflow-type|operator|evidence/i);
	});

	it("bootstraps every organization and workflow type idempotently", async () => {
		const calls: SQL[] = [];
		const database = {
			transaction: async <T>(
				callback: (tx: { execute(query: SQL): Promise<unknown> }) => Promise<T>,
			) =>
				callback({
					execute: async (query) => {
						calls.push(query);
						return { rows: [] };
					},
				}),
		} as ApprovalRolloutDatabase;

		await executeApprovalWorkflowRollout({ kind: "bootstrap" }, database);
		const rendered = new PgDialect().sqlToQuery(calls[0] as SQL);
		expect(rendered.sql).toContain("insert into approval_workflow_rollout");
		expect(rendered.sql).toContain("updated_at");
		expect(rendered.sql).toContain("cross join");
		expect(rendered.sql.match(/::approval_workflow_type/g)).toHaveLength(7);
		expect(rendered.sql).toContain(
			"on conflict (organization_id, workflow_type) do nothing",
		);
		expect(rendered.params).toEqual(
			expect.arrayContaining([
				"absence",
				"time_correction",
				"manual_time_submission",
				"policy_clock_out",
				"travel_expense",
				"shift_request",
				"compliance_exception",
				expect.any(Date),
			]),
		);
	});

	it("enters shadow under one exclusive-lock transaction and records audit evidence", async () => {
		const calls: SQL[] = [];
		let transactionCalls = 0;
		let transactionCompleted = false;
		let auditObservedOpenTransaction = false;
		const database = {
			transaction: async <T>(
				callback: (tx: { execute(query: SQL): Promise<unknown> }) => Promise<T>,
			) => {
				transactionCalls += 1;
				const result = await callback({
					execute: async (query) => {
						calls.push(query);
						const rendered = new PgDialect().sqlToQuery(query).sql;
						if (rendered.includes("insert into audit_log")) {
							auditObservedOpenTransaction = !transactionCompleted;
						}
						if (rendered.includes("to_regclass")) {
							return {
								rows: [
									{
										approval_workflow: "approval_workflow",
										approval_workflow_stage: "approval_workflow_stage",
										approval_stage_assignment: "approval_stage_assignment",
										approval_workflow_event: "approval_workflow_event",
										approval_workflow_command: "approval_workflow_command",
										approval_requester_projection:
											"approval_requester_projection",
										approval_inbox_projection: "approval_inbox_projection",
										approval_workflow_rollout: "approval_workflow_rollout",
										approval_outbox: "approval_outbox",
									},
								],
							};
						}
						if (rendered.includes("pg_catalog.pg_class")) {
							return { rows: [{ catalog: validCatalog() }] };
						}
						if (rendered.includes("from approval_workflow_rollout")) {
							return {
								rows: [
									{
										id: "90000000-0000-4000-8000-000000000001",
										lifecycle_mode: "legacy",
									},
								],
							};
						}
						return { rows: [] };
					},
				});
				transactionCompleted = true;
				return result;
			},
		} as ApprovalRolloutDatabase;

		await executeApprovalWorkflowRollout(
			{
				kind: "enter-shadow",
				organizationId: "org-1",
				workflowType: "absence",
				operatorUserId: "user-1",
				evidence: "change-approval-42",
			},
			database,
		);

		const rendered = calls.map((query) => new PgDialect().sqlToQuery(query));
		expect(transactionCalls).toBe(1);
		expect(transactionCompleted).toBe(true);
		expect(auditObservedOpenTransaction).toBe(true);
		expect(rendered[0]?.sql).toContain("pg_advisory_xact_lock(");
		const rolloutReadIndex = rendered.findIndex((query) =>
			query.sql.includes("from approval_workflow_rollout"),
		);
		const schemaCheckIndex = rendered.findIndex((query) =>
			query.sql.includes("pg_catalog.pg_class"),
		);
		const update = rendered.find((query) =>
			query.sql.includes("update approval_workflow_rollout"),
		);
		const updateIndex = rendered.indexOf(update as (typeof rendered)[number]);
		expect(rolloutReadIndex).toBeGreaterThan(0);
		expect(schemaCheckIndex).toBeGreaterThan(rolloutReadIndex);
		expect(updateIndex).toBeGreaterThan(schemaCheckIndex);
		const schemaEvidence = rendered[schemaCheckIndex]?.params.find(
			(value) =>
				typeof value === "string" && value.includes("approval_outbox_delivery"),
		);
		expect(JSON.parse(String(schemaEvidence))).toMatchObject({
			tables: expect.arrayContaining([
				"approval_outbox_delivery",
				"approval_workflow_migration_issue",
			]),
		});
		expect(update?.sql).toContain("lifecycle_mode =");
		expect(update?.sql).toContain("backfilled_through = null");
		expect(update?.params).toEqual(
			expect.arrayContaining(["shadow", "legacy", "org-1", "absence"]),
		);
		const audit = rendered.find((query) =>
			query.sql.includes("insert into audit_log"),
		);
		const auditIndex = rendered.indexOf(audit as (typeof rendered)[number]);
		expect(auditIndex).toBeGreaterThan(updateIndex);
		expect(
			rendered.some((query) =>
				query.sql.includes("approval_workflow_migration_issue"),
			),
		).toBe(false);
		expect(audit?.params).toEqual(
			expect.arrayContaining([
				"org-1",
				"approval_workflow_rollout",
				"90000000-0000-4000-8000-000000000001",
				"approval_workflow.rollout_mode_changed",
				"user-1",
			]),
		);
		const evidence = audit?.params.find(
			(value) =>
				typeof value === "string" && value.includes("change-approval-42"),
		);
		expect(JSON.parse(String(evidence))).toMatchObject({
			workflowType: "absence",
			evidence: "change-approval-42",
			schemaVerification: {
				verified: true,
				tableCount: 11,
			},
			readiness: { backfilledThrough: null },
		});
		const changes = audit?.params.find(
			(value) => typeof value === "string" && value.includes('"from":"legacy"'),
		);
		expect(JSON.parse(String(changes))).toEqual({
			from: "legacy",
			to: "shadow",
		});
		expect(getCutoverBehavior("shadow")).toMatchObject({
			serveFrom: "legacy",
			mirror: "legacy_to_canonical",
		});
	});

	it("fails closed when expansion schema is unavailable", async () => {
		const database = {
			transaction: async <T>(
				callback: (tx: { execute(query: SQL): Promise<unknown> }) => Promise<T>,
			) =>
				callback({
					execute: async (query) => {
						const rendered = new PgDialect().sqlToQuery(query).sql;
						if (rendered.includes("from approval_workflow_rollout")) {
							return {
								rows: [
									{
										id: "90000000-0000-4000-8000-000000000001",
										lifecycle_mode: "legacy",
									},
								],
							};
						}
						if (rendered.includes("pg_catalog.pg_class")) {
							const catalog = validCatalog();
							catalog.tables = catalog.tables.filter(
								(table) => table !== "approval_outbox_delivery",
							);
							return { rows: [{ catalog }] };
						}
						return { rows: [] };
					},
				}),
		} as ApprovalRolloutDatabase;
		await expect(
			executeApprovalWorkflowRollout(
				{
					kind: "enter-shadow",
					organizationId: "org-1",
					workflowType: "absence",
					operatorUserId: "user-1",
					evidence: "approval",
				},
				database,
			),
		).rejects.toThrow(/schema/i);
	});
});
