import "server-only";

import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import type { employee } from "@/db/schema";
import { requireAuth } from "@/lib/auth-helpers";
import { loadProjectReportViewer } from "@/lib/reports/project-billable-report";
import { canViewProjectReports } from "@/lib/reports/project-report-access";

export interface EmployeeProjectReportAccess {
	employee: typeof employee.$inferSelect | null;
	projectsEnabled: boolean;
	canViewProjectReports: boolean;
}

export interface ProjectReportAccessDeps {
	requireAuth: typeof requireAuth;
	findOrganizationProjectsEnabled: (organizationId: string) => Promise<boolean>;
	loadActiveEmployee: (input: {
		employeeId: string | undefined;
		organizationId: string;
	}) => Promise<typeof employee.$inferSelect | null>;
	loadViewer: typeof loadProjectReportViewer;
}

export async function resolveProjectReportAccess(
	deps: ProjectReportAccessDeps,
): Promise<EmployeeProjectReportAccess | null> {
	let authContext;
	try {
		authContext = await deps.requireAuth();
	} catch {
		return null;
	}

	const organizationId = authContext.session.activeOrganizationId;
	if (!organizationId) {
		return null;
	}

	const [projectsEnabled, emp] = await Promise.all([
		deps.findOrganizationProjectsEnabled(organizationId),
		deps.loadActiveEmployee({
			employeeId: authContext.employee?.id,
			organizationId,
		}),
	]);

	if (!projectsEnabled) {
		return {
			employee: emp,
			projectsEnabled: false,
			canViewProjectReports: false,
		};
	}

	if (!emp) {
		return {
			employee: null,
			projectsEnabled: true,
			canViewProjectReports: false,
		};
	}

	if (emp.role === "admin" || emp.role === "manager") {
		return {
			employee: emp,
			projectsEnabled: true,
			canViewProjectReports: true,
		};
	}

	const viewer = await deps.loadViewer(db, {
		organizationId: emp.organizationId,
		userId: authContext.user.id,
		employee: emp,
	});

	return {
		employee: emp,
		projectsEnabled: true,
		canViewProjectReports: canViewProjectReports(viewer),
	};
}

export const getCachedProjectReportAccess = cache(
	async (
		loadActiveEmployee: ProjectReportAccessDeps["loadActiveEmployee"],
	): Promise<EmployeeProjectReportAccess | null> =>
		resolveProjectReportAccess({
			requireAuth,
			findOrganizationProjectsEnabled: async (organizationId) => {
				const org = await db.query.organization.findFirst({
					where: eq(organization.id, organizationId),
					columns: { projectsEnabled: true },
				});
				return org?.projectsEnabled ?? false;
			},
			loadActiveEmployee,
			loadViewer: loadProjectReportViewer,
		}),
);
