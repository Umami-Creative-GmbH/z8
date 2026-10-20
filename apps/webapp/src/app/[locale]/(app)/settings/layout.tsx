import { Suspense } from "react";
import { SettingsBreadcrumbs } from "@/components/settings/settings-breadcrumbs";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { loadDrivingLicenceSettingsVisible } from "@/lib/organization/driving-licence/visibility";
import { managesProjectBelowManagerTier } from "@/lib/projects/project-manager-settings-access";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

async function SettingsNavigation() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();
	const accessTier = settingsRouteContext?.accessTier ?? "member";
	const billingEnabled = env.BILLING_ENABLED === "true";
	const managesProject = await managesProjectBelowManagerTier(
		settingsRouteContext?.accessTier ?? null,
		settingsRouteContext?.authContext.user.id ?? null,
		settingsRouteContext?.authContext.session.activeOrganizationId ?? null,
	);
	const drivingLicenceSettingsVisible = await loadDrivingLicenceSettingsVisible(
		accessTier,
		settingsRouteContext?.authContext.user.id ?? null,
		settingsRouteContext?.authContext.session.activeOrganizationId ?? null,
	);

	return (
		<aside className="w-64 border-r bg-card hidden md:block overflow-auto">
			<SettingsNav
				accessTier={accessTier}
				billingEnabled={billingEnabled}
				managesProject={managesProject}
				drivingLicenceSettingsVisible={drivingLicenceSettingsVisible}
			/>
		</aside>
	);
}

function SettingsNavigationLoading() {
	return (
		<aside className="w-64 border-r bg-card hidden md:block overflow-auto">
			<div className="space-y-3 p-4">
				<Skeleton className="h-6 w-28" />
				<Skeleton className="h-5 w-full" />
				<Skeleton className="h-5 w-11/12" />
				<Skeleton className="h-5 w-10/12" />
			</div>
		</aside>
	);
}

function SettingsBreadcrumbsLoading() {
	return (
		<div
			aria-hidden="true"
			className="mb-4 flex h-9 items-center gap-2 px-6 pt-4"
		>
			<Skeleton className="size-4" />
			<Skeleton className="h-4 w-40" />
		</div>
	);
}

export default function SettingsLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/settings" params={params}>
			<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
				<Suspense fallback={<SettingsNavigationLoading />}>
					<SettingsNavigation />
				</Suspense>
				<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<Suspense fallback={<SettingsBreadcrumbsLoading />}>
						<SettingsBreadcrumbs />
					</Suspense>
					<Suspense fallback={<SettingsContentLoading />}>
						<div className="min-w-0 flex-1 overflow-auto overflow-x-hidden">
							{children}
						</div>
					</Suspense>
				</main>
			</div>
		</RouteTranslationBoundary>
	);
}
