import {
	CreateBucketCommand,
	HeadBucketCommand,
	type S3ServiceException,
} from "@aws-sdk/client-s3";
import { createLogger } from "@/lib/logger";

const logger = createLogger("StorageInit");

export type StorageInitErrorCode =
	| "MISSING_CONFIG"
	| "CONNECTION_FAILED"
	| "BUCKET_ACCESS_DENIED"
	| "BUCKET_CREATION_FAILED"
	| "UNKNOWN_ERROR";

export interface StorageInitError {
	code: StorageInitErrorCode;
	message: string;
	details?: string;
	remedy?: string;
}

export interface StorageInitResult {
	success: boolean;
	bucket?: string;
	bucketCreated?: boolean;
	error?: StorageInitError;
}

/**
 * Parse S3 service exceptions into user-friendly error information
 */
function parseS3Error(error: unknown): StorageInitError {
	if (error instanceof Error) {
		const s3Error = error as S3ServiceException;
		const name = s3Error.name || error.name;

		switch (name) {
			case "InvalidAccessKeyId":
				return {
					code: "CONNECTION_FAILED",
					message: "Invalid S3 access key ID",
					details: "The access key provided does not exist in the S3 service",
					remedy:
						"Verify S3_ACCESS_KEY_ID is correct and the key exists in your S3-compatible service",
				};

			case "SignatureDoesNotMatch":
				return {
					code: "CONNECTION_FAILED",
					message: "Invalid S3 secret access key",
					details: "The signature calculated does not match the one provided",
					remedy:
						"Verify S3_SECRET_ACCESS_KEY is correct and matches the access key",
				};

			case "AccessDenied":
			case "AllAccessDisabled":
				return {
					code: "BUCKET_ACCESS_DENIED",
					message: "Access denied to S3 bucket",
					details: s3Error.message,
					remedy:
						"Verify the credentials have permission to access the bucket, or grant s3:GetBucketLocation, s3:ListBucket permissions",
				};

			case "NoSuchBucket":
				// This is expected and handled separately - bucket needs to be created
				return {
					code: "BUCKET_CREATION_FAILED",
					message: "Bucket does not exist",
					details: "The specified bucket was not found",
					remedy: "Bucket will be auto-created if permissions allow",
				};

			case "BucketAlreadyOwnedByYou":
				// Not really an error - bucket exists and we own it
				return {
					code: "BUCKET_CREATION_FAILED",
					message: "Bucket already exists",
					details: "Bucket already owned by this account",
				};

			case "ENOTFOUND":
			case "ECONNREFUSED":
			case "ETIMEDOUT":
				return {
					code: "CONNECTION_FAILED",
					message: "Cannot connect to S3 endpoint",
					details: error.message,
					remedy: `Verify S3_ENDPOINT is correct and the service is reachable. Current endpoint: ${process.env.S3_ENDPOINT}`,
				};

			default:
				return {
					code: "UNKNOWN_ERROR",
					message: `S3 error: ${name}`,
					details: error.message,
				};
		}
	}

	return {
		code: "UNKNOWN_ERROR",
		message: "Unknown S3 error",
		details: String(error),
	};
}

/**
 * Verify that required S3 configuration is present
 */
function validateConfig(): StorageInitError | null {
	const required = [
		"S3_BUCKET",
		"S3_ACCESS_KEY_ID",
		"S3_SECRET_ACCESS_KEY",
		"S3_ENDPOINT",
	];

	const missing = required.filter((key) => !process.env[key]);

	if (missing.length > 0) {
		return {
			code: "MISSING_CONFIG",
			message: `Missing required S3 configuration: ${missing.join(", ")}`,
			remedy: `Set the following environment variables: ${missing.join(", ")}. For local development, start RustFS with 'docker compose up -d rustfs' and use the defaults from .env.template`,
		};
	}

	return null;
}

/**
 * Check if a bucket exists
 */
async function bucketExists(
	client: import("@aws-sdk/client-s3").S3Client,
	bucket: string,
): Promise<boolean> {
	try {
		await client.send(new HeadBucketCommand({ Bucket: bucket }));
		return true;
	} catch (error) {
		const s3Error = error as S3ServiceException;
		if (
			s3Error.name === "NotFound" ||
			s3Error.name === "NoSuchBucket" ||
			s3Error.$metadata?.httpStatusCode === 404
		) {
			return false;
		}
		throw error;
	}
}

/**
 * Create a bucket
 */
async function createBucket(
	client: import("@aws-sdk/client-s3").S3Client,
	bucket: string,
	region: string,
): Promise<void> {
	const command = new CreateBucketCommand({
		Bucket: bucket,
		// LocationConstraint is required for regions other than us-east-1
		// For us-east-1, it must be omitted entirely (not set to us-east-1)
		...(region !== "us-east-1" && {
			CreateBucketConfiguration: {
				LocationConstraint: region as import("@aws-sdk/client-s3").BucketLocationConstraint,
			},
		}),
	});

	await client.send(command);
}

/**
 * Initialize S3 storage - validates configuration, tests connection,
 * and creates bucket if it doesn't exist.
 *
 * Call this at application startup before handling any requests.
 * If this fails, the application should not start in production.
 */
export async function initializeStorage(): Promise<StorageInitResult> {
	logger.info("Initializing S3 storage...");

	// Step 1: Validate configuration
	const configError = validateConfig();
	if (configError) {
		logger.error({ error: configError }, "S3 configuration validation failed");
		return { success: false, error: configError };
	}

	const bucket = process.env.S3_BUCKET!;
	const region = process.env.S3_REGION || "us-east-1";

	// Step 2: Create S3 client
	// Import dynamically to avoid issues if env vars aren't set during module load
	const { S3Client } = await import("@aws-sdk/client-s3");

	const client = new S3Client({
		endpoint: process.env.S3_ENDPOINT,
		region,
		credentials: {
			accessKeyId: process.env.S3_ACCESS_KEY_ID!,
			secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
		},
		forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
	});

	// Step 3: Check if bucket exists
	try {
		const exists = await bucketExists(client, bucket);

		if (exists) {
			logger.info({ bucket }, "S3 bucket verified");
			return { success: true, bucket, bucketCreated: false };
		}

		// Step 4: Create bucket if it doesn't exist
		logger.info({ bucket, region }, "S3 bucket not found, creating...");

		try {
			await createBucket(client, bucket, region);
			logger.info({ bucket }, "S3 bucket created successfully");
			return { success: true, bucket, bucketCreated: true };
		} catch (createError) {
			const s3Error = createError as S3ServiceException;

			// BucketAlreadyOwnedByYou means it was created by another process - that's fine
			if (s3Error.name === "BucketAlreadyOwnedByYou") {
				logger.info({ bucket }, "S3 bucket already exists (race condition handled)");
				return { success: true, bucket, bucketCreated: false };
			}

			const error = parseS3Error(createError);
			error.code = "BUCKET_CREATION_FAILED";
			error.remedy =
				"Either create the bucket manually, or grant s3:CreateBucket permission to the credentials";

			logger.error({ error, bucket }, "Failed to create S3 bucket");
			return { success: false, error };
		}
	} catch (error) {
		const parsedError = parseS3Error(error);
		logger.error({ error: parsedError, bucket }, "S3 storage initialization failed");
		return { success: false, error: parsedError };
	} finally {
		client.destroy();
	}
}
