import "server-only";

import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import { type CoveringExecutor, loadCover, loadCoveringDeputies } from "../deputy/covering-store";

/**
 * Deputy cards (#1017, spec #802, Approvals ADR 0002): who besides the
 * approver gets a card for a pending assignment or legacy request.
 *
 * While deputy Y covers for the absent approver X, an approval assigned to X
 * also sends Y a card, once per provider. Only approvals that became X's while
 * Y already covered for X qualify: the plan re-runs from current state on every
 * later intent of the lifecycle, and approvals X held before cover started are
 * summarized for Y instead (#1018). Y never gets a card about Y's own request
 * (self-decision, #697). Covering never chains, which the covering rules
 * already guarantee.
 */
export interface DeputyCardCandidate {
	/** The assignment or legacy request id. */
	key: string;
	/** The approver X the approval is assigned to. */
	approverId: string;
	/** When the approval became X's (stage activation or assignment, request creation). */
	assignedAt: Instant;
	/** The requester, who never receives a deputy card for their own request. */
	requesterEmployeeId: string | null;
}

export interface DeputyCardRecipient {
	key: string;
	/** The covering deputy Y, the card's recipient. */
	deputyId: string;
	/** The absent approver X whom Y acts for. */
	approverId: string;
}

/** The deputy cards these pending approvals require now, at most one per deputy each. */
export async function resolveDeputyCardRecipients(
	executor: CoveringExecutor,
	input: {
		organizationId: string;
		candidates: readonly DeputyCardCandidate[];
		now: Instant;
	},
): Promise<DeputyCardRecipient[]> {
	if (input.candidates.length === 0) return [];
	const covering = await loadCoveringDeputies(executor, {
		organizationId: input.organizationId,
		approverIds: [...new Set(input.candidates.map((candidate) => candidate.approverId))],
		at: input.now,
	});
	if (covering.length === 0) return [];
	const coveredWhenAssigned = new Map<string, boolean>();
	const recipients: DeputyCardRecipient[] = [];
	for (const candidate of input.candidates) {
		for (const cover of covering) {
			if (cover.approverId !== candidate.approverId) continue;
			if (cover.deputyId === candidate.requesterEmployeeId) continue;
			const cacheKey = `${candidate.approverId}:${cover.deputyId}:${candidate.assignedAt.epochMilliseconds}`;
			let covered = coveredWhenAssigned.get(cacheKey);
			if (covered === undefined) {
				covered =
					compareInstants(candidate.assignedAt, input.now) > 0 ||
					(await loadCover(executor, {
						organizationId: input.organizationId,
						approverId: candidate.approverId,
						deputyId: cover.deputyId,
						at: candidate.assignedAt,
					})) !== null;
				coveredWhenAssigned.set(cacheKey, covered);
			}
			if (covered) {
				recipients.push({
					key: candidate.key,
					deputyId: cover.deputyId,
					approverId: candidate.approverId,
				});
			}
		}
	}
	return recipients;
}
