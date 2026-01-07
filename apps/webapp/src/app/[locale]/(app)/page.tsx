import { redirect } from "next/navigation";
import { NoOrganizationError } from "@/components/errors/no-organization-error";
import { SectionCards } from "@/components/section-cards";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getOnboardingStatus, getUserOrganizations } from "@/lib/auth-helpers";
import { getOnboardingStepPath } from "@/lib/validations/onboarding";

export default async function Page() {
	// Check onboarding status first - redirect if not complete
	const onboardingStatus = await getOnboardingStatus();
	if (onboardingStatus && !onboardingStatus.onboardingComplete) {
		redirect(getOnboardingStepPath(onboardingStatus.onboardingStep));
	}

	const organizations = await getUserOrganizations();
	const hasOrganizations = organizations.length > 0;

	return (
		<SidebarProvider
			style={
				{
					"--sidebar-width": "calc(var(--spacing) * 72)",
					"--header-height": "calc(var(--spacing) * 12)",
				} as React.CSSProperties
			}
		>
			<ServerAppSidebar variant="inset" />
			<SidebarInset>
				<SiteHeader />
				<div className="flex flex-1 flex-col">
					{!hasOrganizations ? (
						<div className="@container/main flex flex-1 items-center justify-center p-6">
							<NoOrganizationError />
						</div>
					) : (
						<div className="@container/main flex flex-1 flex-col gap-2">
							<div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
								<SectionCards />
							</div>
						</div>
					)}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
