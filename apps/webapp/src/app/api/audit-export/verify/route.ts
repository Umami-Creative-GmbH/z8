import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
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

		// Check CASL permissions - requires manage Export or manage AuditLog
		const ability = await getAbility();
		if (!ability || (ability.cannot("manage", "Export") && ability.cannot("manage", "AuditLog"))) {
			const error = new ForbiddenError("manage", "Export");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
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
