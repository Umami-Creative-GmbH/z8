import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserOrganizations, validateAppAccess } from "@/lib/auth-helpers";
import { getAuthRequestDiagnostics } from "@/lib/diagnostics";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SessionOrganizationStatusRoute");
const shouldLogAuthDiagnostics = process.env.NODE_ENV === "production";

/**
 * Returns the current session's organization status.
 * Used by the init page to determine if an organization needs to be activated.
 */
export async function GET() {
	await connection();

	try {
		const resolvedHeaders = await headers();
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			if (shouldLogAuthDiagnostics) {
				logger.warn(
					{
						...getAuthRequestDiagnostics(resolvedHeaders),
					},
					"Organization status requested without an authenticated session",
				);
			}
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Validate app access before proceeding
		const accessCheck = await validateAppAccess(session.user, resolvedHeaders);
		if (!accessCheck.allowed) {
			return NextResponse.json(
				{
					error: "AppAccessDenied",
					message: accessCheck.reason,
					appType: accessCheck.appType,
				},
				{ status: 403 },
			);
		}

		const activeOrganizationId = session.session?.activeOrganizationId || null;
		const organizations = await getUserOrganizations();

		if (shouldLogAuthDiagnostics) {
			logger.info(
				{
					...getAuthRequestDiagnostics(resolvedHeaders),
					userId: session.user.id,
					activeOrganizationId,
					organizationCount: organizations.length,
				},
				"Organization status resolved",
			);
		}

		return NextResponse.json({
			hasActiveOrganization: !!activeOrganizationId,
			activeOrganizationId,
			organizations: organizations.map((org) => ({
				id: org.id,
				name: org.name,
			})),
		});
	} catch (error) {
		logger.error({ error }, "Failed to get organization status");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
