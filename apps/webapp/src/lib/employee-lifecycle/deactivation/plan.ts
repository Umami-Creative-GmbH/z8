import "server-only";

import { previewEmploymentEnding } from "../employment-ending";
import { planAbsences } from "./absences";
import { planApprovalDuties } from "./approval-duties";
import { planManagerLinks, validatedReplacementManagers } from "./manager-links";
import { planShiftsToOpen } from "./shifts";
import { planTeamLinks } from "./team-links";
import type { DeactivationPlan, DeactivationPlanContext, DeactivationReader } from "./types";

/**
 * Everything a deactivation changes (#1440, Organization ADR 0006), composed
 * from the area plans and the Employment ending preview. The preview serves it to the dialog; the deactivation
 * transaction computes it again and applies exactly what it lists, so the
 * preview and the submit use the same predicates. Reads only, one area after
 * another: inside the transaction the reader is a single connection.
 *
 * `retentionStarts` and `seatReleased` hold for every current employee who is
 * deactivated: the instant ends their employment for personnel file retention
 * (`retention-employment.ts`), and a former employee holds no paid seat
 * (#1439).
 */
export async function planDeactivationConsequences(
	reader: DeactivationReader,
	ctx: DeactivationPlanContext,
): Promise<DeactivationPlan> {
	const managerLinks = await planManagerLinks(reader, ctx);
	const teamLinks = await planTeamLinks(reader, ctx);
	const approvalDuties = await planApprovalDuties(
		reader,
		ctx,
		validatedReplacementManagers(managerLinks),
	);
	const shifts = await planShiftsToOpen(reader, ctx);
	const absences = await planAbsences(reader, ctx);
	const employmentEnding = await previewEmploymentEnding(reader, {
		organizationId: ctx.organizationId,
		employeeId: ctx.employeeId,
		employmentPeriodId: ctx.employmentPeriodId,
		at: ctx.at,
		timeZone: ctx.organizationTimeZone,
		cause: { kind: "deactivation" },
	});
	const refusals = [
		...new Set(
			managerLinks.reportsNeedingReplacement.flatMap((report) =>
				report.refusal ? [report.refusal] : [],
			),
		),
	].toSorted();
	return {
		at: ctx.at.toString(),
		timeZone: ctx.organizationTimeZone,
		managerLinks,
		teamLinks,
		approvalDuties,
		shifts,
		absences,
		employmentEnding,
		retentionStarts: true,
		seatReleased: true,
		refusals,
	};
}
