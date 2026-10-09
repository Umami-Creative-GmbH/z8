import { Suspense } from "react";
import { ProjectManagement } from "@/components/settings/project-management";
import { ProjectTaskManagement } from "@/components/settings/project-task-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import {
	listProjectsWithManageableTasks,
	loadProjectTaskManager,
} from "@/lib/projects/project-task-permission";

/**
 * Project managers without project settings access manage only the tasks of
 * their projects (#872); everyone else without access leaves.
 */
async function getTaskOnlyProjects(userId: string, organizationId: string) {
	const manager = await loadProjectTaskManager({ userId, organizationId });
	return manager ? listProjectsWithManageableTasks(manager) : [];
}

async function ProjectSettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		return redirectWithLocale("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	if (settingsRouteContext.accessTier === "member") {
		const projects = await getTaskOnlyProjects(
			settingsRouteContext.authContext.user.id,
			organizationId,
		);
		if (projects.length === 0) {
			return redirectWithLocale("/settings");
		}
		return <ProjectTaskManagement projects={projects} />;
	}

	return (
		<ProjectManagement
			organizationId={organizationId}
			canManageProjectManagers={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}

function ProjectSettingsPageLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.projectSettings",
				labelDefault: "Loading project settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function ProjectSettingsPage() {
	return (
		<Suspense fallback={<ProjectSettingsPageLoading />}>
			<ProjectSettingsPageContent />
		</Suspense>
	);
}
