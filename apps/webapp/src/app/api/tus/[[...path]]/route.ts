import { Server } from "@tus/server";
import { S3Store } from "@tus/s3-store";
import { FileStore } from "@tus/file-store";
import { join } from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isS3Configured, S3_BUCKET, S3_REGION } from "@/lib/storage/s3-client";

// Create the appropriate store based on configuration
function createStore() {
	if (isS3Configured()) {
		return new S3Store({
			partSize: 8 * 1024 * 1024, // 8MB parts
			s3ClientConfig: {
				bucket: S3_BUCKET,
				region: S3_REGION,
				endpoint: process.env.S3_ENDPOINT || undefined,
				forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
				credentials: {
					accessKeyId: process.env.S3_ACCESS_KEY_ID!,
					secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
				},
			},
		});
	}

	// Fallback to local file storage
	const uploadDir = join(process.cwd(), "public", "uploads", "tus-temp");
	return new FileStore({ directory: uploadDir });
}

const store = createStore();

const tusServer = new Server({
	path: "/api/tus",
	datastore: store,
	respectForwardedHeaders: true,
	namingFunction: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
});

// Helper to convert Next.js request to Node.js-like request
async function handleTusRequest(request: NextRequest) {
	// Verify authentication
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	// Convert Next.js Request to a format tus-server can handle
	const url = new URL(request.url);

	// Create a minimal req/res pair for tus-server
	const req = {
		method: request.method,
		url: url.pathname + url.search,
		headers: Object.fromEntries(request.headers.entries()),
		// Add user info for later use
		userId: session.user.id,
	};

	// Collect response data
	let statusCode = 200;
	const responseHeaders: Record<string, string> = {};
	let responseBody = "";

	const res = {
		statusCode: 200,
		setHeader: (name: string, value: string) => {
			responseHeaders[name] = value;
		},
		getHeader: (name: string) => responseHeaders[name],
		hasHeader: (name: string) => name in responseHeaders,
		removeHeader: (name: string) => {
			delete responseHeaders[name];
		},
		writeHead: (code: number, headers?: Record<string, string>) => {
			statusCode = code;
			if (headers) {
				Object.assign(responseHeaders, headers);
			}
		},
		write: (chunk: string | Buffer) => {
			responseBody += chunk.toString();
		},
		end: (chunk?: string | Buffer) => {
			if (chunk) {
				responseBody += chunk.toString();
			}
		},
	};

	try {
		// For requests with a body, we need to pass it
		if (request.body && ["POST", "PATCH"].includes(request.method)) {
			const body = await request.arrayBuffer();
			(req as any).body = Buffer.from(body);
		}

		await tusServer.handle(req as any, res as any);

		return new NextResponse(responseBody || null, {
			status: statusCode,
			headers: responseHeaders,
		});
	} catch (error) {
		console.error("Tus server error:", error);
		return NextResponse.json({ error: "Upload failed" }, { status: 500 });
	}
}

export async function GET(request: NextRequest) {
	return handleTusRequest(request);
}

export async function POST(request: NextRequest) {
	return handleTusRequest(request);
}

export async function PATCH(request: NextRequest) {
	return handleTusRequest(request);
}

export async function DELETE(request: NextRequest) {
	return handleTusRequest(request);
}

export async function HEAD(request: NextRequest) {
	return handleTusRequest(request);
}

export async function OPTIONS() {
	// Handle CORS preflight
	return new NextResponse(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, HEAD, OPTIONS",
			"Access-Control-Allow-Headers":
				"Content-Type, Upload-Length, Upload-Offset, Tus-Resumable, Upload-Metadata",
			"Access-Control-Expose-Headers":
				"Upload-Offset, Location, Upload-Length, Tus-Version, Tus-Resumable, Tus-Max-Size, Tus-Extension, Upload-Metadata",
			"Tus-Resumable": "1.0.0",
			"Tus-Version": "1.0.0",
			"Tus-Extension": "creation,creation-with-upload,termination",
		},
	});
}
