import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListBucketsCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { db, exportStorageConfig } from "@/db";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ExportS3Client");

/**
 * S3 storage configuration interface
 */
export interface S3StorageConfig {
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	endpoint?: string | null;
}

/**
 * Get S3 storage configuration for an organization from the database
 */
export async function getStorageConfig(organizationId: string): Promise<S3StorageConfig | null> {
	const config = await db.query.exportStorageConfig.findFirst({
		where: eq(exportStorageConfig.organizationId, organizationId),
	});

	if (!config) {
		return null;
	}

	return {
		bucket: config.bucket,
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region: config.region,
		endpoint: config.endpoint,
	};
}

/**
 * Check if Export S3 storage is configured for an organization
 */
export async function isExportS3Configured(organizationId?: string): Promise<boolean> {
	if (!organizationId) {
		return false;
	}

	const config = await getStorageConfig(organizationId);
	return !!(config?.bucket && config?.accessKeyId && config?.secretAccessKey);
}

/**
 * Synchronous check for S3 configuration (for UI)
 * Note: This checks if any config exists, actual validation happens async
 */
export function isExportS3ConfiguredSync(): boolean {
	// This is a placeholder - actual check happens async
	return true;
}

/**
 * Create an S3 client for export storage using organization config
 */
function createS3Client(config: S3StorageConfig): S3Client {
	return new S3Client({
		endpoint: config.endpoint || undefined,
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
		forcePathStyle: !!config.endpoint, // Required for MinIO and other S3-compatible services
	});
}

/**
 * Test S3 connection with given credentials
 * Returns true if connection is successful, throws error otherwise
 */
export async function testS3Connection(
	config: S3StorageConfig,
): Promise<{ success: boolean; message: string }> {
	try {
		const client = createS3Client(config);

		// Try to list buckets to verify credentials
		const command = new ListBucketsCommand({});
		const response = await client.send(command);

		// Check if the specified bucket exists
		const bucketExists = response.Buckets?.some((b) => b.Name === config.bucket);

		if (!bucketExists) {
			return {
				success: false,
				message: `Bucket "${config.bucket}" not found. Available buckets: ${response.Buckets?.map((b) => b.Name).join(", ") || "none"}`,
			};
		}

		return {
			success: true,
			message: "Connection successful. Bucket verified.",
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "S3 connection test failed");

		// Provide user-friendly error messages
		if (errorMessage.includes("InvalidAccessKeyId")) {
			return { success: false, message: "Invalid Access Key ID" };
		}
		if (errorMessage.includes("SignatureDoesNotMatch")) {
			return { success: false, message: "Invalid Secret Access Key" };
		}
		if (errorMessage.includes("ENOTFOUND") || errorMessage.includes("getaddrinfo")) {
			return { success: false, message: "Cannot reach endpoint. Check your endpoint URL." };
		}

		return { success: false, message: `Connection failed: ${errorMessage}` };
	}
}

/**
 * Upload export data to S3
 */
export async function uploadExport(
	organizationId: string,
	key: string,
	data: Buffer | Uint8Array | string,
	contentType = "application/zip",
): Promise<void> {
	const config = await getStorageConfig(organizationId);
	if (!config) {
		throw new Error("S3 storage is not configured for this organization");
	}

	const client = createS3Client(config);

	logger.info(
		{
			organizationId,
			key,
			contentType,
			size: typeof data === "string" ? data.length : data.byteLength,
		},
		"Uploading export to S3",
	);

	const command = new PutObjectCommand({
		Bucket: config.bucket,
		Key: key,
		Body: data,
		ContentType: contentType,
	});

	await client.send(command);

	logger.info({ organizationId, key }, "Export uploaded successfully");
}

/**
 * Delete an export from S3
 */
export async function deleteExport(organizationId: string, key: string): Promise<void> {
	const config = await getStorageConfig(organizationId);
	if (!config) {
		throw new Error("S3 storage is not configured for this organization");
	}

	const client = createS3Client(config);

	logger.info({ organizationId, key }, "Deleting export from S3");

	const command = new DeleteObjectCommand({
		Bucket: config.bucket,
		Key: key,
	});

	await client.send(command);

	logger.info({ organizationId, key }, "Export deleted successfully");
}

/**
 * Check if an export exists in S3
 */
export async function exportExists(organizationId: string, key: string): Promise<boolean> {
	const config = await getStorageConfig(organizationId);
	if (!config) {
		return false;
	}

	const client = createS3Client(config);

	try {
		const command = new HeadObjectCommand({
			Bucket: config.bucket,
			Key: key,
		});
		await client.send(command);
		return true;
	} catch {
		return false;
	}
}

/**
 * Get the size of an export in S3
 */
export async function getExportSize(organizationId: string, key: string): Promise<number | null> {
	const config = await getStorageConfig(organizationId);
	if (!config) {
		return null;
	}

	const client = createS3Client(config);

	try {
		const command = new HeadObjectCommand({
			Bucket: config.bucket,
			Key: key,
		});
		const response = await client.send(command);
		return response.ContentLength ?? null;
	} catch {
		return null;
	}
}

/**
 * Generate a presigned URL for downloading an export
 */
export async function getPresignedUrl(
	organizationId: string,
	key: string,
	expiresIn = 86400,
): Promise<string> {
	const config = await getStorageConfig(organizationId);
	if (!config) {
		throw new Error("S3 storage is not configured for this organization");
	}

	const client = createS3Client(config);

	logger.info({ organizationId, key, expiresIn }, "Generating presigned URL");

	const command = new GetObjectCommand({
		Bucket: config.bucket,
		Key: key,
	});

	const url = await getSignedUrl(client, command, { expiresIn });

	return url;
}

/**
 * Generate the S3 key for an export file
 */
export function generateExportKey(
	organizationId: string,
	exportId: string,
	timestamp?: Date,
): string {
	const ts = timestamp || new Date();
	const dateStr = ts.toISOString().split("T")[0]; // YYYY-MM-DD
	return `exports/${organizationId}/${dateStr}/${exportId}.zip`;
}
