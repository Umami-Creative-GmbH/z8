import "server-only";

import { employmentEndingAuditMetadata } from "@/lib/employee-lifecycle/employment-ending/cause";
import type { EmploymentEndingParticipant } from "@/lib/employee-lifecycle/employment-ending/types";
import { countedChecklistItems } from "@/lib/employee-lifecycle/reactivation-checklist";
import {
	activeDocumentRequestIdsOfEmployee,
	cancelDocumentRequestsAtEmploymentEnd,
} from "./document-request-store";
import { personnelFilePath } from "./paths";

export type DocumentRequestsEndingPlan = { requestIds: string[] };
export type DocumentRequestsEndingApplied = { cancelledRequestIds: string[] };

/**
 * Open and submitted document requests end with the employment (#1408),
 * silently, for every cause. Nothing reopens them; after a reactivation the
 * checklist links to the personnel file, where they are requested again.
 */
export const documentRequestsEndingParticipant: EmploymentEndingParticipant<
	DocumentRequestsEndingPlan,
	DocumentRequestsEndingApplied,
	"documentRequests"
> = {
	key: "documentRequests",
	async plan(reader, ctx) {
		return {
			requestIds: await activeDocumentRequestIdsOfEmployee(reader, ctx),
		};
	},
	async apply(tx, _plan, ctx) {
		const cancelledRequestIds = await cancelDocumentRequestsAtEmploymentEnd(tx, {
			organizationId: ctx.organizationId,
			employeeId: ctx.employeeId,
			actorUserId: ctx.actorUserId,
			auditMetadata: employmentEndingAuditMetadata(ctx),
			now: ctx.now,
		});
		return { applied: { cancelledRequestIds } };
	},
	reactivationItems: (applied, subject) =>
		countedChecklistItems({
			group: "documentRequests",
			kind: "document_requests",
			count: applied.cancelledRequestIds.length,
			href: personnelFilePath(subject.employeeId),
		}),
};
