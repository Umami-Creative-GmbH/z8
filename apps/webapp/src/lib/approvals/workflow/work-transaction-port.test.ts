import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { fakeWorkTransaction } from "@/lib/time-tracking/work-transaction/testing";
import { createApprovalWriteGate } from "../authority";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import { ApprovalWriteGateScopeMismatch } from "./pinned-write-gate";
import type { ApprovalDbService } from "./ports";
import type { ApprovalWorkflowDatabase } from "./repository";
import { approvalWorkTransactionPort } from "./work-transaction-port";

const organizationId = "org-1";
const route = {
	users: ["user-1"],
	employees: ["emp-1"],
	writeTargets: ["emp-1"],
	approvalGate: "manual_time_submission",
};

function harness() {
	const statements: string[] = [];
	const client = {
		execute: async (query: SQL) => {
			const rendered = new PgDialect().sqlToQuery(query).sql;
			statements.push(rendered);
			return rendered.includes("select lifecycle_mode")
				? { rows: [{ lifecycle_mode: "canonical" }] }
				: { rows: [] };
		},
	};
	const borrowed: { database: ApprovalWorkflowDatabase | null; transaction: unknown } = {
		database: null,
		transaction: null,
	};
	// Stands in for the approval runtime: its repository opens a transaction on
	// the database it was built with and hands its collaborators that client.
	const port = approvalWorkTransactionPort((database) => {
		borrowed.database = database;
		return {
			repository: {
				withTransaction: <T>(
					operation: (context: ApprovalWorkflowTransactionContext) => Promise<T>,
				) =>
					database.transaction(async (transaction) => {
						borrowed.transaction = transaction;
						const dbService = { db: transaction } as unknown as ApprovalDbService;
						const writeGate = createApprovalWriteGate(dbService);
						return operation({
							dbService,
							writeGate,
							compatibilityWriter: {
								withWriteGate: (gate: unknown) => ({ gate }),
							},
						} as unknown as ApprovalWorkflowTransactionContext);
					}),
			},
		} as never;
	});
	const locks = () => statements.filter((statement) => statement.includes("lock_shared")).length;
	return { client, port, borrowed, locks };
}

describe("approvalWorkTransactionPort", () => {
	it("borrows the work transaction and pins the gate taken at rank 2", async () => {
		const { client, port, borrowed, locks } = harness();
		const fake = fakeWorkTransaction({ client });
		let routed: unknown = null;

		const authority = await fake.run(
			{
				organizationId,
				route: async (db) => {
					routed = db;
					return route;
				},
				approval: port,
			},
			(scope) =>
				scope.approval.writeGate.acquire({
					organizationId,
					workflowType: "manual_time_submission",
				}),
		);

		expect(borrowed.transaction).toBe(routed);
		expect(authority).toMatchObject({ authority: "canonical" });
		// The pinned gate answers without acquiring a second time.
		expect(locks()).toBe(1);
	});

	it("refuses another workflow type through the pinned gate", async () => {
		const { client, port } = harness();
		const fake = fakeWorkTransaction({ client });
		await expect(
			fake.run({ organizationId, route: async () => route, approval: port }, (scope) =>
				scope.approval.writeGate.acquire({ organizationId, workflowType: "policy_clock_out" }),
			),
		).rejects.toBeInstanceOf(ApprovalWriteGateScopeMismatch);
	});

	it("refuses the borrowed transaction and the pinned gate once the attempt settles", async () => {
		const { client, port, borrowed } = harness();
		const fake = fakeWorkTransaction({ client });
		const approval = await fake.run(
			{ organizationId, route: async () => route, approval: port },
			async (scope) => scope.approval,
		);

		await expect(
			approval.writeGate.acquire({ organizationId, workflowType: "manual_time_submission" }),
		).rejects.toThrow("Work transaction is no longer active");
		await expect(borrowed.database?.transaction(async () => undefined)).rejects.toThrow(
			"Work transaction is no longer active",
		);
	});
});
