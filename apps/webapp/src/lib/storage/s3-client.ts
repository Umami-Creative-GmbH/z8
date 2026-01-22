import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/env";

/**
 * Check if S3 storage is configured
 */
export function isS3Configured(): boolean {
	return !!(
		env.S3_BUCKET &&
		env.S3_ACCESS_KEY_ID &&
		env.S3_SECRET_ACCESS_KEY
	);
}

/**
 * S3 client configured for S3-compatible storage
 * Supports AWS S3, MinIO, Cloudflare R2, and other S3-compatible providers
 */
export const s3Client = isS3Configured()
	? new S3Client({
			endpoint: env.S3_ENDPOINT || undefined,
			region: env.S3_REGION || "us-east-1",
			credentials: {
				accessKeyId: env.S3_ACCESS_KEY_ID!,
				secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
			},
			forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
		})
	: null;

export const S3_BUCKET = env.S3_BUCKET || "";
export const S3_PUBLIC_URL = env.S3_PUBLIC_URL || "";
export const S3_REGION = env.S3_REGION || "us-east-1";

/**
 * Get the public URL for an uploaded file
 */
export function getPublicUrl(key: string): string {
	if (isS3Configured() && S3_PUBLIC_URL) {
		return `${S3_PUBLIC_URL}/${key}`;
	}
	// Fallback to local URL
	return `/uploads/${key}`;
}
