/**
 * Audit Export Orchestrator
 * Main application service that coordinates the audit hardening pipeline
 */
import JSZip from "jszip";
import { eq, and } from "drizzle-orm";
import {
	db,
	auditExportPackage,
	auditExportFile,
	auditExportConfig,
	dataExport,
	payrollExportJob,
} from "@/db";
import { createLogger } from "@/lib/logger";
import { getPresignedUrl } from "@/lib/storage/export-s3-client";
import { SignedAuditPackage, AuditManifest } from "../domain/models";
import { manifestBuilder, type IManifestBuilder } from "../domain/manifest-builder";
import { signingService, type ISigningService } from "../domain/signing-service";
import { timestampService, type ITimestampService } from "../domain/timestamp-service";
import { wormStorageAdapter, S3WORMStorageAdapter, type IWORMStorageAdapter } from "../infrastructure/storage/worm-storage-adapter";
import { hashProvider, type IHashProvider } from "../infrastructure/crypto/hash-provider";

const logger = createLogger("AuditExportOrchestrator");

// ============================================
// TYPES
// ============================================

export interface HardenExportParams {
	exportId: string;
	organizationId: string;
	requestedById: string;
	exportType: "data" | "payroll" | "audit_pack";
	zipBuffer: Buffer;
}

export interface HardenExportResult {
	auditPackageId: string;
	signedPackage: SignedAuditPackage;
	s3Key: string;
	downloadUrl: string;
}

// ============================================
// ORCHESTRATOR
// ============================================

export class AuditExportOrchestrator {
	constructor(
		private readonly manifest: IManifestBuilder = manifestBuilder,
		private readonly signing: ISigningService = signingService,
		private readonly timestamp: ITimestampService = timestampService,
		private readonly storage: IWORMStorageAdapter = wormStorageAdapter,
		private readonly hash: IHashProvider = hashProvider,
	) {}

