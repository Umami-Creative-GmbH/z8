import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { skill } from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";

export async function GET(request: Request) {
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
	}

	if (authContext.employee.role !== "admin") {
		return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
	}

	const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";

	const skills = await db.query.skill.findMany({
		where: includeInactive
			? eq(skill.organizationId, authContext.employee.organizationId)
			: and(
					eq(skill.organizationId, authContext.employee.organizationId),
					eq(skill.isActive, true),
				),
		orderBy: (skillTable, { asc: ascOrder }) => [ascOrder(skillTable.category), ascOrder(skillTable.name)],
	});

	return NextResponse.json({ success: true, data: skills });
}
