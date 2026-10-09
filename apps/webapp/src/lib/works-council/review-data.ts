import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
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
import { dateFromInstant, instantFromDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
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

/**
 * The published shifts of the portal's calendar days. The portal's range spans whole UTC days
 * (`from` 00:00Z through `to` 23:59:59.999Z); a shift belongs to it by its organization-local
 * date, and its wall times are read in the organization's zone.
 */
async function queryScheduleReview({
	organizationId,
	dateRangeStart,
	dateRangeEnd,
}: WorksCouncilQueryContractRequest): Promise<WorksCouncilScheduleReviewRow[]> {
	const timezone = await loadOrganizationTimezone(db, organizationId);
	const bounds = shiftDateRangeBounds(
		plainDateAt(instantFromDate(dateRangeStart), "UTC"),
		plainDateAt(instantFromDate(dateRangeEnd), "UTC").add({ days: 1 }),
		timezone,
	);
	const rows = await db
		.select({
			id: shift.id,
			date: shift.date,
			startTime: shift.startTime,
			endTime: shift.endTime,
			employeeId: shift.employeeId,
			employeeName: user.name,
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
		.leftJoin(user, eq(employee.userId, user.id))
		.leftJoin(
			team,
			and(eq(employee.teamId, team.id), eq(team.organizationId, shift.organizationId)),
		)
		.where(
			and(
				eq(shift.organizationId, organizationId),
				eq(location.organizationId, organizationId),
				eq(shift.status, "published"),
				gte(shift.date, bounds.start),
				lt(shift.date, bounds.endExclusive),
			),
		)
		.orderBy(asc(shift.date), asc(shift.startTime), asc(shift.id));

	return rows.map((row) => {
		const interval = shiftInterval(
			{
				date: shiftCalendarDate(row.date, timezone),
				startTime: row.startTime,
				endTime: row.endTime,
			},
			timezone,
		);

		return {
			id: row.id,
			startsAt: dateFromInstant(interval.start),
			endsAt: dateFromInstant(interval.end),
			employeeId: row.employeeId,
			employeeName: row.employeeName,
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
