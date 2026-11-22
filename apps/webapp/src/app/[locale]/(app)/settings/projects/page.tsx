import { Suspense } from "react";
import { ProjectManagement } from "@/components/settings/project-management";
import { ProjectSettingsTabs } from "@/components/settings/project-settings-tabs";
import { ProjectTaskManagement } from "@/components/settings/project-task-management";
import { ProjectTemplateManagement } from "@/components/settings/project-template-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import {
	listProjectsWithManageableTasks,
	loadProjectTaskManager,
} from "@/lib/projects/project-task-permission";
import { requireOrganizationFeatureEnabled } from "@/lib/settings/feature-flags.server";

/**
 * Project managers without project settings access manage only the tasks of
 * their projects (#872); everyone else without access leaves.
 */
async function getTaskOnlyProjects(userId: string, organizationId: string) {
	const manager = await loadProjectTaskManager({ userId, organizationId });
	return manager ? listProjectsWithManageableTasks(manager) : [];
}

async function ProjectSettingsPageContent() {
	const caller = await getCurrentSettingsAccess();

	if (!caller?.settingsAccess) {
		return redirectWithLocale("/settings");
	}

	const { organizationId, settingsAccess, userId } = caller;

	if (!meetsSettingsAccess(settingsAccess, "scopedManager")) {
		const projects = await getTaskOnlyProjects(userId, organizationId);
		if (projects.length === 0) {
			return redirectWithLocale("/settings");
		}
		await requireOrganizationFeatureEnabled(organizationId, "projectsEnabled");
		return <ProjectTaskManagement projects={projects} />;
	}

	await requireOrganizationFeatureEnabled(organizationId, "projectsEnabled");

	if (!meetsSettingsAccess(settingsAccess, "orgAdmin")) {
		return (
			<div className="page-frame flex flex-1 flex-col">
				<ProjectManagement organizationId={organizationId} canManageProjectManagers={false} />
			</div>
		);
	}

	// Only org owners and admins manage project templates (#878).
	return (
		<ProjectSettingsTabs
			projects={
				<ProjectManagement organizationId={organizationId} canManageProjectManagers embedded />
			}
			templates={<ProjectTemplateManagement organizationId={organizationId} />}
		/>
	);
}

function ProjectSettingsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.projectSettings",
				labelDefault: "Loading project settings",
			}}
		>
			<div className="space-y-2 pb-2">
				<Skeleton className="h-8 w-48" aria-hidden="true" />
				<Skeleton className="h-4 w-full max-w-md" aria-hidden="true" />
			</div>
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
