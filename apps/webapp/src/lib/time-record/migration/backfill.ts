import { DateTime } from "luxon";

type LegacyApprovalStatus = "pending" | "approved" | "rejected";
type LegacyDayPeriod = "full_day" | "morning" | "afternoon";
type LegacyEntityType = "time_entry" | "absence_entry";

export type LegacyWorkPeriod = {
	id: string;
	organizationId: string;
	employeeId: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	approvalStatus: LegacyApprovalStatus;
	workCategoryId: string | null;
	workLocationType: "office" | "home" | "field" | "other" | null;
	createdAt: Date;
	updatedAt: Date;
};

export type LegacyAbsenceEntry = {
	id: string;
	organizationId: string;
	employeeId: string;
	categoryId: string;
	startDate: string;
	startPeriod: LegacyDayPeriod;
	endDate: string;
	endPeriod: LegacyDayPeriod;
	status: LegacyApprovalStatus;
	createdAt: Date;
	updatedAt: Date;
};

export type LegacyApprovalRequest = {
	id: string;
	organizationId: string;
	entityType: LegacyEntityType;
	entityId: string;
	requestedBy: string;
	approverId: string;
	status: LegacyApprovalStatus;
	reason: string | null;
	rejectionReason: string | null;
	approvedAt: Date | null;
	createdAt: Date;
};

export type BackfillAbsenceCategory = {
	id: string;
	countsAgainstVacation: boolean;
};

export type CanonicalBackfillInput = {
	organizationId: string;
	actorId: string;
	legacy: {
		workPeriods: LegacyWorkPeriod[];
		absenceEntries: LegacyAbsenceEntry[];
		approvalRequests: LegacyApprovalRequest[];
		absenceCategories: BackfillAbsenceCategory[];
	};
};

export type CanonicalBackfillPayload = {
	timeRecords: Array<{
		id: string;
		organizationId: string;
		employeeId: string;
		recordKind: "work" | "absence";
		startAt: Date;
		endAt: Date | null;
		durationMinutes: number | null;
		approvalState: "pending" | "approved" | "rejected";
		origin: "system";
		createdAt: Date;
		createdBy: string;
		updatedAt: Date;
		updatedBy: string;
	}>;
	timeRecordWork: Array<{
		recordId: string;
		organizationId: string;
		recordKind: "work";
		workCategoryId: string | null;
		workLocationType: "office" | "home" | "field" | "other" | null;
		computationMetadata: string | null;
	}>;
	timeRecordAbsence: Array<{
		recordId: string;
		organizationId: string;
		recordKind: "absence";
		absenceCategoryId: string;
		startPeriod: LegacyDayPeriod;
		endPeriod: LegacyDayPeriod;
		countsAgainstVacation: boolean;
	}>;
	timeRecordApprovalDecision: Array<{
		organizationId: string;
		recordId: string;
		actorEmployeeId: string;
		action: "submitted" | "approved" | "rejected";
		reason: string | null;
		createdAt: Date;
	}>;
	legacyLinks: {
		workPeriod: Array<{ id: string; canonicalRecordId: string }>;
		absenceEntry: Array<{ id: string; canonicalRecordId: string }>;
		approvalRequest: Array<{ id: string; canonicalRecordId: string }>;
	};
};

