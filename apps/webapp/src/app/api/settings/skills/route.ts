import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { skill } from "@/db/schema";
import { getRequestSession } from "@/lib/auth/request-session";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";

export async function GET(request: Request) {
	const session = await getRequestSession();

	if (
		!session?.user ||
		("ssoRequired" in session && session.ssoRequired === true) ||
		("mfaRequired" in session && !!session.mfaRequired)
	) {
		return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
	}

	if (!session.session.activeOrganizationId) {
		return NextResponse.json({ success: false, error: "No active organization" }, { status: 400 });
	}

	const caller = await getCurrentSettingsAccess();

	if (!caller || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return NextResponse.json({ success: false, error: "Manager access required" }, { status: 403 });
	}

	const organizationId = caller.organizationId;

	const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";

	const skills = await db.query.skill.findMany({
		where: includeInactive
			? eq(skill.organizationId, organizationId)
			: and(eq(skill.organizationId, organizationId), eq(skill.isActive, true)),
		orderBy: (skillTable, { asc: ascOrder }) => [
			ascOrder(skillTable.category),
			ascOrder(skillTable.name),
		],
	});

	return NextResponse.json({ success: true, data: skills });
}
