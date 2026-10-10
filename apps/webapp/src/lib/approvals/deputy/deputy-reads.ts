import type { AbsenceDeputyView } from "@/lib/absences/deputy";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { DeputyCardCandidate, DeputyCardRecipient } from "../delivery/deputy-cards";
import type { Cover } from "./covering";
import type { CoverQuery, CoveringExecutor } from "./covering-store";
import type { DeputyDecisionReader } from "./deputy-decision-store";

/**
 * The deputy reads (#1015–#1017) that approval delivery, evidence,
 * presentation, escalation and the canonical runtime need, behind one narrow
 * port. Those modules sit in the escalation worker's static import graph,
 * which runs under plain Node where `server-only` throws on import
 * (`lib/cron/escalation-worker-imports.test.ts`). The stores stay marked
 * `server-only`; this port loads them on first use instead of at import.
 *
 * Every read is organization-scoped and takes the caller's executor (the
 * global database or a decision transaction), as the stores do.
 */

const coveringStore = () => import("./covering-store");
const deputyDecisionStore = () => import("./deputy-decision-store");

/** The deputy's cover for this approver at the instant, or null. */
export async function loadCover(executor: CoveringExecutor, query: CoverQuery): Promise<Cover | null> {
	return (await coveringStore()).loadCover(executor, query);
}

/** The approvers the deputy covers for at the instant (employee ids). */
export async function loadCoveredApproverIds(
	executor: CoveringExecutor,
	query: { organizationId: string; deputyId: string; at: Instant },
): Promise<Set<string>> {
	const covers = await (await coveringStore()).loadCoveredApprovers(executor, query);
	return new Set(covers.map((cover) => cover.approverId));
}

/** Whether the deputy covers for this approver at the instant. */
export async function isCovering(executor: CoveringExecutor, query: CoverQuery): Promise<boolean> {
	return (await loadCover(executor, query)) !== null;
}

/** The deputy cards these pending approvals require now (`delivery/deputy-cards.ts`). */
export async function resolveDeputyCardRecipients(
	executor: CoveringExecutor,
	input: { organizationId: string; candidates: readonly DeputyCardCandidate[]; now: Instant },
): Promise<DeputyCardRecipient[]> {
	if (input.candidates.length === 0) return [];
	return (await import("../delivery/deputy-cards")).resolveDeputyCardRecipients(executor, input);
}

/** Whether the actor decided an earlier step of this request's legacy chain. */
export async function legacyDecidedEarlierStage(
	executor: DeputyDecisionReader,
	input: { organizationId: string; approvalRequestId: string; actorEmployeeId: string },
): Promise<boolean> {
	return (await deputyDecisionStore()).legacyDecidedEarlierStage(executor, input);
}

/** Whether the actor covers for the request's current approver at the instant. */
export async function coversCurrentApprover(
	executor: DeputyDecisionReader,
	input: {
		organizationId: string;
		entityType: string;
		approverEmployeeId: string;
		actorEmployeeId: string;
		at: Instant;
	},
): Promise<boolean> {
	return (await deputyDecisionStore()).coversCurrentApprover(executor, input);
}

/** An employee's display name, org-scoped; null when unknown. */
export async function loadEmployeeName(
	executor: DeputyDecisionReader,
	input: { organizationId: string; employeeId: string },
): Promise<string | null> {
	return (await deputyDecisionStore()).loadEmployeeName(executor, input);
}

/** The absent approver's name when a covering deputy made this decision, else null. */
export async function loadDeputyActingForName(
	executor: DeputyDecisionReader,
	input: { organizationId: string; assignmentId?: string | null; approvalRequestId?: string | null },
): Promise<string | null> {
	if (!input.assignmentId && !input.approvalRequestId) return null;
	return (await deputyDecisionStore()).loadDeputyActingForName(executor, input);
}

/** An absence's current deputy for its approval card (#1011); see `loadAbsenceDeputyView`. */
export async function loadAbsenceDeputyView(
	executor: CoveringExecutor,
	input: { organizationId: string; absenceId: string },
): Promise<AbsenceDeputyView | null | undefined> {
	return (await import("@/lib/absences/deputy-store")).loadAbsenceDeputyView(executor, input);
}