export function buildCanonicalBackfillPayload(
	input: CanonicalBackfillInput,
): CanonicalBackfillPayload {
	const categoryVacationFlagById = new Map(
		input.legacy.absenceCategories.map((category) => [category.id, category.countsAgainstVacation]),
	);

	const workPeriods = input.legacy.workPeriods.filter(
		(workPeriod) => workPeriod.organizationId === input.organizationId,
	);
	const absences = input.legacy.absenceEntries.filter(
		(absenceEntry) => absenceEntry.organizationId === input.organizationId,
	);
	const approvals = input.legacy.approvalRequests.filter(
		(approvalRequest) => approvalRequest.organizationId === input.organizationId,
	);

	const timeRecords: CanonicalBackfillPayload["timeRecords"] = [];
	const timeRecordWork: CanonicalBackfillPayload["timeRecordWork"] = [];
	const timeRecordAbsence: CanonicalBackfillPayload["timeRecordAbsence"] = [];
	const timeRecordApprovalDecision: CanonicalBackfillPayload["timeRecordApprovalDecision"] = [];

	const workPeriodRecordMap = new Map<string, string>();
	const absenceRecordMap = new Map<string, string>();

	for (const workPeriod of workPeriods) {
		timeRecords.push({
			id: workPeriod.id,
			organizationId: input.organizationId,
			employeeId: workPeriod.employeeId,
			recordKind: "work",
			startAt: workPeriod.startTime,
			endAt: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			approvalState: workPeriod.approvalStatus,
			origin: "system",
			createdAt: workPeriod.createdAt,
			createdBy: input.actorId,
			updatedAt: workPeriod.updatedAt,
			updatedBy: input.actorId,
		});

		timeRecordWork.push({
			recordId: workPeriod.id,
			organizationId: input.organizationId,
			recordKind: "work",
			workCategoryId: workPeriod.workCategoryId,
			workLocationType: workPeriod.workLocationType,
			computationMetadata: null,
		});

		workPeriodRecordMap.set(workPeriod.id, workPeriod.id);
	}

	for (const absenceEntry of absences) {
		const interval = mapAbsenceToInterval(
			absenceEntry.startDate,
			absenceEntry.startPeriod,
			absenceEntry.endDate,
			absenceEntry.endPeriod,
		);

		timeRecords.push({
			id: absenceEntry.id,
			organizationId: input.organizationId,
			employeeId: absenceEntry.employeeId,
			recordKind: "absence",
			startAt: interval.startAt,
			endAt: interval.endAt,
			durationMinutes: interval.durationMinutes,
			approvalState: absenceEntry.status,
			origin: "system",
			createdAt: absenceEntry.createdAt,
			createdBy: input.actorId,
			updatedAt: absenceEntry.updatedAt,
			updatedBy: input.actorId,
		});

		timeRecordAbsence.push({
			recordId: absenceEntry.id,
			organizationId: input.organizationId,
			recordKind: "absence",
			absenceCategoryId: absenceEntry.categoryId,
			startPeriod: absenceEntry.startPeriod,
			endPeriod: absenceEntry.endPeriod,
			countsAgainstVacation: categoryVacationFlagById.get(absenceEntry.categoryId) ?? true,
		});

		absenceRecordMap.set(absenceEntry.id, absenceEntry.id);
	}

	for (const approvalRequest of approvals) {
		const recordId =
			approvalRequest.entityType === "time_entry"
				? workPeriodRecordMap.get(approvalRequest.entityId)
				: absenceRecordMap.get(approvalRequest.entityId);

		if (!recordId) {
			continue;
		}

		timeRecordApprovalDecision.push({
			organizationId: input.organizationId,
			recordId,
			actorEmployeeId:
				approvalRequest.status === "pending"
					? approvalRequest.requestedBy
					: approvalRequest.approverId,
			action: mapApprovalStatusToAction(approvalRequest.status),
			reason: approvalRequest.rejectionReason ?? approvalRequest.reason,
			createdAt: approvalRequest.approvedAt ?? approvalRequest.createdAt,
		});
	}

	return {
		timeRecords,
		timeRecordWork,
		timeRecordAbsence,
		timeRecordApprovalDecision,
		legacyLinks: {
			workPeriod: workPeriods.map((workPeriod) => ({
				id: workPeriod.id,
				canonicalRecordId: workPeriod.id,
			})),
			absenceEntry: absences.map((absenceEntry) => ({
				id: absenceEntry.id,
				canonicalRecordId: absenceEntry.id,
			})),
			approvalRequest: approvals
				.map((approvalRequest) => {
					const canonicalRecordId =
						approvalRequest.entityType === "time_entry"
							? workPeriodRecordMap.get(approvalRequest.entityId)
							: absenceRecordMap.get(approvalRequest.entityId);

					if (!canonicalRecordId) {
						return null;
					}

					return {
						id: approvalRequest.id,
						canonicalRecordId,
					};
				})
				.filter((value): value is { id: string; canonicalRecordId: string } => value !== null),
		},
	};
}

function mapApprovalStatusToAction(status: LegacyApprovalStatus): "submitted" | "approved" | "rejected" {
	if (status === "pending") {
		return "submitted";
	}

	return status;
}

function mapAbsenceToInterval(
	startDate: string,
	startPeriod: LegacyDayPeriod,
	endDate: string,
	endPeriod: LegacyDayPeriod,
): {
	startAt: Date;
	endAt: Date;
	durationMinutes: number;
} {
	const startAt = dateWithPeriod(startDate, startPeriod, "start");
	const endAt = dateWithPeriod(endDate, endPeriod, "end");

	const durationMinutes = Math.max(0, Math.round(endAt.diff(startAt, "minutes").minutes));

	return {
		startAt: startAt.toJSDate(),
		endAt: endAt.toJSDate(),
		durationMinutes,
	};
}

function dateWithPeriod(
	dateIso: string,
	period: LegacyDayPeriod,
	edge: "start" | "end",
): DateTime {
	const day = DateTime.fromISO(dateIso, { zone: "utc" });

	if (!day.isValid) {
		throw new Error(`Invalid absence date for backfill: ${dateIso}`);
	}

	if (period === "morning") {
		return edge === "start" ? day.startOf("day") : day.startOf("day").plus({ hours: 12 });
	}

	if (period === "afternoon") {
		return edge === "start"
			? day.startOf("day").plus({ hours: 12 })
			: day.endOf("day").plus({ millisecond: 1 });
	}

	return edge === "start" ? day.startOf("day") : day.endOf("day").plus({ millisecond: 1 });
}
