import { S3Store } from "@tus/s3-store";
import { Server } from "@tus/server";
import { headers } from "next/headers";
import { NextResponse, connection } from "next/server";
import { auth } from "@/lib/auth";
import { S3_BUCKET, S3_REGION } from "@/lib/storage/s3-client";
import { env } from "@/env";

/**
 * S3 store for TUS resumable uploads
 * All uploads go to S3 (RustFS, MinIO, AWS S3, etc.)
 */
const store = new S3Store({
	partSize: 8 * 1024 * 1024, // 8MB parts for efficient multipart uploads
	s3ClientConfig: {
		bucket: S3_BUCKET,
		region: S3_REGION,
		endpoint: env.S3_ENDPOINT,
		forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
		credentials: {
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY,
		},
	},
});

const tusServer = new Server({
	path: "/api/tus",
	datastore: store,
	respectForwardedHeaders: true,
	namingFunction: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
});

// Wrapper to add authentication before handling TUS requests
async function withAuth(request: Request): Promise<Response> {
	await connection();
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	// Use handleWeb for proper Request/Response handling (TUS server v2+)
	return tusServer.handleWeb(request);
}

export async function GET(request: Request) {
	return withAuth(request);
}

export async function POST(request: Request) {
	return withAuth(request);
}

export async function PATCH(request: Request) {
	return withAuth(request);
}

export async function DELETE(request: Request) {
	return withAuth(request);
}

export async function HEAD(request: Request) {
	return withAuth(request);
}

export async function OPTIONS(request: Request) {
	// OPTIONS doesn't need auth for CORS preflight
	return tusServer.handleWeb(request);
}
