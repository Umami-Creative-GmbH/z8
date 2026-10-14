import { and, eq, gte, lte, ne, or } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { organization } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, timeRecord } from "@/db/schema";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { assertAbsenceDaysOpen } from "@/lib/time-tracking/closed-months/store";
import { type AbsenceDayRange, clipAbsenceDayRange, refusalForAbsenceDays } from "./absence-days";
import { getAbsenceDays } from "./absence-days-resolver";
import { hasExactAbsenceHours } from "./change-request-coverage";
import type { AbsenceChangeDatabase } from "./change-request-store";
import {
	AbsenceChangeError,
	type AbsenceChangeOriginal,
	type AbsenceChangeProposal,
} from "./change-request-types";
import { getBlockingOverlapMessage } from "./sick-vacation-override";
import { loadVacationBalances } from "./vacation-balance-store";

export async function loadCanonicalCoverage(
	database: AbsenceChangeDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		canonicalRecordId: string | null;
	},
) {
	if (!input.canonicalRecordId) return null;
	const [record] = await database
		.select()
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, input.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.employeeId, input.employeeId),
				eq(timeRecord.recordKind, "absence"),
			),
		)
		.for("update");
	if (!record?.endAt || record.approvalState !== "approved")
		throw new AbsenceChangeError(
			"obsolete",
			"The recorded absence is no longer approved. Submit a fresh request.",
		);
	return {
		startAt: instantFromDate(record.startAt).toString(),
		endAt: instantFromDate(record.endAt).toString(),
	};
}

export function resolveProposedCoverage(
	original: AbsenceChangeOriginal,
	range: AbsenceDayRange,
	coverage: "keep" | "choose",
): AbsenceChangeProposal {
	const proposed = { ...range };
	const originalStart = original.canonical
		? Temporal.Instant.from(original.canonical.startAt).toZonedDateTimeISO("UTC")
		: null;
	const originalEnd = original.canonical
		? Temporal.Instant.from(original.canonical.endAt).toZonedDateTimeISO("UTC")
		: null;
	let start = Temporal.PlainDate.from(range.startDate).toPlainDateTime(
		range.startPeriod === "pm" ? "12:00" : "00:00",
	);
	let end = Temporal.PlainDate.from(range.endDate).toPlainDateTime(
		range.endPeriod === "am" ? "11:59:59.999" : "23:59:59.999",
	);
	if (coverage === "keep") {
		proposed.startPeriod = original.startPeriod;
		proposed.endPeriod = original.endPeriod;
		if (originalStart && originalEnd) {
			start = Temporal.PlainDate.from(range.startDate).toPlainDateTime(originalStart.toPlainTime());
			const overnightDays = Temporal.PlainDate.from(original.endDate).until(
				originalEnd.toPlainDate(),
			).days;
			end = Temporal.PlainDate.from(range.endDate)
				.add({ days: overnightDays })
				.toPlainDateTime(originalEnd.toPlainTime());
			const customPartial = hasExactAbsenceHours(original);
			if (customPartial && proposed.startDate !== proposed.endDate)
				throw new AbsenceChangeError(
					"invalid_dates",
					"Keep exact hours on one start day, or explicitly choose full-day or half-day coverage.",
				);
		} else {
			start = Temporal.PlainDate.from(range.startDate).toPlainDateTime(
				original.startPeriod === "pm" ? "12:00" : "00:00",
			);
			end = Temporal.PlainDate.from(range.endDate).toPlainDateTime(
				original.endPeriod === "am" ? "11:59:59.999" : "23:59:59.999",
			);
		}
	}
	if (Temporal.PlainDateTime.compare(start, end) >= 0)
		throw new AbsenceChangeError("invalid_dates", "The absence must end after it starts.");
	const canonical = {
		startAt: start.toZonedDateTime("UTC").toInstant().toString(),
		endAt: end.toZonedDateTime("UTC").toInstant().toString(),
	};
	if (
		proposed.startDate === original.startDate &&
		proposed.endDate === original.endDate &&
		proposed.startPeriod === original.startPeriod &&
		proposed.endPeriod === original.endPeriod &&
		(!original.canonical || JSON.stringify(canonical) === JSON.stringify(original.canonical))
	)
		throw new AbsenceChangeError(
			"unchanged",
			"Choose different dates or coverage before requesting a change.",
		);
	return { ...proposed, canonical, displacedVacations: [] };
}

export function coverageDays(
	range: AbsenceDayRange & {
		canonical?: { startAt: string; endAt: string } | null;
	},
): AbsenceDayRange {
	return range.canonical
		? {
				...range,
				startDate: Temporal.Instant.from(range.canonical.startAt)
					.toZonedDateTimeISO("UTC")
					.toPlainDate()
					.toString(),
				endDate: Temporal.Instant.from(range.canonical.endAt)
					.toZonedDateTimeISO("UTC")
					.toPlainDate()
					.toString(),
			}
		: range;
}

