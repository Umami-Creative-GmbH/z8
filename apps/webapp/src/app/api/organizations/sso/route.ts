import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { resolvePublicRequestOrigin } from "@/lib/domain/request-origin";
import { sessionSsoStore } from "@/lib/enterprise-identity/session-sso-store";
import { startOrganizationSsoReauthentication } from "@/lib/enterprise-identity/sso-reauthentication";

export async function POST(request: Request) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const body = await request.json().catch(() => null);
	if (typeof body?.organizationId !== "string" || !body.organizationId)
		return NextResponse.json(
			{ error: "Organization ID is required" },
			{ status: 400 },
		);
	try {
		return await startOrganizationSsoReauthentication(
			{
				getMembership: async (userId, organizationId) =>
					!!(await db.query.member.findFirst({
						where: and(
							eq(member.userId, userId),
							eq(member.organizationId, organizationId),
							eq(member.status, "approved"),
						),
						columns: { id: true },
					})),
				getPolicy: sessionSsoStore.getPolicy,
				// Return the original response so the browser receives Better Auth's signed OAuth-state cookies.
				start: (input) =>
					auth.api.signInSSO({
						headers: request.headers,
						body: input,
						asResponse: true,
					}),
			},
			{
				userId: session.user.id,
				organizationId: body.organizationId,
				callbackUrl:
					typeof body.callbackUrl === "string" ? body.callbackUrl : undefined,
				origin: await resolvePublicRequestOrigin(request),
			},
		);
	} catch {
		return NextResponse.json(
			{
				error:
					"SSO sign-in could not be started. Try again or contact your organization administrator.",
			},
			{ status: 403 },
		);
	}
}
