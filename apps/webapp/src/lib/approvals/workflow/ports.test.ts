import { describe, expect, expectTypeOf, it } from "vitest";
import type { ApprovalDomainAdapterRegistry } from "../domain-adapters/registry";
import type {
	ApprovalDomainAdapter,
	ApprovalWorkflowTransactionContext,
} from "../domain-adapters/types";
import type {
	ApprovalCommandActorResolver,
	ApprovalDbService,
	ApprovalWorkflowAuthorization,
	ApprovalWorkflowSourceLoader,
	TransactionalWorkflowRepository,
} from "./ports";

type HasTransaction<T> = "transaction" extends keyof T ? true : false;
type AssertFalse<T extends false> = T;

describe("approval workflow port contracts", () => {
	it("does not expose transaction ownership from transaction-bound ports", () => {
		const transactionClientCannotStartTransaction: AssertFalse<
			HasTransaction<ApprovalDbService["db"]>
		> = false;
		const repositoryCannotStartTransaction: AssertFalse<
			HasTransaction<TransactionalWorkflowRepository>
		> = false;
		expect(transactionClientCannotStartTransaction).toBe(false);
		expect(repositoryCannotStartTransaction).toBe(false);
	});

	it("keeps the future engine context complete and the adapter registry generic", () => {
		expectTypeOf<ApprovalWorkflowTransactionContext>().toHaveProperty(
			"dbService",
		);
		expectTypeOf<ApprovalWorkflowTransactionContext>().toHaveProperty(
			"writeGate",
		);
		expectTypeOf<ApprovalWorkflowTransactionContext>().toHaveProperty(
			"repository",
		);
		expectTypeOf<ApprovalWorkflowTransactionContext>().toHaveProperty(
			"adapterRegistry",
		);
		expectTypeOf<ApprovalWorkflowTransactionContext>().toHaveProperty(
			"activationResolver",
		);
		expectTypeOf<ApprovalWorkflowTransactionContext>().toHaveProperty(
			"projectionWriter",
		);
		expectTypeOf<ApprovalWorkflowTransactionContext>().toHaveProperty(
			"compatibilityWriter",
		);
		expectTypeOf<ApprovalWorkflowTransactionContext>().toHaveProperty(
			"outboxWriter",
		);
		expectTypeOf<ApprovalDomainAdapterRegistry["get"]>().returns.toMatchTypeOf<
			ApprovalDomainAdapter<unknown>
		>();
	});

	it("exposes lock-first initial workflow preflight on the transaction repository", () => {
		expectTypeOf<TransactionalWorkflowRepository["findInitialWorkflow"]>()
			.parameter(0)
			.toEqualTypeOf<{
				organizationId: string;
				workflowType:
					| "absence"
					| "time_correction"
					| "manual_time_submission"
					| "policy_clock_out"
					| "travel_expense"
					| "shift_request"
					| "compliance_exception";
				sourceType: string;
				sourceId: string;
				submissionKey: string;
				requesterEmployeeId: string;
				contextSnapshot: import("./ports").JsonObject;
				displaySnapshot: import("./ports").JsonObject;
			}>();
		expectTypeOf<
			TransactionalWorkflowRepository["findInitialWorkflow"]
		>().returns.resolves.toEqualTypeOf<
			| { kind: "none" }
			| {
					kind: "existing";
					snapshot: Awaited<
						ReturnType<TransactionalWorkflowRepository["loadSnapshot"]>
					>;
			  }
			| { kind: "source_conflict" }
		>();
	});

	it("requires the caller transaction service on command dependency ports", () => {
		expectTypeOf<ApprovalCommandActorResolver["resolve"]>()
			.parameter(0)
			.toHaveProperty("dbService")
			.toEqualTypeOf<ApprovalDbService>();
		expectTypeOf<ApprovalWorkflowAuthorization["authorize"]>()
			.parameter(0)
			.toHaveProperty("dbService")
			.toEqualTypeOf<ApprovalDbService>();
		expectTypeOf<ApprovalWorkflowSourceLoader["load"]>()
			.parameter(0)
			.toHaveProperty("dbService")
			.toEqualTypeOf<ApprovalDbService>();
		expectTypeOf<
			Awaited<ReturnType<ApprovalWorkflowAuthorization["authorize"]>>
		>().toEqualTypeOf<
			"active_assignment" | "requester" | "manage_approval" | "system"
		>();
	});
});
