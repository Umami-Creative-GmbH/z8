/**
 * The approvals side of the work transaction coordinator (#477): the approval
 * runtime borrows the coordinator's transaction instead of opening its own,
 * and the workflow type's write gate is acquired once at rank 2 and pinned for
 * the nested approval writers.
 */
import type {
	WorkTransactionApprovalPort,
	WorkTransactionClient,
} from "@/lib/time-tracking/work-transaction";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import { acquirePinnedApprovalContext } from "./pinned-write-gate";
import type { ApprovalTransactionClient } from "./ports";
import type { ApprovalWorkflowDatabase, ApprovalWorkflowRepository } from "./repository";
import { APPROVAL_WORKFLOW_TYPES, type ApprovalWorkflowType } from "./types";

export type ApprovalRuntimeFactory = (database: ApprovalWorkflowDatabase) => {
	repository: ApprovalWorkflowRepository;
};

/**
 * A runtime factory that remembers the runtime the port built for the running
 * attempt, so the writer reaches that runtime's transition engine, whose
 * in-transaction commands run on the borrowed approval context.
 */
export function attemptApprovalRuntime<R extends ReturnType<ApprovalRuntimeFactory>>(
	createApprovalRuntime: (database: ApprovalWorkflowDatabase) => R,
): { factory: ApprovalRuntimeFactory; current(): R } {
	let current: R | null = null;
	return {
		factory: (database) => {
			current = createApprovalRuntime(database);
			return current;
		},
		current() {
			if (!current) throw new Error("No approval runtime borrows a work transaction");
			return current;
		},
	};
}

function isApprovalWorkflowType(value: string): value is ApprovalWorkflowType {
	return (APPROVAL_WORKFLOW_TYPES as readonly string[]).includes(value);
}

/**
 * The port a coordinator's plan passes as `approval`. Each attempt builds the
 * runtime over the borrowed transaction; the runtime keeps its reservation and
 * CAS invariants. Once the attempt settles, the borrowed transaction and the
 * pinned gate refuse. `refuse` replaces the pinned gate's refusal of another
 * scope.
 */
export function approvalWorkTransactionPort(
	createApprovalRuntime: ApprovalRuntimeFactory,
	options: { refuse?: () => never } = {},
): WorkTransactionApprovalPort<ApprovalWorkflowTransactionContext> {
	const assertActiveFor = new WeakMap<ApprovalWorkflowTransactionContext, () => void>();
	return {
		async borrow<T>(
			db: WorkTransactionClient,
			body: (approval: ApprovalWorkflowTransactionContext) => Promise<T>,
		): Promise<T> {
			let active = true;
			const assertActive = () => {
				if (!active) throw new Error("Work transaction is no longer active");
			};
			const runtime = createApprovalRuntime({
				transaction: async (callback) => {
					assertActive();
					return callback(db as ApprovalTransactionClient);
				},
			});
			try {
				return await runtime.repository.withTransaction((approval) => {
					assertActiveFor.set(approval, assertActive);
					return body(approval);
				});
			} finally {
				active = false;
			}
		},
		async gate(approval, organizationId, workflowType) {
			if (!isApprovalWorkflowType(workflowType)) {
				throw new Error(`Unknown approval workflow type ${workflowType}`);
			}
			const { context } = await acquirePinnedApprovalContext(approval, {
				organizationId,
				workflowType,
				refuse: options.refuse,
				assertActive: assertActiveFor.get(approval),
			});
			return context;
		},
	};
}
