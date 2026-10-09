import type { BillableFiguresAccess } from "@/lib/billable-time/report-figures";

/**
 * Who is reading a project report, and what they may see (#902).
 *
 * - Reading project reports at all is unchanged: employee role admin or
 *   manager (every project), or a project manager (their projects). Owners and
 *   admins of the organization (membership role) also see every project.
 * - Billable Time figures, while the module is on:
 *   - owners and admins (membership role) see everything, cost and margin too;
 *   - project managers see billable and non-billable hours and revenue for the
 *     projects they manage, never cost or margin;
 *   - anyone else (a team manager who manages no project) sees nothing more
 *     than before; employees see no money.
 */
export interface ProjectReportViewer {
	employeeRole: "admin" | "manager" | "employee";
	/** Membership role owner or admin in the active organization. */
	isOrganizationAdmin: boolean;
	managedProjectIds: ReadonlySet<string>;
}

/** Whether the viewer reads every project's report in the organization. */
export function viewsAllProjectReports(viewer: ProjectReportViewer): boolean {
	return (
		viewer.isOrganizationAdmin ||
		viewer.employeeRole === "admin" ||
		viewer.employeeRole === "manager"
	);
}

export function canViewProjectReports(viewer: ProjectReportViewer): boolean {
	return viewsAllProjectReports(viewer) || viewer.managedProjectIds.size > 0;
}

export function canViewProjectReport(viewer: ProjectReportViewer, projectId: string): boolean {
	return viewsAllProjectReports(viewer) || viewer.managedProjectIds.has(projectId);
}

/** The Billable Time figures the viewer sees for one project, or none. */
export function billableFiguresAccessFor(
	viewer: ProjectReportViewer,
	projectId: string,
): BillableFiguresAccess | null {
	if (viewer.isOrganizationAdmin) return "full";
	if (viewer.managedProjectIds.has(projectId)) return "revenue";
	return null;
}
