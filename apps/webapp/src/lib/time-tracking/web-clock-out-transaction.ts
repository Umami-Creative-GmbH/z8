import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import type {
	ApprovalWorkflowDatabase,
	ApprovalWorkflowRepository,
} from "@/lib/approvals/workflow/repository";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	assertSameWebClockOutResources,
	lockWebClockOutResources,
	routeWebClockOutResources,
	WorkTransactionScopeChanged,
} from "./web-clock-out-resources";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WorkTransactionClient = Pick<
	Transaction,
	"execute" | "query" | "select" | "insert" | "update" | "delete"
>;

const protectedTransaction = Symbol("protected work transaction");

/** Trusted server composition only; no transaction/savepoint or adoption upgrade capability. */
export interface WorkTransactionContext {
	readonly [protectedTransaction]: true;
	readonly db: WorkTransactionClient;
	readonly approval: ApprovalWorkflowTransactionContext;
	readonly admission: "legacy";
	assertEmployee(organizationId: string, employeeId: string): void;
}

export interface WebClockOutTransactionInput {
	organizationId: string;
	employeeId: string;
	userId: string;
	submissionId: string;
	workPeriodId?: string;
	endTime?: Instant;
}

type ApprovalRuntimeFactory = (database: ApprovalWorkflowDatabase) => {
	repository: ApprovalWorkflowRepository;
};

export async function withWebClockOutTransaction<T>(
	input: WebClockOutTransactionInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (context: WorkTransactionContext) => Promise<T>,
): Promise<T> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await runAttempt(input, createApprovalRuntime, operation);
		} catch (error) {
			if (!(error instanceof WorkTransactionScopeChanged) || attempt >= 2)
				throw error;
		}
	}
}

async function runAttempt<T>(
	input: WebClockOutTransactionInput,
	createApprovalRuntime: ApprovalRuntimeFactory,
	operation: (context: WorkTransactionContext) => Promise<T>,
): Promise<T> {
	return db.transaction(async (transaction) => {
		const routed = await routeWebClockOutResources(transaction, input);
		let active = true;
		const assertActive = () => {
			if (!active) throw new Error("Work transaction is no longer active");
		};
		// The approval repository constructs its usual collaborators and checks its
		// reservation/CAS invariants, borrowing this transaction rather than nesting one.
		const runtime = createApprovalRuntime({
			transaction: async (callback) => {
				assertActive();
				return callback(transaction);
			},
		});
		try {
			return await runtime.repository.withTransaction(async (approval) => {
				await transaction.execute(
					sql`select pg_advisory_xact_lock_shared(hashtextextended(${JSON.stringify(["completed-work-adoption", input.organizationId])}, 0))`,
				);
				// T08 is a legacy-only prefactor. There is deliberately no activation
				// setter or new receipt/evidence capture before the parent gates pass.
				const authority = await approval.writeGate.acquire({
					organizationId: input.organizationId,
					workflowType: "policy_clock_out",
				});
				await transaction.execute(
					sql`select pg_advisory_xact_lock_shared(hashtextextended(${JSON.stringify(["work-organization-configuration", input.organizationId])}, 0))`,
				);
				await transaction.execute(
					sql`select pg_advisory_xact_lock_shared(hashtextextended(${JSON.stringify(["work-user-configuration-access", input.userId])}, 0))`,
				);
				await transaction.execute(
					sql`select pg_advisory_xact_lock(hashtextextended(${input.employeeId}, 0))`,
				);
				assertSameWebClockOutResources(
					routed,
					await routeWebClockOutResources(transaction, input),
				);
				await lockWebClockOutResources(transaction, input, routed);
				assertSameWebClockOutResources(
					routed,
					await routeWebClockOutResources(transaction, input),
				);
				const writeGate: ApprovalWorkflowTransactionContext["writeGate"] = {
					async acquire(scope) {
						assertActive();
						if (
							scope.organizationId !== input.organizationId ||
							scope.workflowType !== "policy_clock_out"
						) {
							throw new Error("Approval scope is outside the work transaction");
						}
						return authority;
					},
				};
				return operation(
					Object.freeze({
						[protectedTransaction]: true as const,
						db: transaction,
						approval: {
							...approval,
							writeGate,
							compatibilityWriter:
								approval.compatibilityWriter.withWriteGate(writeGate),
						},
						admission: "legacy" as const,
						assertEmployee(organizationId: string, employeeId: string) {
							assertActive();
							if (
								organizationId !== input.organizationId ||
								employeeId !== input.employeeId
							) {
								throw new Error(
									"Employee scope is outside the work transaction",
								);
							}
						},
					}),
				);
			});
		} finally {
			active = false;
		}
	});
}
