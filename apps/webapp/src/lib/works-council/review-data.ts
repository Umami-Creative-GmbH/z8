import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
	auditLog,
	type WorksCouncilAbsenceVisibility,
	type WorksCouncilIdentityVisibility,
} from "@/db/schema";
import { type SuppressedValue, suppressSmallGroups } from "./privacy";

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
			}>;
	  };

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

function suppressedCount(count: number, settings: WorksCouncilSettingsSnapshot) {
	return suppressSmallGroups({
		count,
		threshold: settings.minimumAggregationThreshold,
		value: count,
	});
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
		scheduleReview: [],
	};
}
