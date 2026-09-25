import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { approvalRequest, auditLog, type auditPackRequest, db, timeEntry } from "@/db";
import { auditExportOrchestrator, type HardenExportResult } from "@/lib/audit-export";
import type { AppendAssuranceReport } from "@/lib/time-tracking/append-assurance";
import {
	readAppendAssurance,
	withAppendEvidenceSnapshot,
} from "@/lib/time-tracking/append-assurance-reader";
import {
	type AuditEntryRow,
	type AuditPackAppendAssurance,
	summarizeAuditPackAssurance,
	toEntryChainEvidenceInput,
	toLineageNode,
	toPackAssuranceRecord,
} from "../domain/append-lineage-evidence";
import { buildApprovalEvidence } from "../domain/approval-evidence-builder";
import { buildAuditTimeline } from "../domain/audit-timeline-builder";
import { assembleAuditPackZip } from "../domain/bundle-assembler";
import { buildCorrectionClosure } from "../domain/correction-lineage-builder";
import { buildEntryChainEvidence } from "../domain/entry-chain-builder";
import type { CorrectionLinkNode, LineageLinkNode } from "../domain/types";
import { auditPackRequestRepository } from "./request-repository";

export type AuditPackExecutionStatus =
	| "collecting"
	| "lineage_expanding"
	| "assembling"
	| "hardening"
	| "completed"
	| "failed";

export interface GenerateAuditPackRequestInput {
	requestId: string;
	organizationId: string;
}

export interface AuditPackFailureInput {
	requestId: string;
	organizationId: string;
	status: "failed";
	errorCode: string;
	errorMessage: string;
}

export interface AuditPackArtifactInput {
	requestId: string;
	organizationId: string;
	auditExportPackageId: string;
	s3Key: string;
	entryCount: number;
	correctionNodeCount: number;
	approvalEventCount: number;
	timelineEventCount: number;
	expandedNodeCount: number;
	appendAssurance: AuditPackAppendAssurance;
}

export interface AuditPackAssembledPayload {
	zipBuffer: Buffer;
	counts: {
		entryCount: number;
		correctionNodeCount: number;
		approvalEventCount: number;
		timelineEventCount: number;
		expandedNodeCount: number;
	};
	appendAssurance: AuditPackAppendAssurance;
}

export interface AuditPackRepository {
	setStatus(input: {
		requestId: string;
		organizationId: string;
		status: Exclude<AuditPackExecutionStatus, "failed">;
	}): Promise<void>;
	failRequest(input: AuditPackFailureInput): Promise<void>;
	storeArtifact(input: AuditPackArtifactInput): Promise<void>;
}

export interface AuditPackOrchestratorDependencies {
	collect(input: GenerateAuditPackRequestInput): Promise<unknown>;
	expandLineage(collected: unknown, input: GenerateAuditPackRequestInput): Promise<unknown>;
	assemble(
		expanded: unknown,
		input: GenerateAuditPackRequestInput,
	): Promise<AuditPackAssembledPayload>;
	harden(
		assembled: AuditPackAssembledPayload,
		input: GenerateAuditPackRequestInput,
	): Promise<Pick<HardenExportResult, "auditPackageId" | "s3Key">>;
}

interface AuditPackCollectResult {
	request: typeof auditPackRequest.$inferSelect;
	baseEntries: Array<{ id: string; employeeId: string }>;
}

interface AuditPackExpandedResult extends AuditPackCollectResult {
	closure: ReturnType<typeof buildCorrectionClosure>;
	lineageEntries: AuditEntryRow[];
	/** Every employee whose entries the pack includes, assessed from one snapshot. */
	assuranceReports: AppendAssuranceReport[];
}

const STATUS_COLLECTING: Exclude<AuditPackExecutionStatus, "failed"> = "collecting";
const STATUS_LINEAGE_EXPANDING: Exclude<AuditPackExecutionStatus, "failed"> = "lineage_expanding";
const STATUS_ASSEMBLING: Exclude<AuditPackExecutionStatus, "failed"> = "assembling";
const STATUS_HARDENING: Exclude<AuditPackExecutionStatus, "failed"> = "hardening";
const STATUS_COMPLETED: Exclude<AuditPackExecutionStatus, "failed"> = "completed";

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function toErrorCode(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"errorCode" in error &&
		typeof (error as { errorCode?: unknown }).errorCode === "string"
	) {
		return (error as { errorCode: string }).errorCode;
	}

	return "audit_pack_generation_failed";
}

