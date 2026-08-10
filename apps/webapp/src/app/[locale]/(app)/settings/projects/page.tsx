import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ProjectManagement } from "@/components/settings/project-management";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function ProjectSettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return <ProjectManagement organizationId={organizationId} />;
}

function ProjectSettingsPageLoading() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function ProjectSettingsPage() {
	return (
		<Suspense fallback={<ProjectSettingsPageLoading />}>
			<ProjectSettingsPageContent />
		</Suspense>
	);
}
