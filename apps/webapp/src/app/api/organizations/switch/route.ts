import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";

function getCorsHeaders(origin: string | null): Record<string, string> {
	const appUrl = getDefaultAppBaseUrl();
	const allowedOrigins = [
		appUrl,
		"tauri://localhost", // Tauri desktop app
		"capacitor://localhost", // Mobile app (if used)
	];

	// Use the origin if it's in the allowlist, otherwise use the app URL
	const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : appUrl;

	return {
		"Access-Control-Allow-Origin": allowOrigin,
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Allow-Credentials": "true",
	};
}

export async function OPTIONS(request: NextRequest) {
	const origin = request.headers.get("origin");
	return NextResponse.json({}, { headers: getCorsHeaders(origin) });
}

export async function POST(request: NextRequest) {
	await connection();
	const origin = request.headers.get("origin");
	const corsHeaders = getCorsHeaders(origin);
	try {
		const session = await auth.api.getSession({ headers: await headers() });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
		}

		const body = await request.json();
		const { organizationId } = body;

		if (!organizationId) {
			return NextResponse.json(
				{ error: "Organization ID is required" },
				{ status: 400, headers: corsHeaders },
			);
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
				{ status: 403, headers: corsHeaders },
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
			body: {
				organizationId,
			},
		});

		return NextResponse.json(
			{
				success: true,
				organizationId,
				hasEmployeeRecord: !!employeeRecord,
			},
			{ headers: corsHeaders },
		);
	} catch (_error) {
		return NextResponse.json(
			{ error: "Failed to switch organization" },
			{ status: 500, headers: corsHeaders },
		);
	}
}
