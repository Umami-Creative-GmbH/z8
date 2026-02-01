/**
 * WORM Storage Adapter for S3 Object Lock
 * Infrastructure layer for immutable storage
 */
import {
	S3Client,
	PutObjectCommand,
	GetObjectLockConfigurationCommand,
	PutObjectRetentionCommand,
	GetObjectRetentionCommand,
	HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { db, exportStorageConfig, auditExportConfig } from "@/db";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";

const logger = createLogger("WORMStorageAdapter");

// ============================================
// INTERFACE
// ============================================

export interface IWORMStorageAdapter {
	/**
	 * Check if S3 bucket has Object Lock enabled
	 */
	checkObjectLockSupport(organizationId: string): Promise<boolean>;

	/**
	 * Upload object with retention settings
	 */
	uploadWithRetention(
		organizationId: string,
		key: string,
		data: Buffer,
		retentionYears: number,
		contentType?: string,
		metadata?: Record<string, string>,
	): Promise<{
		objectLockEnabled: boolean;
		retentionUntil: Date;
		lockMode: "GOVERNANCE" | "COMPLIANCE" | null;
	}>;

	/**
	 * Verify object retention status
	 */
	verifyObjectLock(
		organizationId: string,
		key: string,
	): Promise<{
		locked: boolean;
		retainUntil: Date | null;
		mode: "GOVERNANCE" | "COMPLIANCE" | null;
	}>;

	/**
	 * Get object metadata
	 */
	getObjectMetadata(
		organizationId: string,
		key: string,
	): Promise<{
		exists: boolean;
		size?: number;
		lastModified?: Date;
		metadata?: Record<string, string>;
	}>;
}

// ============================================
// S3 CONFIG HELPER
// ============================================

interface S3Config {
	bucket: string;
	region: string;
	endpoint?: string;
	accessKeyId: string;
	secretAccessKey: string;
}

async function getS3Config(organizationId: string): Promise<S3Config | null> {
	const config = await db.query.exportStorageConfig.findFirst({
		where: eq(exportStorageConfig.organizationId, organizationId),
	});

	if (!config) {
		return null;
	}

	const [accessKeyId, secretAccessKey] = await Promise.all([
		getOrgSecret(organizationId, "storage/access_key_id"),
		getOrgSecret(organizationId, "storage/secret_access_key"),
	]);

	if (!accessKeyId || !secretAccessKey) {
		return null;
	}

	return {
		bucket: config.bucket,
		region: config.region,
		endpoint: config.endpoint ?? undefined,
		accessKeyId,
		secretAccessKey,
	};
}

function createS3Client(config: S3Config): S3Client {
	return new S3Client({
		endpoint: config.endpoint || undefined,
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
		forcePathStyle: !!config.endpoint, // Required for MinIO
	});
}

// ============================================
// IMPLEMENTATION
// ============================================

export class S3WORMStorageAdapter implements IWORMStorageAdapter {
	/**
	 * Check if bucket has Object Lock enabled
	 * Caches result in auditExportConfig
	 */
	async checkObjectLockSupport(organizationId: string): Promise<boolean> {
		const config = await getS3Config(organizationId);
		if (!config) {
			logger.warn({ organizationId }, "S3 not configured");
			return false;
		}

		try {
			const client = createS3Client(config);

			const command = new GetObjectLockConfigurationCommand({
				Bucket: config.bucket,
			});

			const response = await client.send(command);
			const supported = response.ObjectLockConfiguration?.ObjectLockEnabled === "Enabled";

			// Update cached result in database
			await db
				.update(auditExportConfig)
				.set({
					objectLockSupported: supported,
					objectLockCheckedAt: new Date(),
				})
				.where(eq(auditExportConfig.organizationId, organizationId));

			logger.info({ organizationId, supported }, "Object Lock support checked");

			return supported;
		} catch (error) {
			// ObjectLockConfigurationNotFoundError means bucket doesn't have Object Lock
			const message = error instanceof Error ? error.message : String(error);

			if (message.includes("ObjectLockConfigurationNotFound") || message.includes("ObjectLockConfiguration")) {
				logger.info({ organizationId }, "Object Lock not enabled on bucket");
				return false;
			}

			logger.error({ organizationId, error: message }, "Error checking Object Lock support");
			return false;
		}
	}

	/**
	 * Upload object with WORM retention
	 */
	async uploadWithRetention(
		organizationId: string,
		key: string,
		data: Buffer,
		retentionYears: number,
		contentType = "application/zip",
		metadata: Record<string, string> = {},
	): Promise<{
		objectLockEnabled: boolean;
		retentionUntil: Date;
		lockMode: "GOVERNANCE" | "COMPLIANCE" | null;
	}> {
		const config = await getS3Config(organizationId);
		if (!config) {
			throw new Error("S3 storage not configured for this organization");
		}

		const client = createS3Client(config);

		// Calculate retention date
		const retentionUntil = new Date();
		retentionUntil.setFullYear(retentionUntil.getFullYear() + retentionYears);

		// Get configured retention mode (default to GOVERNANCE)
		const auditConfig = await db.query.auditExportConfig.findFirst({
			where: eq(auditExportConfig.organizationId, organizationId),
		});
		const lockMode: "GOVERNANCE" | "COMPLIANCE" = auditConfig?.retentionMode === "compliance" ? "COMPLIANCE" : "GOVERNANCE";

		// Check if Object Lock is supported
		const objectLockSupported = await this.checkObjectLockSupport(organizationId);

		// Add audit metadata
		const fullMetadata = {
			...metadata,
			"audit-export": "true",
			"retention-until": retentionUntil.toISOString(),
			"retention-years": retentionYears.toString(),
		};

		logger.info(
			{
				organizationId,
				key,
				size: data.length,
				retentionYears,
				objectLockSupported,
				lockMode,
			},
			"Uploading audit package with retention",
		);

		// Upload object
		const putCommand = new PutObjectCommand({
			Bucket: config.bucket,
			Key: key,
			Body: data,
			ContentType: contentType,
			Metadata: fullMetadata,
		});

		await client.send(putCommand);

		// Apply Object Lock if supported
		if (objectLockSupported) {
			try {
				const retentionCommand = new PutObjectRetentionCommand({
					Bucket: config.bucket,
					Key: key,
					Retention: {
						Mode: lockMode,
						RetainUntilDate: retentionUntil,
					},
				});

				await client.send(retentionCommand);

				logger.info(
					{ organizationId, key, lockMode, retentionUntil: retentionUntil.toISOString() },
					"Applied Object Lock retention",
				);

				return {
					objectLockEnabled: true,
					retentionUntil,
					lockMode,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error({ organizationId, key, error: message }, "Failed to apply Object Lock");
				// Continue without lock - object was still uploaded
			}
		}

		return {
			objectLockEnabled: false,
			retentionUntil,
			lockMode: null,
		};
	}

	/**
	 * Verify object retention status
	 */
	async verifyObjectLock(
		organizationId: string,
		key: string,
	): Promise<{
		locked: boolean;
		retainUntil: Date | null;
		mode: "GOVERNANCE" | "COMPLIANCE" | null;
	}> {
		const config = await getS3Config(organizationId);
		if (!config) {
			return { locked: false, retainUntil: null, mode: null };
		}

		const client = createS3Client(config);

		try {
			const command = new GetObjectRetentionCommand({
				Bucket: config.bucket,
				Key: key,
			});

			const response = await client.send(command);

			const mode = response.Retention?.Mode as "GOVERNANCE" | "COMPLIANCE" | undefined;
			const retainUntil = response.Retention?.RetainUntilDate;

			return {
				locked: mode !== undefined && retainUntil !== undefined,
				retainUntil: retainUntil ?? null,
				mode: mode ?? null,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			// NoSuchObjectLockConfiguration or ObjectLockConfigurationNotFoundError
			if (message.includes("NoSuchObjectLockConfiguration") || message.includes("not found")) {
				return { locked: false, retainUntil: null, mode: null };
			}

			logger.error({ organizationId, key, error: message }, "Error checking object retention");
			return { locked: false, retainUntil: null, mode: null };
		}
	}

	/**
	 * Get object metadata
	 */
	async getObjectMetadata(
		organizationId: string,
		key: string,
	): Promise<{
		exists: boolean;
		size?: number;
		lastModified?: Date;
		metadata?: Record<string, string>;
	}> {
		const config = await getS3Config(organizationId);
		if (!config) {
			return { exists: false };
		}

		const client = createS3Client(config);

		try {
			const command = new HeadObjectCommand({
				Bucket: config.bucket,
				Key: key,
			});

			const response = await client.send(command);

			return {
				exists: true,
				size: response.ContentLength,
				lastModified: response.LastModified,
				metadata: response.Metadata,
			};
		} catch {
			return { exists: false };
		}
	}

	/**
	 * Generate S3 key for audit export
	 */
	static generateAuditExportKey(organizationId: string, exportId: string, timestamp?: Date): string {
		const ts = timestamp ?? new Date();
		const dateStr = ts.toISOString().split("T")[0]; // YYYY-MM-DD
		return `audit-exports/${organizationId}/${dateStr}/${exportId}.zip`;
	}
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const wormStorageAdapter = new S3WORMStorageAdapter();
