import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";
import { employeeEmploymentPeriod } from "@/db/schema";
import { planAbsences } from "./absences";
import { planAccessEnds } from "./access-ends";
import { planApprovalDuties } from "./approval-duties";
import { planManagerLinks } from "./manager-links";
import { planShiftsToOpen } from "./shifts";
import { planTeamLinks } from "./team-links";
import type { DeactivationPlan, DeactivationPlanContext, DeactivationReader } from "./types";

/**
 * Everything a deactivation changes (#1440, Organization ADR 0006), composed
 * from the area plans. The preview serves it to the dialog; the deactivation
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
	const approvalDuties = await planApprovalDuties(reader, ctx);
	const shifts = await planShiftsToOpen(reader, ctx);
	const absences = await planAbsences(reader, ctx);
	const accessEnds = await planAccessEnds(reader, ctx);
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
		accessEnds,
		retentionStarts: true,
		seatReleased: true,
		refusals,
	};
}

/**
 * The employee's current employment period without writing: the open one,
 * else an unended legacy one. The deactivation transaction resolves (and
 * backfills) it with `resolveCurrentEmploymentPeriod`; the read-only preview
 * uses this, so an employee whose legacy period is not backfilled yet previews
 * with none (D10).
 */
export async function readCurrentEmploymentPeriodId(
	reader: Pick<DeactivationReader, "select">,
	input: { organizationId: string; employeeId: string },
): Promise<string | null> {
	const rows = await reader
		.select({ id: employeeEmploymentPeriod.id, status: employeeEmploymentPeriod.status })
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				eq(employeeEmploymentPeriod.employeeId, input.employeeId),
				or(
					eq(employeeEmploymentPeriod.status, "open"),
					and(
						eq(employeeEmploymentPeriod.status, "legacy_unknown"),
						isNull(employeeEmploymentPeriod.endedAt),
					),
				),
			),
		);
	return (rows.find((row) => row.status === "open") ?? rows[0])?.id ?? null;
}