	/**
	 * Harden an existing export with cryptographic proofs
	 *
	 * Pipeline:
	 * 1. Build manifest with per-file hashes and Merkle root
	 * 2. Sign manifest with Ed25519
	 * 3. Request RFC 3161 timestamp
	 * 4. Assemble audit package (original ZIP + proofs)
	 * 5. Upload to S3 with WORM retention
	 * 6. Store metadata in database
	 */
	async hardenExport(params: HardenExportParams): Promise<HardenExportResult> {
		const { exportId, organizationId, requestedById, exportType, zipBuffer } = params;

		logger.info(
			{ exportId, organizationId, exportType, size: zipBuffer.length },
			"Starting audit hardening pipeline",
		);

		// Get organization's audit config
		const config = await this.getOrCreateConfig(organizationId, requestedById);

		// Create audit package record (status: pending)
		const [packageRecord] = await db
			.insert(auditExportPackage)
			.values({
				organizationId,
				requestedById,
				exportType,
				dataExportId: exportType === "data" ? exportId : undefined,
				payrollExportJobId: exportType === "payroll" ? exportId : undefined,
				status: "pending",
				retentionYears: config.retentionYears,
			})
			.returning();

		const packageId = packageRecord.id;

		try {
			// Step 1: Build manifest
			await this.updateStatus(packageId, "building_manifest");
			const { manifest, manifestHash } = await this.manifest.buildManifest(
				exportId,
				organizationId,
				exportType,
				zipBuffer,
			);

			// Step 2: Sign manifest
			await this.updateStatus(packageId, "signing");
			const { signature, signingKeyId, signedAt } = await this.signing.signManifest(
				organizationId,
				manifest,
				manifestHash,
			);

			// Step 3: Request timestamp
			await this.updateStatus(packageId, "timestamping");
			const timestamp = await this.timestamp.timestampManifest(manifestHash);

			// Step 4: Assemble audit package
			const signedPackage = new SignedAuditPackage(
				manifest,
				signature,
				timestamp,
				config.retentionYears,
			);
			const auditZipBuffer = await this.assembleAuditPackage(zipBuffer, signedPackage);

			// Step 5: Upload to S3 with WORM
			await this.updateStatus(packageId, "uploading");
			const s3Key = S3WORMStorageAdapter.generateAuditExportKey(organizationId, packageId);

			const { objectLockEnabled, retentionUntil, lockMode } = await this.storage.uploadWithRetention(
				organizationId,
				s3Key,
				auditZipBuffer,
				config.retentionYears,
				"application/zip",
				{
					"export-id": exportId,
					"package-id": packageId,
					"export-type": exportType,
				},
			);

			// Step 6: Store metadata in database
			await this.storePackageMetadata(packageId, {
				manifest,
				manifestHash,
				signature,
				signingKeyId,
				signedAt,
				timestamp,
				s3Key,
				fileSizeBytes: auditZipBuffer.length,
				objectLockEnabled,
				retentionUntil,
				lockMode,
			});

			// Store individual file hashes
			await this.storeFileHashes(packageId, manifest);

			// Generate download URL
			const downloadUrl = await getPresignedUrl(organizationId, s3Key, 86400); // 24 hours

			logger.info(
				{
					packageId,
					exportId,
					s3Key,
					merkleRoot: manifest.merkleRoot.toString().substring(0, 16),
					objectLockEnabled,
				},
				"Audit hardening completed successfully",
			);

			return {
				auditPackageId: packageId,
				signedPackage,
				s3Key,
				downloadUrl,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error({ packageId, exportId, error: errorMessage }, "Audit hardening failed");

			await db
				.update(auditExportPackage)
				.set({
					status: "failed",
					errorMessage,
					completedAt: new Date(),
				})
				.where(eq(auditExportPackage.id, packageId));

			throw error;
		}
	}

	/**
	 * Assemble the final audit package ZIP
	 */
	private async assembleAuditPackage(
		originalZip: Buffer,
		signedPackage: SignedAuditPackage,
	): Promise<Buffer> {
		const zip = new JSZip();

		// Add original export as nested ZIP
		zip.file("export.zip", originalZip);

		// Add audit directory with cryptographic proofs
		const auditFolder = zip.folder("audit");
		if (!auditFolder) {
			throw new Error("Failed to create audit folder");
		}

		// Manifest (human-readable)
		auditFolder.file("manifest.json", signedPackage.manifest.toPrettyJSON());

		// Signature
		auditFolder.file(
			"signature.json",
			JSON.stringify(
				{
					algorithm: "Ed25519",
					signature: signedPackage.signature.getSignature(),
					publicKey: signedPackage.signature.getPublicKey(),
					signedAt: new Date().toISOString(),
				},
				null,
				2,
			),
		);

		// Timestamp token (binary, base64-encoded in JSON wrapper)
		auditFolder.file(
			"timestamp.json",
			JSON.stringify(
				{
					token: signedPackage.timestamp.getToken(),
					timestamp: signedPackage.timestamp.getTimestamp().toISOString(),
					authority: signedPackage.timestamp.getAuthority(),
				},
				null,
				2,
			),
		);

		// Timestamp token raw (for external verification tools)
		auditFolder.file("timestamp.tsr", Buffer.from(signedPackage.timestamp.getToken(), "base64"));

		// Verification instructions
		auditFolder.file("README.txt", this.buildVerificationInstructions());

		// Generate ZIP with maximum compression
		return zip.generateAsync({
			type: "nodebuffer",
			compression: "DEFLATE",
			compressionOptions: { level: 9 },
		});
	}

	/**
	 * Build verification instructions for README
	 */
	private buildVerificationInstructions(): string {
		return `
AUDIT EXPORT VERIFICATION INSTRUCTIONS
========================================

This audit export package contains cryptographic proofs for GoBD compliance:

1. Per-file SHA-256 hashes in manifest.json
2. Merkle tree root hash for integrity verification
3. Ed25519 digital signature of the manifest
4. RFC 3161 trusted timestamp from FreeTSA.org
5. Optional S3 Object Lock WORM retention

CONTENTS:
- export.zip: Original export data
- manifest.json: File inventory with hashes and Merkle root
- signature.json: Ed25519 signature of manifest
- timestamp.json: RFC 3161 timestamp metadata
- timestamp.tsr: Raw timestamp token (DER format)

TO VERIFY:

1. Extract export.zip and recalculate SHA-256 for each file
2. Compare hashes with those in manifest.json
3. Rebuild Merkle tree and compare root hash
4. Verify Ed25519 signature using public key
5. Verify timestamp.tsr against FreeTSA.org certificate

AUTOMATED VERIFICATION:
Use the Z8 webapp verification UI or API endpoint:
  POST /api/audit-export/verify

For questions, contact your system administrator.
`.trim();
	}

	/**
	 * Update package status in database
	 */
	private async updateStatus(
		packageId: string,
		status: "pending" | "building_manifest" | "signing" | "timestamping" | "uploading" | "completed" | "failed",
	): Promise<void> {
		const updates: Record<string, unknown> = { status };

		if (status === "building_manifest") {
			updates.processingStartedAt = new Date();
		}

		await db.update(auditExportPackage).set(updates).where(eq(auditExportPackage.id, packageId));
	}

	/**
	 * Store package metadata after successful hardening
	 */
	private async storePackageMetadata(
		packageId: string,
		data: {
			manifest: AuditManifest;
			manifestHash: { toString(): string };
			signature: { getSignature(): string };
			signingKeyId: string;
			signedAt: Date;
			timestamp: { getToken(): string; getTimestamp(): Date; getAuthority(): string };
			s3Key: string;
			fileSizeBytes: number;
			objectLockEnabled: boolean;
			retentionUntil: Date;
			lockMode: "GOVERNANCE" | "COMPLIANCE" | null;
		},
	): Promise<void> {
		await db
			.update(auditExportPackage)
			.set({
				status: "completed",
				s3Key: data.s3Key,
				fileSizeBytes: data.fileSizeBytes,
				merkleRoot: data.manifest.merkleRoot.toString(),
				manifestHash: data.manifestHash.toString(),
				fileCount: data.manifest.getFileCount(),
				signatureValue: data.signature.getSignature(),
				signingKeyId: data.signingKeyId,
				signedAt: data.signedAt,
				timestampToken: data.timestamp.getToken(),
				timestampedAt: data.timestamp.getTimestamp(),
				timestampAuthority: data.timestamp.getAuthority(),
				objectLockEnabled: data.objectLockEnabled,
				objectLockMode: data.lockMode?.toLowerCase() as "governance" | "compliance" | undefined,
				retentionUntil: data.retentionUntil,
				completedAt: new Date(),
			})
			.where(eq(auditExportPackage.id, packageId));
	}

	/**
	 * Store individual file hashes for granular verification
	 */
	private async storeFileHashes(packageId: string, manifest: AuditManifest): Promise<void> {
		const fileRecords = manifest.files.map((file) => ({
			packageId,
			filePath: file.path,
			sha256Hash: file.hash.toString(),
			sizeBytes: file.sizeBytes,
			merkleIndex: file.merkleIndex,
		}));

		if (fileRecords.length > 0) {
			await db.insert(auditExportFile).values(fileRecords);
		}
	}

	/**
	 * Get or create audit export config for organization
	 */
	private async getOrCreateConfig(
		organizationId: string,
		createdBy: string,
	): Promise<{
		retentionYears: number;
		retentionMode: "governance" | "compliance";
	}> {
		let config = await db.query.auditExportConfig.findFirst({
			where: eq(auditExportConfig.organizationId, organizationId),
		});

		if (!config) {
			// Create default config
			[config] = await db
				.insert(auditExportConfig)
				.values({
					organizationId,
					retentionYears: 10, // GoBD default
					retentionMode: "governance",
					autoEnableDataExports: false,
					autoEnablePayrollExports: false,
					isEnabled: true,
					createdBy,
				})
				.returning();

			logger.info({ organizationId }, "Created default audit export config");
		}

		return {
			retentionYears: config.retentionYears,
			retentionMode: config.retentionMode as "governance" | "compliance",
		};
	}
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const auditExportOrchestrator = new AuditExportOrchestrator();
