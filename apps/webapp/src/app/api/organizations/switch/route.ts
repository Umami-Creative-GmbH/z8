import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function POST(request: NextRequest) {
	try {
		const session = await auth.api.getSession({ headers: await headers() });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { organizationId } = body;

		if (!organizationId) {
			return NextResponse.json({ error: "Organization ID is required" }, { status: 400 });
		}

		// Verify user is a member of this organization
		const [membership] = await db
			.select()
			.from(member)
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
			.limit(1);

		if (!membership) {
			return NextResponse.json(
				{ error: "You are not a member of this organization" },
				{ status: 403 },
			);
		}

		// Check if user has an employee record in this organization
		const [employeeRecord] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, session.user.id),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
			)
			.limit(1);

		// Update the session's active organization
		await auth.api.setActiveOrganization({
			headers: await headers(),
			organizationId,
		});

		return NextResponse.json({
			success: true,
			organizationId,
			hasEmployeeRecord: !!employeeRecord,
		});
	} catch (error) {
		console.error("Error switching organization:", error);
		return NextResponse.json({ error: "Failed to switch organization" }, { status: 500 });
	}
}
