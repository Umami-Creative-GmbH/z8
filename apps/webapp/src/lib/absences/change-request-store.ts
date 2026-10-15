import {
	withReviewedVacationReconciliation,
	withVacationReconciliation,
} from "./vacation-reconciliation";
import { historicalVacationRefusalOf } from "./historical-vacation";
import { isAuthorizedReconciledAbsence } from "./vacation-reconciliation-authorization";
import {
	type AbsenceChangeDatabase,
	type AbsenceChangeRow,
	originalAbsence,
} from "./change-request-records";

export {
	type AbsenceChangeDatabase,
	type AbsenceChangeRow,
	auditAbsenceChange,
	loadChangeRequest,
	originalAbsence,
} from "./change-request-records";

import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import {
	removeCanonicalAbsenceRecordInTransaction,
	updateCanonicalAbsenceRangeInTransaction,
} from "@/app/[locale]/(app)/absences/actions.canonical";

import { absenceCategory, absenceEntry } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	dateFromInstant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { deleteSickNotesOfCancelledAbsence } from "@/lib/personnel-file/sick-note-store";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { sendBackChangedPeriodSubmissions } from "@/lib/time-tracking/period-submissions/submission-send-back";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import {
	coverageDays,
	loadCanonicalCoverage,
	validateAbsenceProposal,
} from "./change-request-proposal";
import { AbsenceChangeError } from "./change-request-types";
import type { AbsenceDeputyEvent } from "./deputy-notifications";
import type { VacationOverrideSummary } from "./sick-vacation-override";
import { adjustVacationAbsencesForSickness } from "./sick-vacation-override";

export async function validateEffectiveAbsence(
	database: AbsenceChangeDatabase,
	row: AbsenceChangeRow,
	at: Instant = systemClock.nowInstant(),
) {
	const [absence] = await database
		.select()
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.organizationId, row.organizationId),
				eq(absenceEntry.employeeId, row.employeeId),
				eq(absenceEntry.id, row.absenceId),
			),
		)
		.for("update");
	const canonical = absence
		? await loadCanonicalCoverage(database, {
				...row,
				canonicalRecordId: absence.canonicalRecordId,
			})
		: null;
	if (
		absence?.status !== "approved" ||
		!isDeepStrictEqual(originalAbsence(absence, canonical), row.original)
	) {
		throw new AbsenceChangeError(
			"obsolete",
			"The absence changed during review. Submit a fresh request.",
		);
	}
	try {
		const validate = () => validateAbsenceProposal(database, { ...row, at });
		const proof = row.proposed?.historicalReconciliation;
		const displaced =
			proof &&
			row.proposed &&
			!isAuthorizedReconciledAbsence(database, {
				organizationId: row.organizationId,
				employeeId: row.employeeId,
				categoryId: row.original.categoryId,
				...row.proposed,
			})
				? await withReviewedVacationReconciliation(
						database,
						{
							organizationId: row.organizationId,
							actorUserId: row.submittedBy,
							proof,
							expectedChange: {
								absenceId: row.absenceId,
								proposed: row.proposed,
							},
						},
						validate,
					)
				: await validate();
		if (
			row.proposed &&
			!isDeepStrictEqual(displaced, row.proposed.displacedVacations)
		)
			throw new AbsenceChangeError(
				"obsolete",
				"The vacation affected by this request changed during review.",
			);
	} catch (error) {
		if (
			error instanceof AbsenceChangeError ||
			monthClosedRefusalOf(error) ||
			historicalVacationRefusalOf(error)
		)
			throw new AbsenceChangeError(
				"obsolete",
				`${error instanceof Error ? error.message : "The proposed dates are no longer valid."} Submit a fresh request.`,
			);
		throw error;
	}
	return absence;
}