class AuditPackGenerationError extends Error {
	constructor(
		message: string,
		public readonly errorCode: string,
	) {
		super(message);
	}
}

function toLinkNode(entry: {
	id: string;
	previousEntryId: string | null;
	replacesEntryId: string | null;
	supersededById: string | null;
}): CorrectionLinkNode {
	return {
		id: entry.id,
		previousEntryId: entry.previousEntryId,
		replacesEntryId: entry.replacesEntryId,
		supersededById: entry.supersededById,
	};
}

function toIso(timestamp: Date): string {
	return DateTime.fromJSDate(timestamp, { zone: "utc" }).toISO() ?? timestamp.toISOString();
}

export class AuditPackOrchestrator {
	constructor(
		private readonly repository: AuditPackRepository,
		private readonly dependencies: AuditPackOrchestratorDependencies,
	) {}

	async generate(input: GenerateAuditPackRequestInput): Promise<void> {
		const { requestId, organizationId } = input;

		try {
			await this.repository.setStatus({ requestId, organizationId, status: STATUS_COLLECTING });
			const collected = await this.dependencies.collect(input);

			await this.repository.setStatus({
				requestId,
				organizationId,
				status: STATUS_LINEAGE_EXPANDING,
			});
			const expanded = await this.dependencies.expandLineage(collected, input);

			await this.repository.setStatus({ requestId, organizationId, status: STATUS_ASSEMBLING });
			const assembled = await this.dependencies.assemble(expanded, input);

			await this.repository.setStatus({ requestId, organizationId, status: STATUS_HARDENING });
			const hardened = await this.dependencies.harden(assembled, input);

			await this.repository.storeArtifact({
				requestId,
				organizationId,
				auditExportPackageId: hardened.auditPackageId,
				s3Key: hardened.s3Key,
				entryCount: assembled.counts.entryCount,
				correctionNodeCount: assembled.counts.correctionNodeCount,
				approvalEventCount: assembled.counts.approvalEventCount,
				timelineEventCount: assembled.counts.timelineEventCount,
				expandedNodeCount: assembled.counts.expandedNodeCount,
				appendAssurance: assembled.appendAssurance,
			});

			await this.repository.setStatus({ requestId, organizationId, status: STATUS_COMPLETED });
		} catch (error) {
			await this.repository.failRequest({
				requestId,
				organizationId,
				status: "failed",
				errorCode: toErrorCode(error),
				errorMessage: toErrorMessage(error),
			});

			throw error;
		}
	}
}

const defaultRepository: AuditPackRepository = {
	setStatus: (input) => auditPackRequestRepository.setStatus(input),
	failRequest: (input) => auditPackRequestRepository.failRequest(input),
	storeArtifact: (input) => auditPackRequestRepository.storeArtifact(input),
};

