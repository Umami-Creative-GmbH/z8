import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { skill } from "@/db/schema";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

export async function GET(request: Request) {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
	}

	if (settingsRouteContext.accessTier === "member") {
		return NextResponse.json({ success: false, error: "Manager access required" }, { status: 403 });
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return NextResponse.json({ success: false, error: "No active organization" }, { status: 400 });
	}

	const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";

	const skills = await db.query.skill.findMany({
		where: includeInactive
			? eq(skill.organizationId, organizationId)
			: and(
					eq(skill.organizationId, organizationId),
					eq(skill.isActive, true),
				),
		orderBy: (skillTable, { asc: ascOrder }) => [ascOrder(skillTable.category), ascOrder(skillTable.name)],
	});

	return NextResponse.json({ success: true, data: skills });
}