async function applyAbsenceChangeRecords(
	database: AbsenceChangeDatabase,
	row: AbsenceChangeRow,
	actorUserId: string,
	at: Instant,
) {
	const absence = await validateEffectiveAbsence(database, row, at);
	let vacationOverride: VacationOverrideSummary = {
		updatedAbsenceIds: [],
		createdAbsenceIds: [],
		deletedAbsenceIds: [],
	};
	let deletedDocumentIds: string[] = [];
	if (row.kind === "cancel") {
		deletedDocumentIds = await deleteSickNotesOfCancelledAbsence(database, {
			organizationId: row.organizationId,
			absenceId: row.absenceId,
			actorUserId,
			now: at,
		});
		await database
			.delete(absenceEntry)
			.where(
				and(
					eq(absenceEntry.id, row.absenceId),
					eq(absenceEntry.organizationId, row.organizationId),
				),
			);
		if (absence.canonicalRecordId)
			await removeCanonicalAbsenceRecordInTransaction(database, {
				organizationId: row.organizationId,
				canonicalRecordId: absence.canonicalRecordId,
				expectedEmployeeId: row.employeeId,
				expectedApprovalState: "approved",
			});
	} else {
		if (!row.proposed)
			throw new AbsenceChangeError(
				"invalid_dates",
				"Proposed dates are required.",
			);
		const [category] = await database
			.select()
			.from(absenceCategory)
			.where(
				and(
					eq(absenceCategory.id, absence.categoryId),
					eq(absenceCategory.organizationId, row.organizationId),
				),
			);
		if (
			category?.type === "sick" &&
			row.proposed.startPeriod === "full_day" &&
			row.proposed.endPeriod === "full_day"
		) {
			vacationOverride = await adjustVacationAbsencesForSickness({
				tx: database,
				organizationId: row.organizationId,
				employeeId: row.employeeId,
				sickStartDate: row.proposed.startDate,
				sickEndDate: row.proposed.endDate,
				updatedBy: actorUserId,
			});
		}
		const { startDate, endDate, startPeriod, endPeriod } = row.proposed;
		await database
			.update(absenceEntry)
			.set({ startDate, endDate, startPeriod, endPeriod })
			.where(
				and(
					eq(absenceEntry.id, row.absenceId),
					eq(absenceEntry.organizationId, row.organizationId),
				),
			);
		await updateCanonicalAbsenceRangeInTransaction(database, {
			organizationId: row.organizationId,
			canonicalRecordId: absence.canonicalRecordId,
			...row.proposed,
			resolvedBounds: {
				startAt: dateFromInstant(parseInstant(row.proposed.canonical.startAt)),
				endAt: dateFromInstant(parseInstant(row.proposed.canonical.endAt)),
			},
			updatedBy: actorUserId,
		});
	}
	await markEmployeeWorkBalanceDirty(
		{
			organizationId: row.organizationId,
			employeeId: row.employeeId,
			dirtyFromDate: [
				row.original.startDate,
				row.proposed?.startDate ?? row.original.startDate,
			].sort()[0],
		},
		database,
	);
	await sendBackChangedPeriodSubmissions(database, {
		organizationId: row.organizationId,
		employeeId: row.employeeId,
		causedByUserId: actorUserId,
		days: [
			coverageDays(row.original),
			...(row.proposed ? [coverageDays(row.proposed)] : []),
		],
	});
	const deputyEvents: AbsenceDeputyEvent[] = [
		{
			kind: "vacation_override",
			summary: {
				...vacationOverride,
				updatedAbsenceIds: [
					...vacationOverride.updatedAbsenceIds,
					...(row.kind === "change" ? [row.absenceId] : []),
				],
			},
		},
		...(row.kind === "cancel"
			? [
					{
						kind: "cancelled" as const,
						absence: {
							id: absence.id,
							employeeId: absence.employeeId,
							deputyEmployeeId: absence.deputyEmployeeId,
							startDate: absence.startDate,
							endDate: absence.endDate,
							status: "approved" as const,
						},
					},
				]
			: []),
	];
	return {
		deputyEvents,
		deletedDocumentIds,
		calendarUpdates: [
			{
				absenceId: row.absenceId,
				action:
					row.kind === "cancel" ? ("delete" as const) : ("update" as const),
			},
			...vacationOverride.updatedAbsenceIds.map((absenceId) => ({
				absenceId,
				action: "update" as const,
			})),
			...vacationOverride.createdAbsenceIds.map((absenceId) => ({
				absenceId,
				action: "create" as const,
			})),
			...vacationOverride.deletedAbsenceIds.map((absenceId) => ({
				absenceId,
				action: "delete" as const,
			})),
		],
	};
}

export async function applyAbsenceChange(
	database: AbsenceChangeDatabase,
	row: AbsenceChangeRow,
	actorUserId: string,
	at: Instant,
) {
	const proof = row.proposed?.historicalReconciliation;
	if (!proof || !row.proposed)
		return applyAbsenceChangeRecords(database, row, actorUserId, at);
	return withVacationReconciliation(
		database,
		{
			organizationId: row.organizationId,
			actorUserId,
			proof,
			approval: true,
			expectedChange: { absenceId: row.absenceId, proposed: row.proposed },
		},
		() => applyAbsenceChangeRecords(database, row, actorUserId, at),
	);
}
