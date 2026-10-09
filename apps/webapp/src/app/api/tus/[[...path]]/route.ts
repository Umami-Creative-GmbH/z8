import { AsyncLocalStorage } from "node:async_hooks";
import { S3Store } from "@tus/s3-store";
import { Server } from "@tus/server";
import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { S3_PUBLIC_BUCKET, S3_PUBLIC_REGION } from "@/lib/storage/s3-client";
import { createOwnedTusFileKey, isTusFileKeyOwnedByUser } from "@/lib/upload/tus-ownership";
import {
	isUploadPurpose,
	UPLOAD_PURPOSE_METADATA_KEY,
	uploadPolicyFor,
} from "@/lib/upload/upload-purpose";

const tusUploadOwnerContext = new AsyncLocalStorage<string>();
/** The receipt and default limit; other purposes declare their own (#865). */
const MAX_TUS_UPLOAD_SIZE = Number(env.TUS_MAX_UPLOAD_SIZE_BYTES);
const MIME_METADATA_KEYS = new Set([
	"content-type",
	"contentType",
	"filetype",
	"fileType",
	"type",
	"mimeType",
]);

/**
 * S3 store for TUS resumable uploads
 * All uploads go to S3 (RustFS, MinIO, AWS S3, etc.)
 */
const store = new S3Store({
	partSize: Number(env.TUS_MULTIPART_PART_SIZE_BYTES),
	s3ClientConfig: {
		bucket: S3_PUBLIC_BUCKET,
		region: S3_PUBLIC_REGION,
		endpoint: env.S3_PUBLIC_ENDPOINT,
		forcePathStyle: env.S3_PUBLIC_FORCE_PATH_STYLE === "true",
		credentials: {
			accessKeyId: env.S3_PUBLIC_ACCESS_KEY_ID,
			secretAccessKey: env.S3_PUBLIC_SECRET_ACCESS_KEY,
		},
	},
});

const tusServer = new Server({
	path: "/api/tus",
	datastore: store,
	respectForwardedHeaders: true,
	generateUrl: (_request, { proto, host, path, id }) =>
		`${proto}://${host}${path}/${encodeURIComponent(id)}`,
	getFileIdFromRequest: (request) => getTusFileKeyFromRequest(request) ?? undefined,
	namingFunction: () => createOwnedTusFileKey(tusUploadOwnerContext.getStore() ?? "anonymous"),
});

function getTusFileKeyFromRequest(request: Request): string | null {
	const { pathname } = new URL(request.url);
	const prefix = "/api/tus/";

	if (!pathname.startsWith(prefix)) {
		return null;
	}

	return decodeURIComponent(pathname.slice(prefix.length));
}

function parseUploadMetadata(uploadMetadata: string): Array<[string, string]> {
	return uploadMetadata.split(",").flatMap((metadataItem): Array<[string, string]> => {
		const [key, value] = metadataItem.trim().split(/\s+/, 2);
		return key && value ? [[key, Buffer.from(value, "base64").toString("utf8")]] : [];
	});
}

function validateTusUploadRequest(request: Request): Response | null {
	if (request.headers.has("upload-defer-length")) {
		return NextResponse.json({ error: "Invalid upload length" }, { status: 400 });
	}

	const uploadLength = request.headers.get("upload-length");
	const normalizedUploadLength = uploadLength?.trim();
	if (!normalizedUploadLength || !/^\d+$/.test(normalizedUploadLength)) {
		return NextResponse.json({ error: "Invalid upload length" }, { status: 400 });
	}

	const parsedLength = Number(normalizedUploadLength);
	if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
		return NextResponse.json({ error: "Invalid upload length" }, { status: 400 });
	}

	const uploadMetadata = request.headers.get("upload-metadata");
	const metadata = uploadMetadata ? parseUploadMetadata(uploadMetadata) : [];
	const declaredPurpose =
		metadata.find(([key]) => key === UPLOAD_PURPOSE_METADATA_KEY)?.[1] ?? "receipt";
	if (!isUploadPurpose(declaredPurpose)) {
		return NextResponse.json({ error: "Invalid upload purpose" }, { status: 400 });
	}
	const policy = uploadPolicyFor(declaredPurpose, { defaultMaxBytes: MAX_TUS_UPLOAD_SIZE });

	if (parsedLength > policy.maxBytes) {
		return NextResponse.json({ error: "File too large" }, { status: 413 });
	}

	if (!uploadMetadata) {
		return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
	}

	let hasValidMimeType = false;
	for (const [key, value] of metadata) {
		if (!MIME_METADATA_KEYS.has(key)) {
			continue;
		}

		const contentType = value.toLowerCase();
		if (!policy.mimeTypes.has(contentType)) {
			return NextResponse.json(
				{ error: policy.refusalFor(contentType) ?? "Invalid file type" },
				{ status: 400 },
			);
		}

		hasValidMimeType = true;
	}

	return hasValidMimeType
		? null
		: NextResponse.json({ error: "Invalid file type" }, { status: 400 });
}

// Wrapper to add authentication before handling TUS requests
async function withAuth(request: Request): Promise<Response> {
	await connection();
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const existingFileKey = getTusFileKeyFromRequest(request);
	if (existingFileKey && !isTusFileKeyOwnedByUser(existingFileKey, session.user.id)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	if (request.method === "POST") {
		const validationResponse = validateTusUploadRequest(request);
		if (validationResponse) {
			return validationResponse;
		}
	}

	// Use handleWeb for proper Request/Response handling (TUS server v2+)
	return tusUploadOwnerContext.run(session.user.id, () => tusServer.handleWeb(request));
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
