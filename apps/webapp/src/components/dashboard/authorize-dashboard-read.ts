import "server-only";

import { NextResponse } from "next/server";
import { env } from "@/env";
import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";
import { getAuthContext } from "@/lib/auth-helpers";
import type { DashboardSubject } from "./dashboard-types";

export const DASHBOARD_READ_HEADERS = { "Cache-Control": "private, no-store" };

/** Expected scope detects a replaced session; it never grants access. */
export async function authorizeDashboardRead(
	request: Request,
): Promise<DashboardSubject | NextResponse> {
	const context = await getAuthContext();
	if (!context)
		return NextResponse.json(
			{ error: "Authentication required" },
			{ status: 401, headers: DASHBOARD_READ_HEADERS },
		);
	const organizationId = context.session.activeOrganizationId;
	if (
		!organizationId ||
		!context.employee ||
		context.employee.organizationId !== organizationId
	) {
		return NextResponse.json(
			{ error: "Employee access required" },
			{ status: 403, headers: DASHBOARD_READ_HEADERS },
		);
	}
	if (
		request.headers.get(ORGANIZATION_CONTEXT_HEADERS.user) !==
			context.user.id ||
		request.headers.get(ORGANIZATION_CONTEXT_HEADERS.organization) !==
			organizationId
	) {
		return NextResponse.json(
			{ error: "Dashboard context changed. Refresh to continue." },
			{ status: 409, headers: DASHBOARD_READ_HEADERS },
		);
	}
	if (env.BILLING_ENABLED === "true") {
		const { requireBillingForRead, createBillingForbiddenResponse } =
			await import("@/lib/billing/guard");
		const access = await requireBillingForRead(organizationId);
		if (!access.canAccess) {
			const response = createBillingForbiddenResponse(access);
			response.headers.set(
				"Cache-Control",
				DASHBOARD_READ_HEADERS["Cache-Control"],
			);
			return response;
		}
	}
	return {
		userId: context.user.id,
		organizationId,
		employee: context.employee,
	};
}
