import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
	auditLog,
	type WorksCouncilAbsenceVisibility,
	type WorksCouncilIdentityVisibility,
} from "@/db/schema";

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
			dashboard: {
				overtimeMinutes: number;
				breakRestRiskCount: number;
				schedulePublicationCount: number;
				scheduleChangeCount: number;
				complianceFindingCount: number;
				absenceCoveragePressureCount: number;
				policyChangeCount: number;
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

export async function buildWorksCouncilPortalModel(
	input: BuildWorksCouncilPortalModelInput,
): Promise<WorksCouncilPortalModel> {
	if (!input.settings.enabled) {
		return { state: "disabled", dashboard: null, changeLog: [], scheduleReview: [] };
	}

	const queryRequest = buildQueryRequest(input);
	input.collectQueryContract?.(queryRequest);
	const changeRows = await (input.queryAuditChanges ?? queryAuditChanges)(queryRequest);

	return {
		state: "ready",
		dashboard: {
			overtimeMinutes: 0,
			breakRestRiskCount: 0,
			schedulePublicationCount: changeRows.filter(isSchedulePublication).length,
			scheduleChangeCount: changeRows.filter(isScheduleChange).length,
			complianceFindingCount: changeRows.filter((row) =>
				row.entityType.toLowerCase().includes("compliance"),
			).length,
			absenceCoveragePressureCount: 0,
			policyChangeCount: changeRows.filter(isPolicyChange).length,
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
