/**
 * Approval Detail API
 *
 * GET /api/approvals/inbox/[id] - Get approval detail for slide-over panel
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { loadAuthorizedApprovalDetail } from "@/lib/approvals/inbox/authorized-detail";
import { auth } from "@/lib/auth";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { createLogger } from "@/lib/logger";

// Ensure handlers are registered
import "@/lib/approvals/init";

const logger = createLogger("ApprovalDetailAPI");

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;

		// Authenticate
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get active organization from session
		const activeOrganizationId = session.session?.activeOrganizationId;
		if (!activeOrganizationId) {
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
		}

		const result = await loadAuthorizedApprovalDetail({
			userId: session.user.id,
			organizationId: activeOrganizationId,
			approvalId: id,
		});
		switch (result.status) {
			case "found":
				return NextResponse.json(result.detail);
			case "no_employee":
				return NextResponse.json(
					{ error: "Employee not found" },
					{ status: 404 },
				);
			case "not_found":
				return NextResponse.json(
					{ error: "Approval not found" },
					{ status: 404 },
				);
			case "unsupported_type":
				return NextResponse.json(
					{ error: "Unsupported approval type" },
					{ status: 400 },
				);
			case "forbidden": {
				const httpError = toHttpError(new ForbiddenError("read", "Approval"));
				return NextResponse.json(httpError.body, { status: httpError.status });
			}
		}
	} catch (error) {
		logger.error({ error }, "Failed to fetch approval detail");
		return NextResponse.json(
			{ error: "Failed to fetch approval detail" },
			{ status: 500 },
		);
	}
}
