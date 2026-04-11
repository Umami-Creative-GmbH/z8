import { DateTime } from "luxon";
import { eq, inArray, isNull } from "drizzle-orm";

import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	db,
	employee,
	timeRecord,
	timeRecordAbsence,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
	workPeriod,
} from "@/db";

type LegacyApprovalStatus = "pending" | "approved" | "rejected";
type CanonicalDayPeriod = "full_day" | "am" | "pm";
type LegacyDayPeriod = CanonicalDayPeriod | "morning" | "afternoon";
type LegacyEntityType = "time_entry" | "absence_entry";

export type LegacyWorkPeriod = {
	id: string;
	organizationId: string;
	employeeId: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	approvalStatus: LegacyApprovalStatus;
	projectId: string | null;
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

export type CanonicalBackfillRunInput = {
	organizationId: string;
	actorId: string;
	legacy?: CanonicalBackfillInput["legacy"];
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
		startPeriod: CanonicalDayPeriod;
		endPeriod: CanonicalDayPeriod;
		countsAgainstVacation: boolean;
	}>;
	timeRecordAllocation: Array<{
		organizationId: string;
		recordId: string;
		allocationKind: "project";
		projectId: string;
		weightPercent: number;
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
		absenceEntry: Array<{ id: string; canonicalRecordId: string; organizationId: string }>;
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
	const timeRecordAllocation: CanonicalBackfillPayload["timeRecordAllocation"] = [];
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

		if (workPeriod.projectId) {
			timeRecordAllocation.push({
				organizationId: input.organizationId,
				recordId: workPeriod.id,
				allocationKind: "project",
				projectId: workPeriod.projectId,
				weightPercent: 100,
			});
		}

		workPeriodRecordMap.set(workPeriod.id, workPeriod.id);
	}

	for (const absenceEntry of absences) {
		const startPeriod = normalizeLegacyDayPeriod(absenceEntry.startPeriod);
		const endPeriod = normalizeLegacyDayPeriod(absenceEntry.endPeriod);

		const interval = mapAbsenceToInterval(
			absenceEntry.startDate,
			startPeriod,
			absenceEntry.endDate,
			endPeriod,
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
			startPeriod,
			endPeriod,
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
		timeRecordAllocation,
		timeRecordApprovalDecision,
		legacyLinks: {
			workPeriod: workPeriods.map((workPeriod) => ({
				id: workPeriod.id,
				canonicalRecordId: workPeriod.id,
			})),
			absenceEntry: absences.map((absenceEntry) => ({
				id: absenceEntry.id,
				canonicalRecordId: absenceEntry.id,
				organizationId: input.organizationId,
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

export async function runCanonicalBackfill(
	input: CanonicalBackfillRunInput,
): Promise<CanonicalBackfillPayload> {
	const resolvedInput = input.legacy
		? { organizationId: input.organizationId, actorId: input.actorId, legacy: input.legacy }
		: await loadCanonicalBackfillInput(input);
	const payload = buildCanonicalBackfillPayload(resolvedInput);

	await db.transaction(async (tx) => {
		await insertIfPresent(tx, timeRecord, payload.timeRecords);
		await insertIfPresent(tx, timeRecordWork, payload.timeRecordWork);
		await insertIfPresent(tx, timeRecordAbsence, payload.timeRecordAbsence);

		const allocationRecordIds = payload.timeRecordAllocation.map((allocation) => allocation.recordId);
		if (allocationRecordIds.length > 0) {
			await tx
				.delete(timeRecordAllocation)
				.where(inArray(timeRecordAllocation.recordId, allocationRecordIds));
			await tx.insert(timeRecordAllocation).values(payload.timeRecordAllocation);
		}

		const decisionRecordIds = payload.timeRecordApprovalDecision.map((decision) => decision.recordId);
		if (decisionRecordIds.length > 0) {
			await tx
				.delete(timeRecordApprovalDecision)
				.where(inArray(timeRecordApprovalDecision.recordId, decisionRecordIds));
			await tx.insert(timeRecordApprovalDecision).values(payload.timeRecordApprovalDecision);
		}

		for (const link of payload.legacyLinks.workPeriod) {
			await tx
				.update(workPeriod)
				.set({ canonicalRecordId: link.canonicalRecordId })
				.where(eq(workPeriod.id, link.id));
		}

		for (const link of payload.legacyLinks.absenceEntry) {
			await tx
				.update(absenceEntry)
				.set({
					canonicalRecordId: link.canonicalRecordId,
					organizationId: link.organizationId,
				})
				.where(eq(absenceEntry.id, link.id));
		}

		for (const link of payload.legacyLinks.approvalRequest) {
			await tx
				.update(approvalRequest)
				.set({ canonicalRecordId: link.canonicalRecordId })
				.where(eq(approvalRequest.id, link.id));
		}
	});

	return payload;
}

async function loadCanonicalBackfillInput(
	input: CanonicalBackfillRunInput,
): Promise<CanonicalBackfillInput> {
	const [targetEmployees, workPeriods, scopedAbsenceEntries, nullOrgAbsenceEntries, approvalRequests, absenceCategories] =
		await Promise.all([
			db.query.employee.findMany({
				where: eq(employee.organizationId, input.organizationId),
				columns: { id: true },
			}),
			db.query.workPeriod.findMany({
				where: eq(workPeriod.organizationId, input.organizationId),
			}),
			db.query.absenceEntry.findMany({
				where: eq(absenceEntry.organizationId, input.organizationId),
			}),
			db.query.absenceEntry.findMany({
				where: isNull(absenceEntry.organizationId),
			}),
			db.query.approvalRequest.findMany({
				where: eq(approvalRequest.organizationId, input.organizationId),
			}),
			db.query.absenceCategory.findMany({
				where: eq(absenceCategory.organizationId, input.organizationId),
				columns: { id: true, countsAgainstVacation: true },
			}),
		]);

	const targetEmployeeIds = new Set(targetEmployees.map((record) => record.id));
	const attributedNullOrgAbsenceEntries = nullOrgAbsenceEntries
		.filter((record) => targetEmployeeIds.has(record.employeeId))
		.map((record) => ({
			...record,
			organizationId: input.organizationId,
		}));

	return {
		organizationId: input.organizationId,
		actorId: input.actorId,
		legacy: {
			workPeriods,
			absenceEntries: [...scopedAbsenceEntries, ...attributedNullOrgAbsenceEntries],
			approvalRequests,
			absenceCategories,
		},
	};
}

async function insertIfPresent<TTable, TValue>(
	tx: {
		insert: (table: TTable) => {
			values: (values: TValue[]) => {
				onConflictDoNothing: () => Promise<unknown>;
			};
		};
	},
	table: TTable,
	values: TValue[],
) {
	if (values.length === 0) {
		return;
	}

	await tx.insert(table).values(values).onConflictDoNothing();
}

function mapApprovalStatusToAction(status: LegacyApprovalStatus): "submitted" | "approved" | "rejected" {
	if (status === "pending") {
		return "submitted";
	}

	return status;
}

function mapAbsenceToInterval(
	startDate: string,
	startPeriod: CanonicalDayPeriod,
	endDate: string,
	endPeriod: CanonicalDayPeriod,
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
	period: CanonicalDayPeriod,
	edge: "start" | "end",
): DateTime {
	const day = DateTime.fromISO(dateIso, { zone: "utc" });

	if (!day.isValid) {
		throw new Error(`Invalid absence date for backfill: ${dateIso}`);
	}

	if (period === "am") {
		return edge === "start" ? day.startOf("day") : day.startOf("day").plus({ hours: 12 });
	}

	if (period === "pm") {
		return edge === "start"
			? day.startOf("day").plus({ hours: 12 })
			: day.endOf("day").plus({ millisecond: 1 });
	}

	return edge === "start" ? day.startOf("day") : day.endOf("day").plus({ millisecond: 1 });
}

function normalizeLegacyDayPeriod(period: LegacyDayPeriod): CanonicalDayPeriod {
	if (period === "morning") {
		return "am";
	}

	if (period === "afternoon") {
		return "pm";
	}

	return period;
}
