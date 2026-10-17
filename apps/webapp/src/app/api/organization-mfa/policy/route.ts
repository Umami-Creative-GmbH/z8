import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolvePublicRequestOrigin } from "@/lib/domain/request-origin";
import { canAccessOrganization } from "@/lib/organization-mfa/organization-access";
import { updateOrganizationMfaPolicy } from "@/lib/organization-mfa/policy-service";
import { getOrganizationMfaCoverage } from "@/lib/organization-mfa/queries";

const inputSchema = z.object({
	organizationId: z.string().min(1),
	enabled: z.boolean(),
	gracePeriodDays: z.union([
		z.literal(0),
		z.literal(7),
		z.literal(14),
		z.literal(30),
	]),
	recoveryAcknowledged: z.boolean(),
	soleAdminLockoutAcknowledged: z.boolean(),
});
export async function GET(request: Request) {
	const subject = await auth.api.getSession({ headers: request.headers });
	if (!subject?.user)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const organizationId = new URL(request.url).searchParams.get(
		"organizationId",
	);
	if (
		!organizationId ||
		!(await canAccessOrganization(subject.session, organizationId))
	)
		return NextResponse.json(
			{ error: "Organization verification required" },
			{ status: 403 },
		);
	try {
		return NextResponse.json(
			await getOrganizationMfaCoverage(subject.user.id, organizationId),
		);
	} catch {
		return NextResponse.json(
			{ error: "Organization owner or admin required" },
			{ status: 403 },
		);
	}
}
export async function POST(request: Request) {
	// Auth API CSRF guards don't cover application routes. Same-origin JSON is required here.
	if (
		request.headers.get("origin") !==
		(await resolvePublicRequestOrigin(request))
	)
		return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	const subject = await auth.api.getSession({ headers: request.headers });
	if (!subject?.user)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const parsed = inputSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success)
		return NextResponse.json({ error: "Invalid MFA policy" }, { status: 400 });
	try {
		await updateOrganizationMfaPolicy(subject.session, parsed.data);
		return NextResponse.json({ ok: true });
	} catch (error) {
		return NextResponse.json(
			{
				error: error instanceof Error ? error.message : "Policy update refused",
			},
			{ status: 403 },
		);
	}
}
