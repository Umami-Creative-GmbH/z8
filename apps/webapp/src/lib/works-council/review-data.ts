import { and, asc, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	auditLog,
	employee,
	location,
	locationSubarea,
	shift,
	team,
	type WorksCouncilAbsenceVisibility,
	type WorksCouncilIdentityVisibility,
} from "@/db/schema";
import { applyIdentityVisibility, type SuppressedValue, suppressSmallGroups } from "./privacy";

export interface WorksCouncilSettingsSnapshot {
	enabled: boolean;
	identityVisibility: WorksCouncilIdentityVisibility;
	absenceVisibility: WorksCouncilAbsenceVisibility;
	exportEnabled: boolean;
	minimumAggregationThreshold: number;
	visibleTeamIds: string[];
	visibleLocationIds: string[];
}

export interface WorksCouncilQueryContractRequest {
	organizationId: string;
	dateRangeStart: Date;
	dateRangeEnd: Date;
}

export interface WorksCouncilAuditChangeRow {
	id: string;
	timestamp: Date;
	action: string;
	entityType: string;
	organizationId: string;
	teamId?: string | null;
	locationId?: string | null;
}

export interface WorksCouncilScheduleReviewRow {
	id: string;
	startsAt: Date;
	endsAt: Date;
	employeeId: string | null;
	employeeName: string | null;
	teamId: string | null;
	teamName: string | null;
	locationId: string | null;
	status: "draft" | "published";
}

type WorksCouncilScheduleIdentityState = "available" | "hidden" | "insufficient_data";

export interface BuildWorksCouncilPortalModelInput {
	organizationId: string;
	actorUserId: string;
	dateRangeStart: Date;
	dateRangeEnd: Date;
	settings: WorksCouncilSettingsSnapshot;
	collectQueryContract?: (request: WorksCouncilQueryContractRequest) => void;
	queryAuditChanges?: (
		request: WorksCouncilQueryContractRequest,
	) => Promise<WorksCouncilAuditChangeRow[]>;
	queryScheduleReview?: (
		request: WorksCouncilQueryContractRequest,
	) => Promise<WorksCouncilScheduleReviewRow[]>;
}

export type WorksCouncilPortalModel =
	| { state: "disabled"; dashboard: null; changeLog: []; scheduleReview: [] }
	| {
			state: "ready";
			dateRange: { start: string; end: string };
			exportEnabled: boolean;
			dashboard: {
				overtimeMinutes: SuppressedValue<number>;
				breakRestRiskCount: SuppressedValue<number>;
				schedulePublicationCount: SuppressedValue<number>;
				scheduleChangeCount: SuppressedValue<number>;
				complianceFindingCount: SuppressedValue<number>;
				absenceCoveragePressureCount: SuppressedValue<number>;
				policyChangeCount: SuppressedValue<number>;
			};
			changeLog: Array<{
				id: string;
				timestamp: string;
				eventType: string;
				actorLabel: string;
				summary: string;
			}>;
			scheduleReview: Array<{
				id: string;
				startsAt: string;
				endsAt: string;
				teamName: string | null;
				employeeName: string | null;
				identityState: WorksCouncilScheduleIdentityState;
			}>;
	  };

function shiftDateTime(date: Date, time: string) {
	const dateKey = DateTime.fromJSDate(date, { zone: "utc" }).toISODate();
	if (!dateKey) throw new Error("Failed to resolve shift date");

	return DateTime.fromISO(`${dateKey}T${time}`, { zone: "utc" });
}

function buildShiftDateRange(date: Date, startTime: string, endTime: string) {
	const startsAt = shiftDateTime(date, startTime);
	const parsedEndsAt = shiftDateTime(date, endTime);
	const endsAt = parsedEndsAt <= startsAt ? parsedEndsAt.plus({ days: 1 }) : parsedEndsAt;

	return { startsAt: startsAt.toJSDate(), endsAt: endsAt.toJSDate() };
}

function employeeDisplayName(row: { firstName: string | null; lastName: string | null }) {
	return [row.firstName, row.lastName].filter(Boolean).join(" ") || null;
}

