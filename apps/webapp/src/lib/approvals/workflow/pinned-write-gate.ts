/**
 * Pinning the approval write gate (#489).
 *
 * A writer that nests other approval writers acquires the approval write gate
 * once, at the rank the acquisition protocol reserves for it, and hands the
 * nested writers a gate that returns that authority instead of acquiring again
 * after their row locks. A pinned gate answers only its own organization and
 * workflow type.
 */
import type { ApprovalCompatibilityWriter } from "./compatibility-writer";
import type { ApprovalWriteGate, ApprovalWriteGateResult } from "./ports";
import type { ApprovalWorkflowType } from "./types";

export class ApprovalWriteGateScopeMismatch extends Error {
	constructor() {
		super("Approval write gate scope is outside the pinned authority");
		this.name = "ApprovalWriteGateScopeMismatch";
	}
}

export interface ApprovalWriteGatePin {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
	authority: ApprovalWriteGateResult;
	/** Throws for a scope outside the pin; defaults to `ApprovalWriteGateScopeMismatch`. */
	refuse?: () => never;
	/** Runs before every read, e.g. to refuse a settled work transaction. */
	assertActive?: () => void;
}

export type ApprovalWriteGateScope = Omit<ApprovalWriteGatePin, "authority">;

interface PinnableApprovalContext {
	writeGate: ApprovalWriteGate;
	compatibilityWriter: ApprovalCompatibilityWriter;
}

/** A gate that returns the pinned authority without acquiring again. */
export function pinApprovalWriteGate(pin: ApprovalWriteGatePin): ApprovalWriteGate {
	return {
		acquire: async (scope) => {
			pin.assertActive?.();
			if (scope.organizationId !== pin.organizationId || scope.workflowType !== pin.workflowType) {
				if (pin.refuse) pin.refuse();
				throw new ApprovalWriteGateScopeMismatch();
			}
			return pin.authority;
		},
	};
}

/** The context with its write gate pinned and its compatibility writer rebound to that gate. */
export function pinApprovalContext<C extends PinnableApprovalContext>(
	context: C,
	pin: ApprovalWriteGatePin,
): C {
	const writeGate = pinApprovalWriteGate(pin);
	return {
		...context,
		writeGate,
		compatibilityWriter: context.compatibilityWriter.withWriteGate(writeGate),
	};
}

/** Acquires the context's write gate once and pins the result. */
export async function acquirePinnedApprovalContext<C extends PinnableApprovalContext>(
	context: C,
	scope: ApprovalWriteGateScope,
): Promise<{ authority: ApprovalWriteGateResult; context: C }> {
	const authority = await context.writeGate.acquire({
		organizationId: scope.organizationId,
		workflowType: scope.workflowType,
	});
	return { authority, context: pinApprovalContext(context, { ...scope, authority }) };
}
