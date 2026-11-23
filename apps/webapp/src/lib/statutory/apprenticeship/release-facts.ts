/**
 * Apprentice release records read for crediting and conflicts (#1993), batched over employees and
 * always scoped to one organization. Voided records never count.
 */
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { employeeApprenticeRelease } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	type ApprenticeReleaseDay,
	type ApprenticeReleaseRecord,
	apprenticeReleaseDays,
} from "./release-credits";

type Reader = Pick<DatabaseClient, "select">;

const mondayOf = (day: PlainDate) => day.subtract({ days: day.dayOfWeek - 1 });

/** Active release records touching the local days `[from, until)`, per employee, oldest first. */
export async function loadApprenticeReleaseRecords(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: string;
		readonly until: string;
	},
): Promise<Map<string, ApprenticeReleaseRecord[]>> {
	const result = new Map<string, ApprenticeReleaseRecord[]>();
	if (input.employeeIds.length === 0) return result;
	const rows = await db
		.select({
			id: employeeApprenticeRelease.id,
			employeeId: employeeApprenticeRelease.employeeId,
			releaseKind: employeeApprenticeRelease.releaseKind,
			startsOn: employeeApprenticeRelease.startsOn,
			endsOn: employeeApprenticeRelease.endsOn,
			lessonCount: employeeApprenticeRelease.lessonCount,
			schoolMinutes: employeeApprenticeRelease.schoolMinutes,
			examStartTime: employeeApprenticeRelease.examStartTime,
		})
		.from(employeeApprenticeRelease)
		.where(
			and(
				eq(employeeApprenticeRelease.organizationId, input.organizationId),
				inArray(employeeApprenticeRelease.employeeId, [...new Set(input.employeeIds)]),
				isNull(employeeApprenticeRelease.voidedAt),
				lt(employeeApprenticeRelease.startsOn, input.until),
				gte(employeeApprenticeRelease.endsOn, input.from),
			),
		)
		.orderBy(asc(employeeApprenticeRelease.startsOn));
	for (const { employeeId, ...record } of rows) {
		result.set(employeeId, [...(result.get(employeeId) ?? []), record]);
	}
	return result;
}

/**
 * Credited release days on the local days `[from, until)`, per employee, on days the employee is
 * an apprentice (`employment_profile = 'apprentice'`). Whole compliance weeks are read so the
 * once-a-week full school day is attributed as on any other range.
 */
export async function loadApprenticeReleaseDays(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: string;
		readonly until: string;
	},
): Promise<Map<string, ApprenticeReleaseDay[]>> {
	const records = await loadApprenticeReleaseRecords(db, {
		...input,
		from: mondayOf(parsePlainDate(input.from)).toString(),
		until: mondayOf(parsePlainDate(input.until).subtract({ days: 1 }))
			.add({ days: 7 })
			.toString(),
	});
	const inRange = new Map<string, ApprenticeReleaseDay[]>();
	for (const [employeeId, employeeRecords] of records) {
		const days = apprenticeReleaseDays(employeeRecords).filter(
			(day) => day.date >= input.from && day.date < input.until,
		);
		if (days.length > 0) inRange.set(employeeId, days);
	}
	if (inRange.size === 0) return inRange;

	// A release credits only while the employee's effective terms make them an apprentice.
	const contracts = await loadEffectiveContractsBatch(db, {
		organizationId: input.organizationId,
		employeeIds: [...inRange.keys()],
		dates: [...new Set([...inRange.values()].flat().map((day) => day.date))].map(parsePlainDate),
	});
	const result = new Map<string, ApprenticeReleaseDay[]>();
	for (const [employeeId, days] of inRange) {
		const byDate = contracts.get(employeeId);
		const apprenticeDays = days.filter(
			(day) => byDate?.get(day.date)?.employmentProfile === "apprentice",
		);
		if (apprenticeDays.length > 0) result.set(employeeId, apprenticeDays);
	}
	return result;
}