async function queryScheduleReview({
	organizationId,
	dateRangeStart,
	dateRangeEnd,
}: WorksCouncilQueryContractRequest): Promise<WorksCouncilScheduleReviewRow[]> {
	const rows = await db
		.select({
			id: shift.id,
			date: shift.date,
			startTime: shift.startTime,
			endTime: shift.endTime,
			employeeId: shift.employeeId,
			employeeFirstName: employee.firstName,
			employeeLastName: employee.lastName,
			teamId: employee.teamId,
			teamName: team.name,
			locationId: location.id,
			status: shift.status,
		})
		.from(shift)
		.innerJoin(locationSubarea, eq(shift.subareaId, locationSubarea.id))
		.innerJoin(location, eq(locationSubarea.locationId, location.id))
		.leftJoin(
			employee,
			and(eq(shift.employeeId, employee.id), eq(employee.organizationId, shift.organizationId)),
		)
		.leftJoin(
			team,
			and(eq(employee.teamId, team.id), eq(team.organizationId, shift.organizationId)),
		)
		.where(
			and(
				eq(shift.organizationId, organizationId),
				eq(location.organizationId, organizationId),
				eq(shift.status, "published"),
				gte(shift.date, dateRangeStart),
				lte(shift.date, dateRangeEnd),
			),
		)
		.orderBy(asc(shift.date), asc(shift.startTime), asc(shift.id));

	return rows.map((row) => {
		const { startsAt, endsAt } = buildShiftDateRange(row.date, row.startTime, row.endTime);

		return {
			id: row.id,
			startsAt,
			endsAt,
			employeeId: row.employeeId,
			employeeName: employeeDisplayName({
				firstName: row.employeeFirstName,
				lastName: row.employeeLastName,
			}),
			teamId: row.teamId,
			teamName: row.teamName,
			locationId: row.locationId,
			status: row.status,
		};
	});
}

async function queryAuditChanges({
	organizationId,
	dateRangeStart,
	dateRangeEnd,
}: WorksCouncilQueryContractRequest): Promise<WorksCouncilAuditChangeRow[]> {
	return db
		.select({
			id: auditLog.id,
			timestamp: auditLog.timestamp,
			action: auditLog.action,
			entityType: auditLog.entityType,
			organizationId: auditLog.organizationId,
		})
		.from(auditLog)
		.where(
			and(
				eq(auditLog.organizationId, organizationId),
				gte(auditLog.timestamp, dateRangeStart),
				lte(auditLog.timestamp, dateRangeEnd),
			),
		);
}

function buildQueryRequest(
	input: BuildWorksCouncilPortalModelInput,
): WorksCouncilQueryContractRequest {
	return {
		organizationId: input.organizationId,
		dateRangeStart: input.dateRangeStart,
		dateRangeEnd: input.dateRangeEnd,
	};
}

function isPolicyChange(row: WorksCouncilAuditChangeRow) {
	return row.entityType.toLowerCase().includes("policy");
}

function isSchedulePublication(row: WorksCouncilAuditChangeRow) {
	return (
		row.entityType.toLowerCase().includes("schedule") &&
		row.action.toLowerCase().includes("publish")
	);
}

function isScheduleChange(row: WorksCouncilAuditChangeRow) {
	return row.entityType.toLowerCase().includes("schedule");
}

function isComplianceFinding(row: WorksCouncilAuditChangeRow) {
	return row.entityType.toLowerCase().includes("compliance");
}

function isAllowedWorkforceImpactingChange(row: WorksCouncilAuditChangeRow) {
	const entityType = row.entityType.toLowerCase();
	return (
		entityType.includes("schedule") ||
		entityType.includes("policy") ||
		entityType.includes("compliance") ||
		entityType.includes("absence") ||
		entityType.includes("time") ||
		entityType.includes("shift")
	);
}