/** Reuse the normal overlap, working-day and vacation rules without reserving the proposal. */
export async function validateAbsenceProposal(
	database: AbsenceChangeDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		absenceId: string;
		original: AbsenceChangeOriginal;
		proposed: AbsenceChangeProposal | null;
		at: Instant;
	},
) {
	await assertAbsenceDaysOpen(database, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		days: [coverageDays(input.original), ...(input.proposed ? [coverageDays(input.proposed)] : [])],
	});
	if (!input.proposed) return [];
	const [category] = await database
		.select()
		.from(absenceCategory)
		.where(
			and(
				eq(absenceCategory.id, input.original.categoryId),
				eq(absenceCategory.organizationId, input.organizationId),
			),
		);
	if (!category?.isActive)
		throw new AbsenceChangeError("category_unavailable", "This absence category is unavailable.");
	const proposed = input.proposed;
	const overlaps = await database
		.select({
			absence: absenceEntry,
			category: absenceCategory,
			canonicalStart: timeRecord.startAt,
			canonicalEnd: timeRecord.endAt,
		})
		.from(absenceEntry)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, input.organizationId),
			),
		)
		.leftJoin(
			timeRecord,
			and(
				eq(timeRecord.id, absenceEntry.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.employeeId, input.employeeId),
				eq(timeRecord.recordKind, "absence"),
			),
		)
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.employeeId, input.employeeId),
				ne(absenceEntry.id, input.absenceId),
				lte(absenceEntry.startDate, coverageDays(proposed).endDate),
				gte(
					absenceEntry.endDate,
					Temporal.PlainDate.from(proposed.startDate).subtract({ days: 1 }).toString(),
				),
				or(eq(absenceEntry.status, "pending"), eq(absenceEntry.status, "approved")),
			),
		)
		.for("update", { of: absenceEntry });
	const displaced: AbsenceChangeProposal["displacedVacations"] = [];
	for (const { absence, category: existingCategory, canonicalStart, canonicalEnd } of overlaps) {
		if (absence.status !== "pending" && absence.status !== "approved") continue;
		const bounds = canonicalStart ? { startAt: canonicalStart, endAt: canonicalEnd } : null;
		const existingDays = bounds?.endAt
			? coverageDays({
					...absence,
					canonical: {
						startAt: instantFromDate(bounds.startAt).toString(),
						endAt: instantFromDate(bounds.endAt).toString(),
					},
				})
			: absence;
		const proposedDays = coverageDays(proposed);
		// Keep the ordinary request rule: any shared calendar day blocks, except full-day sickness over vacation.
		if (
			existingDays.startDate > proposedDays.endDate ||
			existingDays.endDate < proposedDays.startDate
		)
			continue;
		const refusal = getBlockingOverlapMessage({
			newCategoryType: category.type,
			newStartPeriod: proposed.startPeriod,
			newEndPeriod: proposed.endPeriod,
			existingStartPeriod: absence.startPeriod,
			existingEndPeriod: absence.endPeriod,
			existingStatus: absence.status,
			existingCountsAgainstVacation: existingCategory.countsAgainstVacation,
		});
		if (refusal) throw new AbsenceChangeError("overlap", refusal);

		displaced.push({
			id: absence.id,
			startDate: absence.startDate,
			endDate: absence.endDate,
			startPeriod: absence.startPeriod,
			endPeriod: absence.endPeriod,
			updatedAt: instantFromDate(absence.updatedAt).toString(),
			status: absence.status,
		});
	}
	if (displaced.length)
		await assertAbsenceDaysOpen(database, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			days: displaced,
		});
	if (category.countsAgainstVacation) {
		const proposedDays = await getAbsenceDays(database, {
			...input,
			absence: proposed,
		});
		if (
			refusalForAbsenceDays({
				countsAgainstVacation: true,
				absenceDays: proposedDays,
			})
		)
			throw new AbsenceChangeError("no_working_days", "This range contains no working days.");
		const [org] = await database
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, input.organizationId));
		for (
			let year = Temporal.PlainDate.from(proposed.startDate).year;
			year <= Temporal.PlainDate.from(proposed.endDate).year;
			year++
		) {
			const window = { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
			const oldRange = clipAbsenceDayRange(input.original, window);
			const newRange = clipAbsenceDayRange(proposed, window);
			if (!newRange) continue;
			const oldDays = oldRange
				? await getAbsenceDays(database, { ...input, absence: oldRange })
				: 0;
			const newDays = await getAbsenceDays(database, {
				...input,
				absence: newRange,
			});
			const { balances } = await loadVacationBalances(database, {
				organizationId: input.organizationId,
				employeeIds: [input.employeeId],
				year,
				timezone: org?.timezone ?? "UTC",
				currentDate: dateFromInstant(input.at),
			});
			const balance = balances.get(input.employeeId);
			if (newDays > oldDays && (!balance || newDays - oldDays > balance.remainingDays))
				throw new AbsenceChangeError(
					"insufficient_balance",
					"The proposed dates exceed your available vacation balance.",
				);
		}
	}
	return displaced.sort((left, right) => left.id.localeCompare(right.id));
}
