import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import {
	auditLog,
	approvalRequest,
	auditPackRequest,
	db,
	timeEntry,
} from "@/db";
import { auditExportOrchestrator, type HardenExportResult } from "@/lib/audit-export";
import { assembleAuditPackZip } from "../domain/bundle-assembler";
import { buildApprovalEvidence } from "../domain/approval-evidence-builder";
import { buildAuditTimeline } from "../domain/audit-timeline-builder";
import { buildCorrectionClosure } from "../domain/correction-lineage-builder";
import { buildEntryChainEvidence } from "../domain/entry-chain-builder";
import type { CorrectionLinkNode } from "../domain/types";
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
	assemble(expanded: unknown, input: GenerateAuditPackRequestInput): Promise<AuditPackAssembledPayload>;
	harden(
		assembled: AuditPackAssembledPayload,
		input: GenerateAuditPackRequestInput,
	): Promise<Pick<HardenExportResult, "auditPackageId" | "s3Key">>;
}

interface AuditPackCollectResult {
	request: typeof auditPackRequest.$inferSelect;
	baseEntries: CorrectionLinkNode[];
}

interface AuditPackExpandedResult extends AuditPackCollectResult {
	closure: ReturnType<typeof buildCorrectionClosure>;
	lineageEntries: Array<
		CorrectionLinkNode & {
			organizationId: string;
			timestamp: Date;
		}
	>;
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

function getLinkedIds(node: CorrectionLinkNode): string[] {
	const linkedIds = [node.previousEntryId, node.replacesEntryId, node.supersededById];
	return linkedIds.filter((id): id is string => typeof id === "string" && id.length > 0);
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

			await this.repository.setStatus({ requestId, organizationId, status: STATUS_LINEAGE_EXPANDING });
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
				previousEntryId: true,
				replacesEntryId: true,
				supersededById: true,
			},
		});

		return {
			request,
			baseEntries: baseEntries.map((entry) => toLinkNode(entry)),
		} satisfies AuditPackCollectResult;
	},
	async expandLineage(collected) {
		const typedCollected = collected as AuditPackCollectResult;
		const entriesById = new Map<
			string,
			CorrectionLinkNode & { organizationId: string; timestamp: Date }
		>();

		const seedIds = new Set<string>();
		for (const node of typedCollected.baseEntries) {
			seedIds.add(node.id);
		}

		if (seedIds.size > 0) {
			const seedEntries = await db.query.timeEntry.findMany({
				where: and(
					eq(timeEntry.organizationId, typedCollected.request.organizationId),
					inArray(timeEntry.id, [...seedIds]),
				),
				columns: {
					id: true,
					organizationId: true,
					timestamp: true,
					previousEntryId: true,
					replacesEntryId: true,
					supersededById: true,
				},
			});

			for (const entry of seedEntries) {
				entriesById.set(entry.id, {
					id: entry.id,
					organizationId: entry.organizationId,
					timestamp: entry.timestamp,
					previousEntryId: entry.previousEntryId,
					replacesEntryId: entry.replacesEntryId,
					supersededById: entry.supersededById,
				});
			}

			const missingSeedIds = [...seedIds].filter((id) => !entriesById.has(id));
			if (missingSeedIds.length > 0) {
				throw new AuditPackGenerationError(
					`Seed entries missing in organization scope: ${missingSeedIds.join(", ")}`,
					"lineage_broken",
				);
			}
		}

		const pendingLookupIds = new Set<string>();
		for (const entry of entriesById.values()) {
			for (const linkedId of getLinkedIds(entry)) {
				if (!entriesById.has(linkedId)) {
					pendingLookupIds.add(linkedId);
				}
			}
		}

		while (pendingLookupIds.size > 0) {
			const batchIds = [...pendingLookupIds];
			pendingLookupIds.clear();

			const linkedEntries = await db.query.timeEntry.findMany({
				where: and(
					eq(timeEntry.organizationId, typedCollected.request.organizationId),
					inArray(timeEntry.id, batchIds),
				),
				columns: {
					id: true,
					organizationId: true,
					timestamp: true,
					previousEntryId: true,
					replacesEntryId: true,
					supersededById: true,
				},
			});

			for (const entry of linkedEntries) {
				entriesById.set(entry.id, {
					id: entry.id,
					organizationId: entry.organizationId,
					timestamp: entry.timestamp,
					previousEntryId: entry.previousEntryId,
					replacesEntryId: entry.replacesEntryId,
					supersededById: entry.supersededById,
				});
			}

			const missingLinkedIds = batchIds.filter((id) => !entriesById.has(id));
			if (missingLinkedIds.length > 0) {
				throw new AuditPackGenerationError(
					`Linked entries missing in organization scope: ${missingLinkedIds.join(", ")}`,
					"lineage_broken",
				);
			}

			for (const entry of linkedEntries) {
				for (const linkedId of getLinkedIds(entry)) {
					if (!entriesById.has(linkedId)) {
						pendingLookupIds.add(linkedId);
					}
				}
			}
		}

		const correctionLookupById: Record<string, CorrectionLinkNode> = {};
		for (const entry of entriesById.values()) {
			correctionLookupById[entry.id] = toLinkNode(entry);
		}

		const closure = buildCorrectionClosure(typedCollected.baseEntries, correctionLookupById);
		const lineageEntries = closure.nodeIds
			.map((id) => entriesById.get(id))
			.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

		if (lineageEntries.length !== closure.nodeIds.length) {
			const foundIds = new Set(lineageEntries.map((entry) => entry.id));
			const missingIds = closure.nodeIds.filter((id) => !foundIds.has(id));
			throw new AuditPackGenerationError(
				`Closure contains missing lineage nodes: ${missingIds.join(", ")}`,
				"lineage_broken",
			);
		}

		return {
			...typedCollected,
			closure,
			lineageEntries,
		} satisfies AuditPackExpandedResult;
	},
	async assemble(expanded) {
		const typedExpanded = expanded as AuditPackExpandedResult;
		const organizationId = typedExpanded.request.organizationId;

		const entryEvidence = buildEntryChainEvidence(
			typedExpanded.lineageEntries.map((entry) => ({
				id: entry.id,
				organizationId: entry.organizationId,
				occurredAt: toIso(entry.timestamp),
				previousEntryId: entry.previousEntryId,
				replacesEntryId: entry.replacesEntryId,
				supersededById: entry.supersededById,
			})),
			organizationId,
		);

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
						: approval.approvedAt ?? approval.updatedAt ?? approval.createdAt;

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

		const sortedLineageEntries = [...typedExpanded.lineageEntries].sort((a, b) =>
			a.timestamp.getTime() === b.timestamp.getTime()
				? a.id.localeCompare(b.id)
				: a.timestamp.getTime() - b.timestamp.getTime(),
		);

		const zipBuffer = await assembleAuditPackZip({
			entries: entryEvidence,
			corrections: correctionNodes,
			approvals: approvalEvidence,
			timeline: timelineEvents,
			scope: {
				organizationId,
				requestedStartDate: toIso(typedExpanded.request.startDate),
				requestedEndDate: toIso(typedExpanded.request.endDate),
				includedEntryCount: entryEvidence.length,
				expandedOutsideRange: typedExpanded.closure.expandedOutsideRange,
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

export const auditPackOrchestrator = new AuditPackOrchestrator(defaultRepository, defaultDependencies);
