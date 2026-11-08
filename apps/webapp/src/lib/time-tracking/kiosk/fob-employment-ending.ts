import "server-only";

import {
	employmentEndingAuditMetadata,
	endingEmployment,
} from "@/lib/employee-lifecycle/employment-ending/cause";
import type { EmploymentEndingParticipant } from "@/lib/employee-lifecycle/employment-ending/types";
import { endKioskFobLinks, liveKioskFobsOfEmployment } from "./fob-store";

export type KioskFobsEndingPlan = { fobIds: string[] };
export type KioskFobsEndingApplied = { endedFobIds: string[] };

/**
 * The fob links of the ending period end at the cutoff (#1509): reason
 * `departure` at a departure, `removed` otherwise, the audit naming the cause.
 * Always applied, not only what the plan lists: a registration reads the
 * employee row FOR SHARE, so one that committed before the cause locked the
 * row is seen here and ended too. No checklist item: nobody grants a fob
 * again, the employee registers it themselves at a kiosk.
 */
export const kioskFobsEndingParticipant: EmploymentEndingParticipant<
	KioskFobsEndingPlan,
	KioskFobsEndingApplied,
	"kioskFobs"
> = {
	key: "kioskFobs",
	async plan(reader, ctx) {
		return {
			fobIds: await liveKioskFobsOfEmployment(reader, endingEmployment(ctx)),
		};
	},
	async apply(tx, _plan, ctx) {
		const endedFobIds = await endKioskFobLinks(tx, ctx.audit, {
			organizationId: ctx.organizationId,
			employeeId: ctx.employeeId,
			employmentPeriodId: ctx.employmentPeriodId ?? undefined,
			reason: ctx.cause.kind === "departure" ? "departure" : "removed",
			at: ctx.at,
			actorUserId: ctx.actorUserId,
			auditMetadata: employmentEndingAuditMetadata(ctx),
		});
		return { applied: { endedFobIds } };
	},
	reactivationItems: () => [],
};
