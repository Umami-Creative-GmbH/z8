import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { configurationService } from "@/lib/audit-export";

/**
 * GET /api/audit-export/public-key
 * Export the organization's public signing key for external verification
 *
 * Query params:
 * - format: "pem" (default) | "json" - Output format
 *
 * Response:
 * - PEM format: Returns raw PEM text with application/x-pem-file content type
 * - JSON format: Returns JSON with publicKeyPem, fingerprint, algorithm, version
 */
export async function GET(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session?.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		// Verify user is admin or owner
		const membership = await db.query.member.findFirst({
			where: and(eq(member.userId, session.user.id), eq(member.organizationId, activeOrgId)),
		});

		if (membership?.role !== "admin" && membership?.role !== "owner") {
			return NextResponse.json(
				{ error: "Insufficient permissions - admin role required" },
				{ status: 403 },
			);
		}

		const publicKey = await configurationService.exportPublicKey(activeOrgId);

		if (!publicKey) {
			return NextResponse.json(
				{ error: "No signing key configured for this organization" },
				{ status: 404 },
			);
		}

		const searchParams = request.nextUrl.searchParams;
		const format = searchParams.get("format") || "pem";

		if (format === "pem") {
			// Return raw PEM file
			return new NextResponse(publicKey.publicKeyPem, {
				headers: {
					"Content-Type": "application/x-pem-file",
					"Content-Disposition": `attachment; filename="audit-signing-key-v${publicKey.version}.pem"`,
				},
			});
		}

		// Return JSON format
		return NextResponse.json({
			publicKeyPem: publicKey.publicKeyPem,
			fingerprint: publicKey.fingerprint,
			algorithm: publicKey.algorithm,
			version: publicKey.version,
			exportedAt: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Error exporting public key:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
