import "server-only";

import {
	employmentEndingAuditMetadata,
	endingEmployment,
} from "@/lib/employee-lifecycle/employment-ending/cause";
import type { EmploymentEndingParticipant } from "@/lib/employee-lifecycle/employment-ending/types";
import {
	liveKioskBadgesOfEmploymentPeriod,
	revokeKioskBadgesOfEmploymentPeriod,
} from "./badge-store";

export type KioskBadgesEndingPlan = { badgeIds: string[] };
export type KioskBadgesEndingApplied = { revokedBadgeIds: string[] };

/**
 * The badges of the ending period are revoked at the cutoff (#1365, #1440):
 * reason `employee_departure` at a departure, `revoked` otherwise. Only that
 * period's badges, so a stale retry never touches a later period's badge.
 */
export const kioskBadgesEndingParticipant: EmploymentEndingParticipant<
	KioskBadgesEndingPlan,
	KioskBadgesEndingApplied,
	"kioskBadges"
> = {
	key: "kioskBadges",
	async plan(reader, ctx) {
		return {
			badgeIds: await liveKioskBadgesOfEmploymentPeriod(reader, endingEmployment(ctx)),
		};
	},
	async apply(tx, _plan, ctx) {
		const revokedBadgeIds = await revokeKioskBadgesOfEmploymentPeriod(tx, ctx.audit, {
			...endingEmployment(ctx),
			actorUserId: ctx.actorUserId,
			cutoff: ctx.at,
			revokedReason: ctx.cause.kind === "departure" ? "employee_departure" : "revoked",
			auditMetadata: employmentEndingAuditMetadata(ctx),
		});
		return { applied: { revokedBadgeIds } };
	},
	reactivationItems: (applied, subject) =>
		applied.revokedBadgeIds.length > 0
			? [
					{
						group: "access",
						kind: "kiosk_badges",
						count: applied.revokedBadgeIds.length,
						href: `/settings/employees/${subject.employeeId}`,
					},
				]
			: [],
};