const defaultDependencies: AuditPackOrchestratorDependencies = {
	async collect(input) {
		const request = await auditPackRequestRepository.getRequest(input);
		if (!request) {
			throw new AuditPackGenerationError("Audit pack request not found", "request_not_found");
		}

		if (request.startDate > request.endDate) {
			throw new AuditPackGenerationError(
				"Audit pack request has invalid date range",
				"scope_invalid",
			);
		}

		const baseEntries = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, input.organizationId),
				gte(timeEntry.timestamp, request.startDate),
				lte(timeEntry.timestamp, request.endDate),
			),
			columns: {
				id: true,
				employeeId: true,
			},
		});

		return {
			request,
			baseEntries,
		} satisfies AuditPackCollectResult;
	},
	async expandLineage(collected) {
		const { request, baseEntries } = collected as AuditPackCollectResult;
		const organizationId = request.organizationId;

		// Append links resolve under the shared compatibility rules, per employee, from
		// one snapshot. Correction links may reach another employee in the organization.
		return withAppendEvidenceSnapshot(db, async (reader) => {
			const rowsById = new Map<string, AuditEntryRow>();
			const reports = new Map<string, AppendAssuranceReport>();

			const loadEmployees = async (employeeIds: readonly string[]) => {
				const pending = [...new Set(employeeIds)].filter((id) => !reports.has(id));
				if (pending.length === 0) return;
				const assessed = await readAppendAssurance(reader, organizationId, pending);
				for (const [employeeId, report] of assessed) reports.set(employeeId, report);
				const rows = await reader
					.select({
						id: timeEntry.id,
						organizationId: timeEntry.organizationId,
						employeeId: timeEntry.employeeId,
						type: timeEntry.type,
						timestamp: timeEntry.timestamp,
						hash: timeEntry.hash,
						previousHash: timeEntry.previousHash,
						previousEntryId: timeEntry.previousEntryId,
						replacesEntryId: timeEntry.replacesEntryId,
						supersededById: timeEntry.supersededById,
					})
					.from(timeEntry)
					.where(
						and(
							eq(timeEntry.organizationId, organizationId),
							inArray(timeEntry.employeeId, pending),
						),
					);
				for (const row of rows) rowsById.set(row.id, row);
			};

			await loadEmployees(baseEntries.map((entry) => entry.employeeId));
			const missingSeedIds = baseEntries
				.filter((entry) => !rowsById.has(entry.id))
				.map((entry) => entry.id);
			if (missingSeedIds.length > 0) {
				throw new AuditPackGenerationError(
					`Seed entries missing in organization scope: ${missingSeedIds.join(", ")}`,
					"lineage_broken",
				);
			}

			for (;;) {
				const lookupById: Record<string, LineageLinkNode> = {};
				for (const row of rowsById.values()) lookupById[row.id] = toLineageNode(row, reports);
				const closure = buildCorrectionClosure(
					baseEntries.map((entry) => lookupById[entry.id]),
					lookupById,
				);
				const missingIds = closure.nodeIds.filter((id) => !rowsById.has(id));
				if (missingIds.length === 0) {
					return {
						request,
						baseEntries,
						closure,
						lineageEntries: closure.nodeIds.flatMap((id) => {
							const row = rowsById.get(id);
							return row ? [row] : [];
						}),
						assuranceReports: [...reports.values()],
					} satisfies AuditPackExpandedResult;
				}

				// Resolved append links stay within loaded employees, so only correction
				// links can be missing. Required correction evidence is never silently dropped.
				const linkedRows = await reader
					.select({ id: timeEntry.id, employeeId: timeEntry.employeeId })
					.from(timeEntry)
					.where(
						and(eq(timeEntry.organizationId, organizationId), inArray(timeEntry.id, missingIds)),
					);
				const foundIds = new Set(linkedRows.map((row) => row.id));
				const unavailableIds = missingIds.filter((id) => !foundIds.has(id));
				if (unavailableIds.length > 0) {
					throw new AuditPackGenerationError(
						`Linked entries missing in organization scope: ${unavailableIds.join(", ")}`,
						"lineage_broken",
					);
				}
				await loadEmployees(linkedRows.map((row) => row.employeeId));
			}
		});
	},
	async assemble(expanded) {
		const typedExpanded = expanded as AuditPackExpandedResult;
		const organizationId = typedExpanded.request.organizationId;

		const reportsByEmployee = new Map(
			typedExpanded.assuranceReports.map((report) => [report.employeeId, report]),
		);
		const entryEvidence = buildEntryChainEvidence(
			typedExpanded.lineageEntries.map((entry) =>
				toEntryChainEvidenceInput(entry, reportsByEmployee, toIso(entry.timestamp)),
			),
			organizationId,
		);
		const appendAssurance = summarizeAuditPackAssurance(typedExpanded.assuranceReports);

		const correctionNodes = typedExpanded.closure.nodeIds
			.map((id) => typedExpanded.lineageEntries.find((entry) => entry.id === id))
			.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
			.map((entry) => toLinkNode(entry));

		const approvalRows = await db.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				gte(approvalRequest.createdAt, typedExpanded.request.startDate),
				lte(approvalRequest.createdAt, typedExpanded.request.endDate),
			),
			columns: {
				id: true,
				organizationId: true,
				entityId: true,
				approverId: true,
				status: true,
				approvedAt: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		const approvalEvidence = buildApprovalEvidence(
			approvalRows.map((approval) => {
				const approvedAt =
					approval.status === "pending"
						? approval.createdAt
						: (approval.approvedAt ?? approval.updatedAt ?? approval.createdAt);

				return {
					id: approval.id,
					organizationId: approval.organizationId,
					entryId: approval.entityId,
					approvedAt: toIso(approvedAt),
					status:
						approval.status === "pending"
							? "submitted"
							: approval.status === "approved"
								? "approved"
								: "rejected",
					approvedById: approval.approverId,
				};
			}),
			organizationId,
		);

		const auditLogs = await db.query.auditLog.findMany({
			where: and(
				eq(auditLog.organizationId, organizationId),
				gte(auditLog.timestamp, typedExpanded.request.startDate),
				lte(auditLog.timestamp, typedExpanded.request.endDate),
			),
			columns: {
				id: true,
				timestamp: true,
			},
		});

		const timelineEvents = buildAuditTimeline([
			...typedExpanded.lineageEntries.map((entry) => ({
				id: `entry:${entry.id}`,
				source: "entry" as const,
				occurredAt: toIso(entry.timestamp),
			})),
			...approvalRows.flatMap((approval) => {
				const submitted = {
					id: `approval:${approval.id}:submitted`,
					source: "approval" as const,
					occurredAt: toIso(approval.createdAt),
				};

				if (approval.status === "pending") {
					return [submitted];
				}

				return [
					submitted,
					{
						id: `approval:${approval.id}:${approval.status}`,
						source: "approval" as const,
						occurredAt: toIso(approval.approvedAt ?? approval.updatedAt ?? approval.createdAt),
					},
				];
			}),
			...auditLogs.map((item) => ({
				id: `audit-log:${item.id}`,
				source: "audit_log" as const,
				occurredAt: toIso(item.timestamp),
			})),
		]);

		const sortedLineageEntries = typedExpanded.lineageEntries.toSorted((a, b) =>
			a.timestamp.getTime() === b.timestamp.getTime()
				? a.id.localeCompare(b.id)
				: a.timestamp.getTime() - b.timestamp.getTime(),
		);

		const zipBuffer = await assembleAuditPackZip({
			entries: entryEvidence,
			corrections: correctionNodes,
			approvals: approvalEvidence,
			timeline: timelineEvents,
			appendAssurance: typedExpanded.assuranceReports.map((report) =>
				toPackAssuranceRecord(report),
			),
			scope: {
				organizationId,
				requestedStartDate: toIso(typedExpanded.request.startDate),
				requestedEndDate: toIso(typedExpanded.request.endDate),
				includedEntryCount: entryEvidence.length,
				expandedOutsideRange: typedExpanded.closure.expandedOutsideRange,
				// Exact append assurance scope; evidence/append-assurance.json has each employee's.
				appendAssurance,
				includedStartDate:
					sortedLineageEntries.length > 0 ? toIso(sortedLineageEntries[0].timestamp) : null,
				includedEndDate:
					sortedLineageEntries.length > 0
						? toIso(sortedLineageEntries[sortedLineageEntries.length - 1].timestamp)
						: null,
			},
		});

		return {
			zipBuffer,
			counts: {
				entryCount: entryEvidence.length,
				correctionNodeCount: correctionNodes.length,
				approvalEventCount: approvalEvidence.length,
				timelineEventCount: timelineEvents.length,
				expandedNodeCount: typedExpanded.closure.expandedOutsideRange.length,
			},
			appendAssurance,
		};
	},
	async harden(assembled, input) {
		const request = await auditPackRequestRepository.getRequest(input);
		if (!request) {
			throw new AuditPackGenerationError("Audit pack request not found", "request_not_found");
		}

		const hardened = await auditExportOrchestrator.hardenExport({
			exportId: input.requestId,
			organizationId: input.organizationId,
			requestedById: request.requestedById,
			exportType: "audit_pack",
			zipBuffer: assembled.zipBuffer,
		});

		return {
			auditPackageId: hardened.auditPackageId,
			s3Key: hardened.s3Key,
		};
	},
};

export const auditPackOrchestrator = new AuditPackOrchestrator(
	defaultRepository,
	defaultDependencies,
);
