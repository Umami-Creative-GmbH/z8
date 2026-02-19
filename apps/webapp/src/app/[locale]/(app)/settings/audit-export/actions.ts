"use server";

import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { db, auditExportPackage, auditExportConfig } from "@/db";
import { isOrgAdminCasl } from "@/lib/auth-helpers";
import { addAuditPackJob } from "@/lib/audit-pack/application/audit-pack-service";
import { auditPackRequestRepository } from "@/lib/audit-pack/application/request-repository";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { getPresignedUrl } from "@/lib/storage/export-s3-client";
import {
	configurationService,
	verificationService,
	type AuditExportConfigData,
	type VerificationResult,
} from "@/lib/audit-export";

// Using isOrgAdminCasl from auth-helpers for CASL-based authorization

// ============================================
// CONFIGURATION ACTIONS
// ============================================

/**
 * Get audit export configuration for an organization
 */
export async function getAuditConfigAction(
	organizationId: string,
): Promise<ServerActionResult<AuditExportConfigData | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_export_config",
						action: "read",
					}),
				),
			);
		}

		const config = yield* _(Effect.promise(() => configurationService.getConfig(organizationId)));

		return config;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Initialize audit export for an organization
 * Creates default config and generates signing key
 */
export async function initializeAuditExportAction(
	organizationId: string,
): Promise<
	ServerActionResult<{
		config: AuditExportConfigData;
		signingKeyFingerprint: string;
	}>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_export_config",
						action: "create",
					}),
				),
			);
		}

		const result = yield* _(
			Effect.promise(() => configurationService.initialize(organizationId, session.user.id)),
		);

		return result;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export interface UpdateAuditConfigInput {
	organizationId: string;
	retentionYears?: number;
	retentionMode?: "governance" | "compliance";
	autoEnableDataExports?: boolean;
	autoEnablePayrollExports?: boolean;
}

/**
 * Update audit export configuration
 */
export async function updateAuditConfigAction(
	input: UpdateAuditConfigInput,
): Promise<ServerActionResult<AuditExportConfigData>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_export_config",
						action: "update",
					}),
				),
			);
		}

		const config = yield* _(
			Effect.promise(() =>
				configurationService.updateConfig({
					organizationId: input.organizationId,
					updatedBy: session.user.id,
					retentionYears: input.retentionYears,
					retentionMode: input.retentionMode,
					autoEnableDataExports: input.autoEnableDataExports,
					autoEnablePayrollExports: input.autoEnablePayrollExports,
				}),
			),
		);

		return config;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// KEY MANAGEMENT ACTIONS
// ============================================

/**
 * Rotate the signing key for an organization
 */
export async function rotateSigningKeyAction(
	organizationId: string,
): Promise<ServerActionResult<{ fingerprint: string; version: number }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_signing_key",
						action: "rotate",
					}),
				),
			);
		}

		const result = yield* _(
			Effect.promise(() => configurationService.rotateSigningKey(organizationId)),
		);

		return result;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get signing key history for an organization
 */
export async function getSigningKeyHistoryAction(
	organizationId: string,
): Promise<
	ServerActionResult<
		Array<{
			keyId: string;
			fingerprint: string;
			version: number;
			isActive: boolean;
			createdAt: Date;
		}>
	>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_signing_key",
						action: "read",
					}),
				),
			);
		}

		const history = yield* _(
			Effect.promise(() => configurationService.getSigningKeyHistory(organizationId)),
		);

		return history;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Export public key for external verification
 */
export async function exportPublicKeyAction(
	organizationId: string,
): Promise<
	ServerActionResult<{
		publicKeyPem: string;
		fingerprint: string;
		algorithm: string;
		version: number;
	} | null>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_signing_key",
						action: "export",
					}),
				),
			);
		}

		const publicKey = yield* _(
			Effect.promise(() => configurationService.exportPublicKey(organizationId)),
		);

		return publicKey;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

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

/**
 * Get audit packages for an organization
 */
export async function getAuditPackagesAction(
	organizationId: string,
	limit = 50,
): Promise<ServerActionResult<AuditPackageInfo[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_export_package",
						action: "read",
					}),
				),
			);
		}

		const packages = yield* _(
			Effect.promise(async () => {
				const results = await db.query.auditExportPackage.findMany({
					where: eq(auditExportPackage.organizationId, organizationId),
					orderBy: [desc(auditExportPackage.createdAt)],
					limit,
				});

				return results.map((pkg) => ({
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
				}));
			}),
		);

		return packages;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export interface CreateAuditPackInput {
	organizationId: string;
	startDateIso: string;
	endDateIso: string;
}

export interface CreateAuditPackResult {
	requestId: string;
	jobId: string;
}

