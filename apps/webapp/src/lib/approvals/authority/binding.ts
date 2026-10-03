import { and, eq } from "drizzle-orm";
import { approvalReviewBinding, approvalSubmittedRevision, approvalWorkflow } from "@/db/schema";
import { ApprovalEvidenceError } from "../evidence/errors";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalWorkflowType } from "../workflow/ports";
import type { ApprovalAuthority, ApprovalWriteGateResult } from "./resolution";

/**
 * The approval authority a review binding was issued under, and the kind it
 * decides: the workflow's kind for a canonical binding (#325), the legacy
 * revision's kind for a legacy one (#384). Bindings and revisions are
 * immutable, so routing on them keeps exact replays intact.
 */
export interface ReviewBindingAuthority {
	authority: ApprovalAuthority;
	/** Null when the binding's workflow or legacy revision cannot be found. */
	kind: ApprovalWorkflowType | null;
}

/** One organization-scoped read of a binding's authority and kind; null when unknown. */
export async function readReviewBindingAuthority(
	database: ApprovalDatabase,
	input: { organizationId: string; bindingId: string },
): Promise<ReviewBindingAuthority | null> {
	const [row] = await database
		.select({
			authority: approvalReviewBinding.authority,
			canonicalKind: approvalWorkflow.workflowType,
			legacyKind: approvalSubmittedRevision.workflowType,
		})
		.from(approvalReviewBinding)
		.leftJoin(
			approvalWorkflow,
			and(
				eq(approvalReviewBinding.authority, "canonical"),
				eq(approvalWorkflow.id, approvalReviewBinding.workflowId),
				eq(approvalWorkflow.organizationId, approvalReviewBinding.organizationId),
			),
		)
		.leftJoin(
			approvalSubmittedRevision,
			and(
				eq(approvalReviewBinding.authority, "legacy"),
				eq(approvalSubmittedRevision.id, approvalReviewBinding.submittedRevisionId),
				eq(approvalSubmittedRevision.organizationId, approvalReviewBinding.organizationId),
				eq(approvalSubmittedRevision.authority, "legacy"),
			),
		)
		.where(
			and(
				eq(approvalReviewBinding.id, input.bindingId),
				eq(approvalReviewBinding.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (row?.authority === "canonical") {
		return { authority: "canonical", kind: row.canonicalKind ?? null };
	}
	if (row?.authority === "legacy") {
		return { authority: "legacy", kind: row.legacyKind ?? null };
	}
	return null;
}

/**
 * Cutover safety, read under the rollout gate: a binding decides only under
 * the authority it was issued for, so a legacy binding never decides under
 * canonical authority, nor the other way round. Refuses `binding_mismatch`.
 */
export async function assertReviewBindingAuthority(
	database: ApprovalDatabase,
	input: { organizationId: string; bindingId: string; gate: ApprovalWriteGateResult },
): Promise<ReviewBindingAuthority> {
	const binding = await readReviewBindingAuthority(database, input);
	if (!binding || binding.authority !== input.gate.authority) {
		throw new ApprovalEvidenceError("binding_mismatch", { field: "authority" });
	}
	return binding;
}
