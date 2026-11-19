import { cache, Suspense } from "react";
import { SettingsBreadcrumbs } from "@/components/settings/settings-breadcrumbs";
import { SettingsMobileNav } from "@/components/settings/settings-mobile-nav";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { loadDrivingLicenceSettingsVisible } from "@/lib/organization/driving-licence/visibility";
import { managesProjectBelowManagerTier } from "@/lib/projects/project-manager-settings-access";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

/**
 * The settings navigation's server-computed props, read once per request: the
 * desktop sidebar and the mobile drawer render the same navigation from them.
 */
const loadSettingsNavProps = cache(async () => {
	const settingsRouteContext = await getCurrentSettingsRouteContext();
	const accessTier = settingsRouteContext?.accessTier ?? "member";
	const billingEnabled = env.BILLING_ENABLED === "true";
	const userId = settingsRouteContext?.authContext.user.id ?? null;
	const organizationId = settingsRouteContext?.authContext.session.activeOrganizationId ?? null;
	const [managesProject, drivingLicenceSettingsVisible] = await Promise.all([
		managesProjectBelowManagerTier(
			settingsRouteContext?.accessTier ?? null,
			userId,
			organizationId,
		),
		loadDrivingLicenceSettingsVisible(accessTier, userId, organizationId),
	]);

	return { accessTier, billingEnabled, managesProject, drivingLicenceSettingsVisible };
});

async function SettingsNavigation() {
	const navProps = await loadSettingsNavProps();

	return (
		<aside className="w-64 border-r bg-card hidden md:block overflow-auto">
			<SettingsNav {...navProps} />
		</aside>
	);
}

/** Below `md`, where the sidebar is hidden, the same navigation opens in a drawer. */
async function SettingsMobileNavigation() {
	const navProps = await loadSettingsNavProps();

	return (
		<SettingsMobileNav>
			<SettingsNav {...navProps} />
		</SettingsMobileNav>
	);
}

function SettingsNavigationLoading() {
	return (
		<aside className="w-64 border-r bg-card hidden md:block overflow-auto">
			<div aria-hidden="true" className="p-3">
				<Skeleton className="h-9 w-full" />
			</div>
			<div aria-hidden="true" className="space-y-3 px-4 py-2">
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-5 w-full" />
				<Skeleton className="h-5 w-11/12" />
				<Skeleton className="h-5 w-10/12" />
			</div>
		</aside>
	);
}

function SettingsMobileNavigationLoading() {
	return <Skeleton aria-hidden="true" className="h-8 w-36 shrink-0 md:hidden" />;
}

function SettingsBreadcrumbsLoading() {
	return (
		<div aria-hidden="true" className="flex h-5 min-w-0 flex-1 items-center gap-2">
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
					{/* Empty on the settings hub, where neither the menu nor breadcrumbs render. */}
					<div className="mx-auto flex w-full max-w-[120rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 empty:hidden lg:px-6">
						<Suspense fallback={<SettingsMobileNavigationLoading />}>
							<SettingsMobileNavigation />
						</Suspense>
						<Suspense fallback={<SettingsBreadcrumbsLoading />}>
							<SettingsBreadcrumbs />
						</Suspense>
					</div>
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
