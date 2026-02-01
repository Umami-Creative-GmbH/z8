import { and, eq, or } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { employee, project, projectAssignment } from "@/db/schema";
import { auth } from "@/lib/auth";

/**
 * GET /api/extension/projects
 * Returns active projects assigned to the authenticated user (directly or via team)
 *
 * Used by the browser extension to populate the project selector
 *
 * Response: { projects: Array<{ id, name, color, icon }> }
 */
export async function GET() {
	await connection();

	try {
		const resolvedHeaders = await headers();
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ projects: [] });
		}

		// Get employee record
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrgId),
				eq(employee.isActive, true),
			),
		});

		if (!emp) {
			return NextResponse.json({ projects: [] });
		}

		// Get projects assigned to this employee directly or via their team
		// Employee's team is stored directly on the employee record
		const assignmentConditions = [eq(projectAssignment.employeeId, emp.id)];

		// If employee has a team, also include team-based assignments
		if (emp.teamId) {
			assignmentConditions.push(eq(projectAssignment.teamId, emp.teamId));
		}

		const assignments = await db
			.selectDistinct({
				projectId: projectAssignment.projectId,
			})
			.from(projectAssignment)
			.where(and(eq(projectAssignment.organizationId, activeOrgId), or(...assignmentConditions)));

		if (assignments.length === 0) {
			return NextResponse.json({ projects: [] });
		}

		const projectIds = assignments.map((a) => a.projectId);

		// Fetch project details
		const projects = await db.query.project.findMany({
			where: and(
				eq(project.organizationId, activeOrgId),
				eq(project.isActive, true),
				or(...projectIds.map((id) => eq(project.id, id))),
			),
			columns: {
				id: true,
				name: true,
				color: true,
				icon: true,
			},
			orderBy: (project, { asc }) => [asc(project.name)],
		});

		return NextResponse.json({ projects });
	} catch (error) {
		console.error("Failed to fetch projects for extension:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
