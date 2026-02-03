import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/env";

/**
 * S3 client configured for S3-compatible storage
 * Supports AWS S3, MinIO, RustFS, Cloudflare R2, and other S3-compatible providers
 *
 * S3 configuration is required - the application will not start without it.
 * For local development, use RustFS included in docker-compose.
 */
export const s3Client = new S3Client({
	endpoint: env.S3_ENDPOINT,
	region: env.S3_REGION,
	credentials: {
		accessKeyId: env.S3_ACCESS_KEY_ID,
		secretAccessKey: env.S3_SECRET_ACCESS_KEY,
	},
	forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
});

export const S3_BUCKET = env.S3_BUCKET;
export const S3_PUBLIC_URL = env.S3_PUBLIC_URL;
export const S3_REGION = env.S3_REGION;

/**
 * Get the public URL for an uploaded file
 */
export function getPublicUrl(key: string): string {
	return `${S3_PUBLIC_URL}/${key}`;
}