function matchesConfiguredScope(
	row: WorksCouncilAuditChangeRow,
	settings: WorksCouncilSettingsSnapshot,
) {
	const teamAllowed =
		settings.visibleTeamIds.length === 0 ||
		!row.teamId ||
		settings.visibleTeamIds.includes(row.teamId);
	const locationAllowed =
		settings.visibleLocationIds.length === 0 ||
		!row.locationId ||
		settings.visibleLocationIds.includes(row.locationId);

	return teamAllowed && locationAllowed;
}

function matchesScheduleScope(
	row: WorksCouncilScheduleReviewRow,
	settings: WorksCouncilSettingsSnapshot,
) {
	const teamAllowed =
		settings.visibleTeamIds.length === 0 ||
		(row.teamId !== null && settings.visibleTeamIds.includes(row.teamId));
	const locationAllowed =
		settings.visibleLocationIds.length === 0 ||
		(row.locationId !== null && settings.visibleLocationIds.includes(row.locationId));

	return teamAllowed && locationAllowed;
}

function suppressedCount(count: number, settings: WorksCouncilSettingsSnapshot) {
	return suppressSmallGroups({
		count,
		threshold: settings.minimumAggregationThreshold,
		value: count,
	});
}

function applyScheduleIdentityVisibility(
	rows: WorksCouncilScheduleReviewRow[],
	settings: WorksCouncilSettingsSnapshot,
) {
	if (
		settings.identityVisibility !== "aggregated" &&
		rows.length < settings.minimumAggregationThreshold
	) {
		return rows.map((row) => ({
			...row,
			employeeId: null,
			employeeName: null,
			identityState: "insufficient_data" as const,
		}));
	}

	const identityState: WorksCouncilScheduleIdentityState =
		settings.identityVisibility === "aggregated" ? "hidden" : "available";
	return applyIdentityVisibility(rows, settings.identityVisibility).map((row) => ({
		...row,
		identityState,
	}));
}

export async function buildWorksCouncilPortalModel(
	input: BuildWorksCouncilPortalModelInput,
): Promise<WorksCouncilPortalModel> {
	if (!input.settings.enabled) {
		return { state: "disabled", dashboard: null, changeLog: [], scheduleReview: [] };
	}

	const queryRequest = buildQueryRequest(input);
	input.collectQueryContract?.(queryRequest);
	const changeRows = (await (input.queryAuditChanges ?? queryAuditChanges)(queryRequest)).filter(
		(row) => isAllowedWorkforceImpactingChange(row) && matchesConfiguredScope(row, input.settings),
	);
	const scheduleRows = applyScheduleIdentityVisibility(
		(await (input.queryScheduleReview ?? queryScheduleReview)(queryRequest)).filter(
			(row) => row.status === "published" && matchesScheduleScope(row, input.settings),
		),
		input.settings,
	);

	return {
		state: "ready",
		dateRange: {
			start: input.dateRangeStart.toISOString(),
			end: input.dateRangeEnd.toISOString(),
		},
		exportEnabled: input.settings.exportEnabled,
		dashboard: {
			overtimeMinutes: suppressedCount(0, input.settings),
			breakRestRiskCount: suppressedCount(0, input.settings),
			schedulePublicationCount: suppressedCount(
				changeRows.filter(isSchedulePublication).length,
				input.settings,
			),
			scheduleChangeCount: suppressedCount(
				changeRows.filter(isScheduleChange).length,
				input.settings,
			),
			complianceFindingCount: suppressedCount(
				changeRows.filter(isComplianceFinding).length,
				input.settings,
			),
			absenceCoveragePressureCount: suppressedCount(0, input.settings),
			policyChangeCount: suppressedCount(changeRows.filter(isPolicyChange).length, input.settings),
		},
		changeLog: changeRows.map((row) => ({
			id: row.id,
			timestamp: row.timestamp.toISOString(),
			eventType: row.action,
			actorLabel: "Authorized user",
			summary: `${row.entityType} ${row.action}`,
		})),
		scheduleReview: scheduleRows.map((row) => ({
			id: row.id,
			startsAt: row.startsAt.toISOString(),
			endsAt: row.endsAt.toISOString(),
			teamName: row.teamName,
			employeeName: row.employeeName,
			identityState: row.identityState,
		})),
	};
}
