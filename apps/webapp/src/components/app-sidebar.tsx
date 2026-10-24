"use client";

import { useTranslate } from "@tolgee/react";
import type * as React from "react";
import { Suspense } from "react";
import { AppSearch } from "@/components/app-search";
import {
	buildPersonalNav,
	buildSecondaryNav,
	buildTeamNav,
	type NavigationCapabilities,
	toNavUser,
} from "@/components/app-sidebar-nav";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavTeam } from "@/components/nav-team";
import { NavUser } from "@/components/nav-user";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import type { FeatureFlagState } from "@/components/settings/settings-config";
import { SidebarCapabilityNotice } from "@/components/sidebar-capability-notice";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuItem,
	SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { buildStaticAppCommands } from "@/lib/app-search/static-commands";
import { buildStaticAppSearchResults } from "@/lib/app-search/static-results";
import type { StaticAppSearchInput } from "@/lib/app-search/types";
import { useSession } from "@/lib/auth-client";
import type { UserOrganization } from "@/lib/auth-helpers";
import type { SettingsAccessTier } from "@/lib/settings-access";

export type { NavigationCapabilities } from "@/components/app-sidebar-nav";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	capabilitiesUnavailable?: boolean;
	organizations?: UserOrganization[];
	currentOrganization?: UserOrganization | null;
	employeeRole?: "admin" | "manager" | "employee" | null;
	navigationCapabilities?: NavigationCapabilities;
	settingsAccessTier?: SettingsAccessTier;
	billingEnabled?: boolean;
	featureFlags?: FeatureFlagState;
	/** The user manages a project below the manager tier (#928). */
	managesProject?: boolean;
	/** The driving licence visibility reader offers its settings (#1420). */
	drivingLicenceSettingsVisible?: boolean;
	canCreateOrganizations?: boolean;
}

const isManagerOrAbove = (
	role: "admin" | "manager" | "employee" | null | undefined,
): boolean => {
	return role === "admin" || role === "manager";
};

const EMPTY_ORGANIZATIONS: UserOrganization[] = [];
const DEFAULT_NAVIGATION_CAPABILITIES: NavigationCapabilities = {
	scheduling: false,
	compliance: false,
	payroll: false,
	finance: false,
	worksCouncil: false,
	myDocuments: false,
	personnelFiles: false,
	periodSubmissions: false,
	teamPresence: false,
	drivingLicence: false,
	platformAdmin: false,
};

function SidebarNavigationLoading({ rows }: { rows: number }) {
	return (
		<SidebarMenu aria-hidden="true">
			{Array.from({ length: rows }, (_, index) => index + 1).map((row) => (
				<SidebarMenuItem key={row}>
					<SidebarMenuSkeleton showIcon />
				</SidebarMenuItem>
			))}
		</SidebarMenu>
	);
}

function SidebarSecondaryNavigationLoading() {
	return (
		<SidebarGroup aria-hidden="true" className="mt-auto">
			<SidebarGroupContent>
				<SidebarNavigationLoading rows={3} />
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

function SidebarUser() {
	const { data: session, isPending } = useSession();

	return <NavUser user={toNavUser(session?.user)} isLoading={isPending} />;
}

export function AppSidebar({
	capabilitiesUnavailable = false,
	organizations = EMPTY_ORGANIZATIONS,
	currentOrganization = null,
	employeeRole = null,
	navigationCapabilities = DEFAULT_NAVIGATION_CAPABILITIES,
	settingsAccessTier = "member",
	billingEnabled = false,
	featureFlags,
	managesProject = false,
	drivingLicenceSettingsVisible = false,
	canCreateOrganizations = false,
	...props
}: AppSidebarProps) {
	const { t } = useTranslate();
	const translate = (key: string, defaultValue: string) => t(key, defaultValue);
	const staticSearchInput: StaticAppSearchInput = {
		t: translate,
		employeeRole,
		settingsAccessTier,
		billingEnabled,
		showComplianceNav: navigationCapabilities.compliance,
		showPayrollNav: navigationCapabilities.payroll,
		featureFlags,
		managesProject,
		showDrivingLicenceNav: navigationCapabilities.drivingLicence ?? false,
		drivingLicenceSettingsVisible,
	};
	const staticCommands = buildStaticAppCommands(staticSearchInput);
	const staticSearchResults = buildStaticAppSearchResults(staticSearchInput);
	const navPersonal = buildPersonalNav(
		translate,
		navigationCapabilities,
		employeeRole,
	);
	const navTeam = buildTeamNav(translate, navigationCapabilities);
	const navSecondary = buildSecondaryNav(translate, navigationCapabilities);

	return (
		<Sidebar collapsible="offcanvas" {...props}>
			<SidebarHeader>
				<OrganizationSwitcher
					organizations={organizations}
					currentOrganization={currentOrganization}
					canCreateOrganizations={canCreateOrganizations}
				/>
			</SidebarHeader>
			{capabilitiesUnavailable ? <SidebarCapabilityNotice /> : null}
			<SidebarContent>
				<AppSearch
					staticCommands={staticCommands}
					staticResults={staticSearchResults}
				/>
				<Suspense fallback={<SidebarNavigationLoading rows={8} />}>
					<NavMain items={navPersonal} label="z8 app" />
				</Suspense>
				<Suspense fallback={<SidebarNavigationLoading rows={4} />}>
					{isManagerOrAbove(employeeRole) && <NavTeam items={navTeam} />}
				</Suspense>
				<Suspense fallback={<SidebarSecondaryNavigationLoading />}>
					<NavSecondary className="mt-auto" items={navSecondary} />
				</Suspense>
			</SidebarContent>
			<SidebarFooter>
				<SidebarUser />
			</SidebarFooter>
		</Sidebar>
	);
}
