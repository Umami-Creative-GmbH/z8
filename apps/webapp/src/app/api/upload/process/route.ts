import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/lib/auth";
import { s3Client, S3_BUCKET, isS3Configured, getPublicUrl } from "@/lib/storage/s3-client";

interface ProcessRequest {
	tusFileKey: string;
	uploadType: "avatar" | "org-logo";
	organizationId?: string;
}

export async function POST(request: NextRequest) {
	try {
		// Verify authentication
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
		}

		const body: ProcessRequest = await request.json();
		const { tusFileKey, uploadType, organizationId } = body;

		if (!tusFileKey) {
			return NextResponse.json({ error: "Missing tusFileKey" }, { status: 400 });
		}

		if (!uploadType || !["avatar", "org-logo"].includes(uploadType)) {
			return NextResponse.json({ error: "Invalid uploadType" }, { status: 400 });
		}

		if (uploadType === "org-logo" && !organizationId) {
			return NextResponse.json({ error: "Missing organizationId for org-logo" }, { status: 400 });
		}

		// For org-logo, verify user is owner of the organization
		if (uploadType === "org-logo" && organizationId) {
			const member = await auth.api.getFullOrganization({
				headers: await headers(),
				query: { organizationId },
			});

			if (!member) {
				return NextResponse.json({ error: "Organization not found" }, { status: 404 });
			}

			const currentMember = member.members.find((m) => m.userId === session.user.id);
			if (!currentMember || currentMember.role !== "owner") {
				return NextResponse.json(
					{ error: "Only organization owners can update the logo" },
					{ status: 403 },
				);
			}
		}

		// Read the uploaded file (from S3 or local temp storage)
		let buffer: Buffer;

		if (isS3Configured() && s3Client) {
			// Read from S3
			const getResponse = await s3Client.send(
				new GetObjectCommand({ Bucket: S3_BUCKET, Key: tusFileKey }),
			);
			buffer = Buffer.from(await getResponse.Body!.transformToByteArray());
		} else {
			// Read from local temp storage
			const tempPath = join(process.cwd(), "public", "uploads", "tus-temp", tusFileKey);
			buffer = await readFile(tempPath);
		}

		// Process with Sharp
		const sharp = (await import("sharp")).default;
		const maxSize = uploadType === "avatar" ? 2000 : 800;

		const optimized = await sharp(buffer)
			.resize(maxSize, maxSize, {
				fit: "inside",
				withoutEnlargement: true,
			})
			.webp({ quality: 85 })
			.toBuffer();

		// Generate final key/filename
		const timestamp = Date.now();
		const folder = uploadType === "avatar" ? "avatars" : "org-logos";
		const id = uploadType === "avatar" ? session.user.id : organizationId;
		const filename = `${id}-${timestamp}.webp`;
		const finalKey = `${folder}/${filename}`;

		let publicUrl: string;

		if (isS3Configured() && s3Client) {
			// Upload to S3
			await s3Client.send(
				new PutObjectCommand({
					Bucket: S3_BUCKET,
					Key: finalKey,
					Body: optimized,
					ContentType: "image/webp",
					Metadata: {
						"uploaded-by": session.user.id,
						"original-key": tusFileKey,
						"upload-timestamp": new Date().toISOString(),
					},
				}),
			);

			// Delete temp file from S3
			await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: tusFileKey }));

			publicUrl = getPublicUrl(finalKey);
		} else {
			// Save to local storage
			const uploadDir = join(process.cwd(), "public", "uploads");
			await mkdir(uploadDir, { recursive: true });

			const finalPath = join(uploadDir, filename);
			await writeFile(finalPath, optimized);

			// Delete temp file
			const tempPath = join(process.cwd(), "public", "uploads", "tus-temp", tusFileKey);
			try {
				await unlink(tempPath);
			} catch {
				// Ignore if temp file doesn't exist
			}

			publicUrl = `/uploads/${filename}`;
		}

		// Auto-update database for org-logo
		if (uploadType === "org-logo" && organizationId) {
			await auth.api.updateOrganization({
				headers: await headers(),
				body: {
					organizationId,
					data: {
						logo: publicUrl,
					},
				},
			});
		}

		return NextResponse.json({
			success: true,
			url: publicUrl,
			key: finalKey,
			size: optimized.length,
		});
	} catch (error) {
		console.error("Process upload error:", error);
		return NextResponse.json({ error: "Processing failed", details: String(error) }, { status: 500 });
	}
}