export interface AuditPackRequestInfo {
	id: string;
	status: "requested" | "collecting" | "lineage_expanding" | "assembling" | "hardening" | "completed" | "failed";
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
		createdAt: Date;
	} | null;
}

export async function createAuditPackAction(
	input: CreateAuditPackInput,
): Promise<ServerActionResult<CreateAuditPackResult>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_pack_request",
						action: "create",
					}),
				),
			);
		}

		const startDate = DateTime.fromISO(input.startDateIso, { zone: "utc" }).startOf("day");
		const endDate = DateTime.fromISO(input.endDateIso, { zone: "utc" }).endOf("day");

		if (!startDate.isValid || !endDate.isValid || startDate > endDate) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Invalid audit pack date range",
					}),
				),
			);
		}

		const request = yield* _(
			Effect.promise(() =>
				auditPackRequestRepository.createRequest({
					organizationId: input.organizationId,
					requestedById: session.user.id,
					startDate: startDate.toJSDate(),
					endDate: endDate.toJSDate(),
				}),
			),
		);

		const job = yield* _(
			Effect.promise(() =>
				addAuditPackJob({
					requestId: request.id,
					organizationId: input.organizationId,
				}),
			),
		);

		const jobId = typeof job.id === "string" ? job.id : String(job.id ?? "");
		if (!jobId) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Audit pack job could not be queued",
						entityType: "audit_pack_job",
						entityId: request.id,
					}),
				),
			);
		}

		yield* _(
			Effect.promise(() =>
				logAudit({
					action: AuditAction.AUDIT_PACK_CREATED,
					actorId: session.user.id,
					actorEmail: session.user.email,
					targetId: request.id,
					targetType: "audit_pack_request",
					organizationId: input.organizationId,
					metadata: {
						startDateIso: startDate.toISODate(),
						endDateIso: endDate.toISODate(),
						jobId,
					},
					timestamp: new Date(),
				}),
			),
		);

		return {
			requestId: request.id,
			jobId,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function getAuditPackRequestsAction(
	organizationId: string,
	limit = 20,
): Promise<ServerActionResult<AuditPackRequestInfo[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_pack_request",
						action: "read",
					}),
				),
			);
		}

		const sanitizedLimit = Math.max(1, Math.min(limit, 100));
		const requests = yield* _(
			Effect.promise(() =>
				auditPackRequestRepository.listRequests({
					organizationId,
					limit: sanitizedLimit,
				}),
			),
		);

		return requests.map((request) => ({
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
						createdAt: request.artifact.createdAt,
					}
				: null,
		}));
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function getAuditPackDownloadUrlAction(
	requestId: string,
	organizationId: string,
): Promise<ServerActionResult<{ url: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_pack_request",
						action: "download",
					}),
				),
			);
		}

		const request = yield* _(
			Effect.promise(() =>
				auditPackRequestRepository.getRequest({
					requestId,
					organizationId,
				}),
			),
		);

		const artifact = request?.artifact;
		if (!request || request.status !== "completed" || !artifact?.s3Key) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Completed audit pack artifact not found",
						entityType: "audit_pack_artifact",
						entityId: requestId,
					}),
				),
			);
		}

		const url = yield* _(
			Effect.promise(() => getPresignedUrl(organizationId, artifact!.s3Key!, 86400)),
		);

		yield* _(
			Effect.promise(() =>
				logAudit({
					action: AuditAction.AUDIT_PACK_DOWNLOADED,
					actorId: session.user.id,
					actorEmail: session.user.email,
					targetId: requestId,
					targetType: "audit_pack_request",
					organizationId,
					metadata: {
						auditExportPackageId: artifact!.auditExportPackageId,
						s3Key: artifact!.s3Key,
					},
					timestamp: new Date(),
				}),
			),
		);

		return { url };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// VERIFICATION ACTIONS
// ============================================

/**
 * Verify an audit package
 */
export async function verifyAuditPackageAction(
	packageId: string,
	organizationId: string,
): Promise<ServerActionResult<VerificationResult>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_export_package",
						action: "verify",
					}),
				),
			);
		}

		const result = yield* _(
			Effect.promise(() =>
				verificationService.verifyPackage({
					packageId,
					organizationId,
					verifiedById: session.user.id,
					verificationSource: "ui",
				}),
			),
		);

		return result;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export interface VerificationHistoryEntry {
	id: string;
	isValid: boolean;
	verifiedAt: Date;
	verificationSource: string;
	checksPerformed: string[];
	checksFailed: string[];
}

/**
 * Get verification history for a package
 */
export async function getVerificationHistoryAction(
	packageId: string,
	organizationId: string,
): Promise<ServerActionResult<VerificationHistoryEntry[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "audit_verification_log",
						action: "read",
					}),
				),
			);
		}

		const history = yield* _(
			Effect.promise(() => verificationService.getVerificationHistory(packageId, organizationId)),
		);

		return history;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
