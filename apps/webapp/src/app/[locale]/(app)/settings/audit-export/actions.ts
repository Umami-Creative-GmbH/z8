"use server";

import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { auditExportPackage } from "@/db";
import type { AuditPackAppendAssurance } from "@/db/schema/audit-pack";
import { configurationService, verificationService } from "@/lib/audit-export";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { addAuditPackJob } from "@/lib/audit-pack/application/audit-pack-service";
import { auditPackRequestRepository } from "@/lib/audit-pack/application/request-repository";
import {
	comparePlainDates,
	dateFromInstant,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { getPresignedUrl } from "@/lib/storage/export-s3-client";

const idSchema = (label: string) => z.string().min(1, `${label} is required`);

/** The signed-in user's email, for the audit log. */
const actorEmail = Effect.gen(function* () {
	const authService = yield* AuthService;
	const session = yield* authService.getSession();
	return session.user.email;
});

// ============================================
// CONFIGURATION ACTIONS
// ============================================

/** The active organization's audit export configuration. */
export const getAuditConfigAction = organizationAction(
	{ name: "auditExport.getConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) => Effect.promise(() => configurationService.getConfig(organizationId)),
);

/** Creates the default audit export config and a signing key. */
export const initializeAuditExportAction = organizationAction(
	{ name: "auditExport.initialize", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.promise(() => configurationService.initialize(organizationId, actor.userId)),
);

const updateAuditConfigSchema = z.strictObject({
	retentionYears: z.number().int().positive().optional(),
	retentionMode: z.enum(["governance", "compliance"]).optional(),
	autoEnableDataExports: z.boolean().optional(),
	autoEnablePayrollExports: z.boolean().optional(),
});

export type UpdateAuditConfigInput = z.input<typeof updateAuditConfigSchema>;

export const updateAuditConfigAction = organizationAction(
	{ name: "auditExport.updateConfig", requires: "orgAdmin", schema: updateAuditConfigSchema },
	({ actor, organizationId, input }) =>
		Effect.promise(() =>
			configurationService.updateConfig({
				organizationId,
				updatedBy: actor.userId,
				retentionYears: input.retentionYears,
				retentionMode: input.retentionMode,
				autoEnableDataExports: input.autoEnableDataExports,
				autoEnablePayrollExports: input.autoEnablePayrollExports,
			}),
		),
);

// ============================================
// KEY MANAGEMENT ACTIONS
// ============================================

export const rotateSigningKeyAction = organizationAction(
	{ name: "auditExport.rotateSigningKey", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.promise(() => configurationService.rotateSigningKey(organizationId)),
);

export const getSigningKeyHistoryAction = organizationAction(
	{ name: "auditExport.getSigningKeyHistory", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.promise(() => configurationService.getSigningKeyHistory(organizationId)),
);

/** The public key, for external verification. */
export const exportPublicKeyAction = organizationAction(
	{ name: "auditExport.exportPublicKey", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.promise(() => configurationService.exportPublicKey(organizationId)),
);

// ============================================
// AUDIT PACKAGE ACTIONS
// ============================================

export interface AuditPackageInfo {
	id: string;
	exportType: "data" | "payroll" | "audit_pack";
	status: string;
	fileCount: number | null;
	fileSizeBytes: number | null;
	merkleRoot: string | null;
	objectLockEnabled: boolean;
	retentionYears: number;
	retentionUntil: Date | null;
	signedAt: Date | null;
	timestampedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
}

export const getAuditPackagesAction = organizationAction(
	{
		name: "auditExport.getPackages",
		requires: "orgAdmin",
		schema: z.strictObject({ limit: z.number().int().positive().max(500).optional() }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const results = yield* dbService.query("auditExport.getPackages", () =>
				dbService.db.query.auditExportPackage.findMany({
					where: eq(auditExportPackage.organizationId, organizationId),
					orderBy: [desc(auditExportPackage.createdAt)],
					limit: input.limit ?? 50,
				}),
			);

			return results.map(
				(pkg): AuditPackageInfo => ({
					id: pkg.id,
					exportType: pkg.exportType as "data" | "payroll" | "audit_pack",
					status: pkg.status,
					fileCount: pkg.fileCount,
					fileSizeBytes: pkg.fileSizeBytes,
					merkleRoot: pkg.merkleRoot,
					objectLockEnabled: pkg.objectLockEnabled ?? false,
					retentionYears: pkg.retentionYears ?? 10,
					retentionUntil: pkg.retentionUntil,
					signedAt: pkg.signedAt,
					timestampedAt: pkg.timestampedAt,
					completedAt: pkg.completedAt,
					createdAt: pkg.createdAt,
				}),
			);
		}),
);

const createAuditPackSchema = z.strictObject({
	startDateIso: idSchema("Start date"),
	endDateIso: idSchema("End date"),
});

export type CreateAuditPackInput = z.input<typeof createAuditPackSchema>;

export interface CreateAuditPackResult {
	requestId: string;
	jobId: string;
}

export interface AuditPackRequestInfo {
	id: string;
	status:
		| "requested"
		| "collecting"
		| "lineage_expanding"
		| "assembling"
		| "hardening"
		| "completed"
		| "failed";
	startDate: Date;
	endDate: Date;
	errorCode: string | null;
	errorMessage: string | null;
	createdAt: Date;
	completedAt: Date | null;
	artifact: {
		id: string;
		auditExportPackageId: string | null;
		s3Key: string | null;
		entryCount: number;
		correctionNodeCount: number;
		approvalEventCount: number;
		timelineEventCount: number;
		expandedNodeCount: number;
		/** Null for packs generated before append assurance was disclosed. */
		appendAssurance: AuditPackAppendAssurance | null;
		createdAt: Date;
	} | null;
}

/** The audit pack's whole UTC days, first to last, or null for an invalid range. */
function auditPackRange(startDateIso: string, endDateIso: string) {
	try {
		const first = parsePlainDate(startDateIso);
		const last = parsePlainDate(endDateIso);
		if (comparePlainDates(first, last) > 0) return null;
		const startOfUtcDay = (day: PlainDate) => day.toZonedDateTime({ timeZone: "UTC" }).toInstant();
		return {
			first,
			last,
			start: dateFromInstant(startOfUtcDay(first)),
			end: dateFromInstant(startOfUtcDay(last.add({ days: 1 })).subtract({ milliseconds: 1 })),
		};
	} catch {
		return null;
	}
}

export const createAuditPackAction = organizationAction(
	{ name: "auditExport.createAuditPack", requires: "orgAdmin", schema: createAuditPackSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const range = auditPackRange(input.startDateIso, input.endDateIso);
			if (!range) {
				return yield* Effect.fail(
					new ValidationError({ message: "Invalid audit pack date range" }),
				);
			}

			const request = yield* Effect.promise(() =>
				auditPackRequestRepository.createRequest({
					organizationId,
					requestedById: actor.userId,
					startDate: range.start,
					endDate: range.end,
				}),
			);

			const job = yield* Effect.promise(() =>
				addAuditPackJob({ requestId: request.id, organizationId }),
			);

			const jobId = typeof job.id === "string" ? job.id : String(job.id ?? "");
			if (!jobId) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Audit pack job could not be queued",
						entityType: "audit_pack_job",
						entityId: request.id,
					}),
				);
			}

			const email = yield* actorEmail;
			yield* Effect.promise(() =>
				logAudit({
					action: AuditAction.AUDIT_PACK_CREATED,
					actorId: actor.userId,
					actorEmail: email,
					targetId: request.id,
					targetType: "audit_pack_request",
					organizationId,
					metadata: {
						startDateIso: range.first.toString(),
						endDateIso: range.last.toString(),
						jobId,
					},
					timestamp: new Date(),
				}),
			);

			return { requestId: request.id, jobId } satisfies CreateAuditPackResult;
		}),
);

export const getAuditPackRequestsAction = organizationAction(
	{
		name: "auditExport.getAuditPackRequests",
		requires: "orgAdmin",
		schema: z.strictObject({ limit: z.number().int().optional() }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const sanitizedLimit = Math.max(1, Math.min(input.limit ?? 20, 100));
			const requests = yield* Effect.promise(() =>
				auditPackRequestRepository.listRequests({ organizationId, limit: sanitizedLimit }),
			);

			return requests.map(
				(request): AuditPackRequestInfo => ({
					id: request.id,
					status: request.status,
					startDate: request.startDate,
					endDate: request.endDate,
					errorCode: request.errorCode,
					errorMessage: request.errorMessage,
					createdAt: request.createdAt,
					completedAt: request.completedAt,
					artifact: request.artifact
						? {
								id: request.artifact.id,
								auditExportPackageId: request.artifact.auditExportPackageId,
								s3Key: request.artifact.s3Key,
								entryCount: request.artifact.entryCount,
								correctionNodeCount: request.artifact.correctionNodeCount,
								approvalEventCount: request.artifact.approvalEventCount,
								timelineEventCount: request.artifact.timelineEventCount,
								expandedNodeCount: request.artifact.expandedNodeCount,
								appendAssurance: request.artifact.appendAssurance,
								createdAt: request.artifact.createdAt,
							}
						: null,
				}),
			);
		}),
);

export const getAuditPackDownloadUrlAction = organizationAction(
	{
		name: "auditExport.getAuditPackDownloadUrl",
		requires: "orgAdmin",
		schema: z.strictObject({ requestId: idSchema("Audit pack request") }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const request = yield* Effect.promise(() =>
				auditPackRequestRepository.getRequest({ requestId: input.requestId, organizationId }),
			);

			const artifact = request?.artifact;
			const s3Key = artifact?.s3Key;
			if (request?.status !== "completed" || !artifact || !s3Key) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Completed audit pack artifact not found",
						entityType: "audit_pack_artifact",
						entityId: input.requestId,
					}),
				);
			}

			const url = yield* Effect.promise(() => getPresignedUrl(organizationId, s3Key));

			const email = yield* actorEmail;
			yield* Effect.promise(() =>
				logAudit({
					action: AuditAction.AUDIT_PACK_DOWNLOADED,
					actorId: actor.userId,
					actorEmail: email,
					targetId: input.requestId,
					targetType: "audit_pack_request",
					organizationId,
					metadata: {
						auditExportPackageId: artifact.auditExportPackageId,
						s3Key,
					},
					timestamp: new Date(),
				}),
			);

			return { url };
		}),
);

// ============================================
// VERIFICATION ACTIONS
// ============================================

const packageInputSchema = z.strictObject({ packageId: idSchema("Audit package") });

export const verifyAuditPackageAction = organizationAction(
	{ name: "auditExport.verifyPackage", requires: "orgAdmin", schema: packageInputSchema },
	({ actor, organizationId, input }) =>
		Effect.promise(() =>
			verificationService.verifyPackage({
				packageId: input.packageId,
				organizationId,
				verifiedById: actor.userId,
				verificationSource: "ui",
			}),
		),
);

export interface VerificationHistoryEntry {
	id: string;
	isValid: boolean;
	verifiedAt: Date;
	verificationSource: string;
	checksPerformed: string[];
	checksFailed: string[];
}

export const getVerificationHistoryAction = organizationAction(
	{ name: "auditExport.getVerificationHistory", requires: "orgAdmin", schema: packageInputSchema },
	({ organizationId, input }) =>
		Effect.promise(
			(): Promise<VerificationHistoryEntry[]> =>
				verificationService.getVerificationHistory(input.packageId, organizationId),
		),
);
