import { and, desc, eq } from "drizzle-orm";
import { auditPackArtifact, auditPackRequest, db } from "@/db";

export type AuditPackRequestStatus = (typeof auditPackRequest.$inferSelect)["status"];

export interface CreateAuditPackRequestInput {
	organizationId: string;
	requestedById: string;
	startDate: Date;
	endDate: Date;
}

export interface ListAuditPackRequestsInput {
	organizationId: string;
	limit: number;
}

export interface GetAuditPackRequestInput {
	requestId: string;
	organizationId: string;
}

export interface SetAuditPackStatusInput {
	requestId: string;
	organizationId: string;
	status: Exclude<AuditPackRequestStatus, "failed" | "requested">;
}

export interface FailAuditPackRequestInput {
	requestId: string;
	organizationId: string;
	errorCode: string;
	errorMessage: string;
}

export interface StoreAuditPackArtifactInput {
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

class AuditPackRepositoryError extends Error {
	constructor(
		message: string,
		public readonly errorCode: string,
	) {
		super(message);
	}
}

export const auditPackRequestRepository = {
	async createRequest(input: CreateAuditPackRequestInput) {
		const [request] = await db
			.insert(auditPackRequest)
			.values({
				organizationId: input.organizationId,
				requestedById: input.requestedById,
				startDate: input.startDate,
				endDate: input.endDate,
			})
			.returning();

		return request;
	},

	async listRequests(input: ListAuditPackRequestsInput) {
		const requests = await db.query.auditPackRequest.findMany({
			where: eq(auditPackRequest.organizationId, input.organizationId),
			orderBy: [desc(auditPackRequest.createdAt)],
			limit: input.limit,
			with: {
				artifact: true,
			},
		});

		return requests;
	},

	async getRequest(input: GetAuditPackRequestInput) {
		return db.query.auditPackRequest.findFirst({
			where: and(
				eq(auditPackRequest.id, input.requestId),
				eq(auditPackRequest.organizationId, input.organizationId),
			),
			with: {
				artifact: true,
			},
		});
	},

	async setStatus(input: SetAuditPackStatusInput): Promise<void> {
		const updates: Partial<typeof auditPackRequest.$inferInsert> = {
			status: input.status,
			errorCode: null,
			errorMessage: null,
		};

		if (input.status === "completed") {
			updates.completedAt = new Date();
		}

		const updated = await db
			.update(auditPackRequest)
			.set(updates)
			.where(
				and(
					eq(auditPackRequest.id, input.requestId),
					eq(auditPackRequest.organizationId, input.organizationId),
				),
			)
			.returning({ id: auditPackRequest.id });

		if (updated.length === 0) {
			throw new AuditPackRepositoryError("Audit pack request not found", "request_not_found");
		}
	},

	async failRequest(input: FailAuditPackRequestInput): Promise<void> {
		const updated = await db
			.update(auditPackRequest)
			.set({
				status: "failed",
				errorCode: input.errorCode,
				errorMessage: input.errorMessage,
				completedAt: new Date(),
			})
			.where(
				and(
					eq(auditPackRequest.id, input.requestId),
					eq(auditPackRequest.organizationId, input.organizationId),
				),
			)
			.returning({ id: auditPackRequest.id });

		if (updated.length === 0) {
			throw new AuditPackRepositoryError("Audit pack request not found", "request_not_found");
		}
	},

	async storeArtifact(input: StoreAuditPackArtifactInput): Promise<void> {
		const request = await db.query.auditPackRequest.findFirst({
			where: and(
				eq(auditPackRequest.id, input.requestId),
				eq(auditPackRequest.organizationId, input.organizationId),
			),
			columns: { id: true },
		});

		if (!request) {
			throw new AuditPackRepositoryError("Audit pack request not found", "request_not_found");
		}

		await db
			.insert(auditPackArtifact)
			.values({
				requestId: input.requestId,
				auditExportPackageId: input.auditExportPackageId,
				s3Key: input.s3Key,
				entryCount: input.entryCount,
				correctionNodeCount: input.correctionNodeCount,
				approvalEventCount: input.approvalEventCount,
				timelineEventCount: input.timelineEventCount,
				expandedNodeCount: input.expandedNodeCount,
			})
			.onConflictDoUpdate({
				target: auditPackArtifact.requestId,
				set: {
					auditExportPackageId: input.auditExportPackageId,
					s3Key: input.s3Key,
					entryCount: input.entryCount,
					correctionNodeCount: input.correctionNodeCount,
					approvalEventCount: input.approvalEventCount,
					timelineEventCount: input.timelineEventCount,
					expandedNodeCount: input.expandedNodeCount,
				},
			});
	},
};

export type AuditPackRequestRepository = typeof auditPackRequestRepository;
