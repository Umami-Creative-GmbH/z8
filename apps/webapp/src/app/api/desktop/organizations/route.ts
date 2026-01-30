import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
	return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * GET /api/desktop/organizations
 * Returns the list of organizations the user belongs to
 * Used by desktop app for organization selection
 */
export async function GET() {
	await connection();

	try {
		const resolvedHeaders = await headers();
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
		}

		// Get all organizations the user is a member of
		const memberships = await db
			.select({
				organizationId: member.organizationId,
				role: member.role,
			})
			.from(member)
			.where(eq(member.userId, session.user.id));

		if (memberships.length === 0) {
			return NextResponse.json(
				{
					organizations: [],
					activeOrganizationId: null,
				},
				{ headers: corsHeaders },
			);
		}

		// Get organization details
		const orgs = await db
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				logo: organization.logo,
			})
			.from(organization)
			.where(
				and(
					eq(organization.id, memberships[0].organizationId),
					// Add more org IDs via OR if needed
				),
			);

		// Build full org list with employee status
		const organizationsWithDetails = await Promise.all(
			memberships.map(async (m) => {
				const org = await db.query.organization.findFirst({
					where: eq(organization.id, m.organizationId),
					columns: {
						id: true,
						name: true,
						slug: true,
						logo: true,
					},
				});

				// Check if user has an employee record in this org
				const emp = await db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, m.organizationId),
						eq(employee.isActive, true),
					),
				});

				return {
					id: org?.id ?? m.organizationId,
					name: org?.name ?? "Unknown",
					slug: org?.slug ?? "",
					logo: org?.logo ?? null,
					memberRole: m.role,
					hasEmployeeRecord: !!emp,
				};
			}),
		);

		return NextResponse.json(
			{
				organizations: organizationsWithDetails,
				activeOrganizationId: session.session.activeOrganizationId,
			},
			{ headers: corsHeaders },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500, headers: corsHeaders },
		);
	}
}
