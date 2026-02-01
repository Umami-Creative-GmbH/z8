import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { verificationService } from "@/lib/audit-export";

/**
 * POST /api/audit-export/verify
 * Verify an audit package's cryptographic proofs
 *
 * Body:
 * - packageId: string - The audit package ID to verify
 *
 * Headers:
 * - X-Client-IP (optional): Client IP for audit logging
 */
export async function POST(request: NextRequest) {
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

		const body = await request.json();
		const { packageId } = body;

		if (!packageId) {
			return NextResponse.json({ error: "packageId is required" }, { status: 400 });
		}

		// Get client info for audit log
		const headersObj = await headers();
		const clientIp = headersObj.get("x-forwarded-for")?.split(",")[0] || headersObj.get("x-client-ip") || undefined;
		const userAgent = headersObj.get("user-agent") || undefined;

		const result = await verificationService.verifyPackage({
			packageId,
			organizationId: activeOrgId,
			verifiedById: session.user.id,
			verificationSource: "api",
			clientIp,
			userAgent,
		});

		return NextResponse.json({
			packageId,
			verification: result,
		});
	} catch (error) {
		console.error("Error verifying audit package:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
