import "server-only";

import { employmentEndingAuditMetadata } from "@/lib/employee-lifecycle/employment-ending/cause";
import type { EmploymentEndingParticipant } from "@/lib/employee-lifecycle/employment-ending/types";
import { liveShareLinksOfCreator, revokeShareLinksOfCreator } from "./report-share-links";

export type ReportShareLinksEndingPlan = {
	links: Array<{ linkId: string; kind: string }>;
};
export type ReportShareLinksEndingApplied = { revokedLinkIds: string[] };

/** The report share links the employee created and that are live at the cutoff are revoked. */
export const reportShareLinksEndingParticipant: EmploymentEndingParticipant<
	ReportShareLinksEndingPlan,
	ReportShareLinksEndingApplied,
	"reportShareLinks"
> = {
	key: "reportShareLinks",
	async plan(reader, ctx) {
		const links = await liveShareLinksOfCreator(reader, {
			organizationId: ctx.organizationId,
			creatorEmployeeId: ctx.employeeId,
			now: ctx.at,
		});
		return {
			links: links.map((link) => ({ linkId: link.id, kind: link.kind })),
		};
	},
	async apply(tx, _plan, ctx) {
		const revokedLinkIds = await revokeShareLinksOfCreator(tx, ctx.audit, {
			organizationId: ctx.organizationId,
			creatorEmployeeId: ctx.employeeId,
			now: ctx.at,
			actorUserId: ctx.actorUserId,
			auditMetadata: employmentEndingAuditMetadata(ctx),
		});
		return { applied: { revokedLinkIds } };
	},
	reactivationItems: (applied) =>
		applied.revokedLinkIds.length > 0
			? [
					{
						group: "shareLinks",
						kind: "share_links",
						count: applied.revokedLinkIds.length,
						href: "/settings/report-share-links",
					},
				]
			: [],
};
