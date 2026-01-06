import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { auth } from "@/lib/auth";

export async function POST(request: NextRequest) {
	try {
		// Verify user is authenticated
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
		}

		const formData = await request.formData();
		const file = formData.get("file") as File;

		if (!file) {
			return NextResponse.json({ error: "No file provided" }, { status: 400 });
		}

		// Validate MIME type
		if (!file.type.startsWith("image/")) {
			return NextResponse.json({ error: "Only image files are allowed" }, { status: 400 });
		}

		// Validate file size (5MB max)
		const MAX_SIZE = 5 * 1024 * 1024;
		if (file.size > MAX_SIZE) {
			return NextResponse.json({ error: "File size must be less than 5MB" }, { status: 400 });
		}

		// Convert file to buffer
		const buffer = Buffer.from(await file.arrayBuffer());

		// Optimize image with sharp
		// Resize to max 2000x2000, convert to WebP for better compression
		const optimized = await sharp(buffer)
			.resize(2000, 2000, {
				fit: "inside",
				withoutEnlargement: true,
			})
			.webp({ quality: 85 })
			.toBuffer();

		// Create upload directory if it doesn't exist
		const uploadDir = join(process.cwd(), "public", "uploads");
		await mkdir(uploadDir, { recursive: true });

		// Generate unique filename
		const timestamp = Date.now();
		const filename = `${session.user.id}-${timestamp}.webp`;
		const filepath = join(uploadDir, filename);

		// Save file
		await writeFile(filepath, optimized);

		return NextResponse.json({
			success: true,
			url: `/uploads/${filename}`,
			name: filename,
			size: optimized.length,
		});
	} catch (error) {
		console.error("Avatar upload error:", error);
		return NextResponse.json({ error: "Upload failed", details: String(error) }, { status: 500 });
	}
}
