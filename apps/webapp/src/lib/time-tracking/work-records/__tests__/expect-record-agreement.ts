/**
 * Shared PostgreSQL test helper (#1218): every completed work period of the
 * organization (or the named ones) has its canonical work record, and the pair
 * is in record agreement by the one rule. Suites of any writer of completed
 * work call it after the writer ran.
 */
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db";
import { timeRecord, timeRecordAllocation, timeRecordWork, workPeriod } from "@/db/schema";
import { type RecordAgreementFacet, recordAgreement } from "../record-agreement";

export async function expectRecordAgreement(scope: {
	organizationId: string;
	workPeriodIds?: readonly string[];
}): Promise<void> {
	const periods = await db
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				isNull(workPeriod.deletedAt),
				isNotNull(workPeriod.endTime),
				scope.workPeriodIds ? inArray(workPeriod.id, [...scope.workPeriodIds]) : undefined,
			),
		)
		.orderBy(asc(workPeriod.startTime));
	if (scope.workPeriodIds) expect(periods).toHaveLength(scope.workPeriodIds.length);

	const findings: { workPeriodId: string; disagreements: (RecordAgreementFacet | "missing")[] }[] =
		[];
	for (const period of periods) {
		const recordId = period.canonicalRecordId;
		const [record] = recordId
			? await db
					.select()
					.from(timeRecord)
					.where(
						and(eq(timeRecord.id, recordId), eq(timeRecord.organizationId, scope.organizationId)),
					)
			: [];
		const [detail] = recordId
			? await db
					.select()
					.from(timeRecordWork)
					.where(
						and(
							eq(timeRecordWork.recordId, recordId),
							eq(timeRecordWork.organizationId, scope.organizationId),
						),
					)
			: [];
		if (!recordId || !record || !detail) {
			findings.push({ workPeriodId: period.id, disagreements: ["missing"] });
			continue;
		}
		const allocations = await db
			.select()
			.from(timeRecordAllocation)
			.where(
				and(
					eq(timeRecordAllocation.recordId, recordId),
					eq(timeRecordAllocation.organizationId, scope.organizationId),
				),
			);
		const agreement = recordAgreement(period, { record, detail, allocations });
		if (!agreement.agrees) {
			findings.push({ workPeriodId: period.id, disagreements: agreement.disagreements });
		}
	}
	expect(findings).toEqual([]);
}
