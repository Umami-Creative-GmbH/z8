import { Suspense } from "react";
import { ProjectManagement } from "@/components/settings/project-management";
import { ProjectTaskManagement } from "@/components/settings/project-task-management";
import { ProjectTemplateManagement } from "@/components/settings/project-template-management";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
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
import { getTranslate } from "@/tolgee/server";

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

	const t = await getTranslate();
	// Only org owners and admins manage project templates (#878).
	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.projects.title", "Projects")}
			description={t(
				"settings.projects.description",
				"Manage projects, budgets, deadlines, and time assignments",
			)}
			defaultTab="projects"
			tabs={[
				{
					value: "projects",
					label: t("settings.projects.tabs.projects", "Projects"),
					panel: (
						<div className="flex flex-1 flex-col">
							<ProjectManagement
								organizationId={organizationId}
								canManageProjectManagers
								embedded
							/>
						</div>
					),
				},
				{
					value: "templates",
					label: t("settings.projects.tabs.templates", "Templates"),
					panel: (
						<div className="flex flex-1 flex-col">
							<ProjectTemplateManagement organizationId={organizationId} />
						</div>
					),
				},
			]}
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
