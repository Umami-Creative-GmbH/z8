import "server-only";

import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { approvalRequest, approvalReviewBinding, approvalStageAssignment } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { loadCover } from "./covering-store";
import { loadEmployeeName } from "./deputy-decision-store";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * A press on a deputy card (#1017), before any decision owner runs. A deputy
 * card's binding names the absent approver X its recipient Y acts for. While
 * the bound approval is still pending:
 * - with X: Y must still cover for X, otherwise the press decides nothing and
 *   says "No longer covering for X";
 * - with someone else (a legacy escalation transfer kept the request): the
 *   card is X's former card and decides nothing.
 * Anything else (an ordinary card, or a bound approval that is no longer
 * pending, including a replay of Y's own committed decision) goes on to the
 * decision owner, which revalidates everything in its transaction.
 */
export type DeputyCardPress =
	| { kind: "proceed" }
	| { kind: "not_covering"; approverName: string }
	| { kind: "moved" };

export async function checkDeputyCardPress(
	executor: Pick<Database | Transaction, "select">,
	input: { organizationId: string; bindingId: string; actorEmployeeId: string; at: Instant },
): Promise<DeputyCardPress> {
	const [binding] = await executor
		.select({
			recipientEmployeeId: approvalReviewBinding.recipientEmployeeId,
			actingForEmployeeId: approvalReviewBinding.actingForEmployeeId,
			authority: approvalReviewBinding.authority,
			assignmentId: approvalReviewBinding.assignmentId,
			legacyApprovalRequestId: approvalReviewBinding.legacyApprovalRequestId,
		})
		.from(approvalReviewBinding)
		.where(
			and(
				eq(approvalReviewBinding.organizationId, input.organizationId),
				eq(approvalReviewBinding.id, input.bindingId),
			),
		)
		.limit(1);
	const actingFor = binding?.actingForEmployeeId;
	// Not a deputy card, or not this actor's: the owner refuses as it always has.
	if (!binding || !actingFor || binding.recipientEmployeeId !== input.actorEmployeeId) {
		return { kind: "proceed" };
	}
	const holder = await pendingHolder(executor, input.organizationId, binding);
	if (holder === null) return { kind: "proceed" };
	if (holder !== actingFor) return { kind: "moved" };
	const cover = await loadCover(executor, {
		organizationId: input.organizationId,
		approverId: actingFor,
		deputyId: input.actorEmployeeId,
		at: input.at,
	});
	if (cover) return { kind: "proceed" };
	return {
		kind: "not_covering",
		approverName:
			(await loadEmployeeName(executor as never, {
				organizationId: input.organizationId,
				employeeId: actingFor,
			})) ?? "",
	};
}

/** The approver currently holding the bound approval while it is pending, else null. */
async function pendingHolder(
	executor: Pick<Database | Transaction, "select">,
	organizationId: string,
	binding: { assignmentId: string | null; legacyApprovalRequestId: string | null },
): Promise<string | null> {
	if (binding.assignmentId) {
		const [assignment] = await executor
			.select({
				approverEmployeeId: approvalStageAssignment.approverEmployeeId,
				status: approvalStageAssignment.status,
			})
			.from(approvalStageAssignment)
			.where(
				and(
					eq(approvalStageAssignment.organizationId, organizationId),
					eq(approvalStageAssignment.id, binding.assignmentId),
				),
			)
			.limit(1);
		return assignment?.status === "pending" ? assignment.approverEmployeeId : null;
	}
	if (!binding.legacyApprovalRequestId) return null;
	const [request] = await executor
		.select({ approverId: approvalRequest.approverId, status: approvalRequest.status })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.id, binding.legacyApprovalRequestId),
			),
		)
		.limit(1);
	return request?.status === "pending" ? request.approverId : null;
}
