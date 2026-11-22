"use client";

import { IconChevronRight, IconSettings } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Fragment } from "react";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Link, usePathname } from "@/navigation";
import { SETTINGS_ENTRIES } from "./settings-config";

interface Breadcrumb {
	label: string;
	href: string;
}

function buildSettingsBreadcrumbs(
	pathname: string,
	t: ReturnType<typeof useTranslate>["t"],
) {
	const breadcrumbs: Breadcrumb[] = [
		{
			label: t("settings.title", "Settings"),
			href: "/settings",
		},
	];

	// Parse pathname to build breadcrumbs
	const segments = pathname?.split("/").filter(Boolean) || [];

	// Remove locale (en, de, etc.) from segments if present
	if (segments.length > 0 && segments[0].length === 2) {
		segments.shift();
	}

	// Remove "settings" from segments as it's already in the base
	if (segments[0] === "settings") {
		segments.shift();
	}

	// Build breadcrumbs from remaining segments
	let currentPath = "/settings";
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		if (
			segment === "enterprise" ||
			(segment === "compliance" && segments[i + 1] === "works-council")
		) {
			currentPath += `/${segment}`;
			continue;
		}
		currentPath += `/${segment}`;

		// Prefer an exact navigation entry match so nested routes (e.g. /settings/vacation/employees)
		// use their own title rather than colliding with a single-segment label like "employees".
		const exactEntry = SETTINGS_ENTRIES.find(
			(candidate) => candidate.href === currentPath,
		);

		// Get label for this segment
		let label = segment;

		if (exactEntry) {
			label = t(exactEntry.titleKey, exactEntry.titleDefault);
		} else if (segment === "profile") {
			label = t("settings.profile.title", "Profile");
		} else if (segment === "organization") {
			label = t("settings.organizations.title", "Organization");
		} else if (segment === "security") {
			label = t("settings.security.title", "Security");
		} else if (segment === "holidays") {
			label = t("settings.holidays.title", "Holidays");
		} else if (segment === "vacation") {
			label = t("nav.absences", "Absences");
		} else if (segment === "teams") {
			label = t("settings.teams.title", "Teams");
		} else if (segment === "employees") {
			label = t("settings.employees.title", "Employees");
		} else if (segment === "permissions") {
			label = t("settings.permissions.title", "Permissions");
		} else if (segment === "demo") {
			label = t("settings.demoData.title", "Demo Data");
		} else if (segment === "statistics") {
			label = t("settings.statistics.title", "Statistics");
		} else if (segment === "surcharges") {
			label = t("settings.surcharges.title", "Surcharges");
		} else if (segment === "approval-escalation") {
			label = t("settings.approvalEscalation.title", "Approval Escalation");
		} else if (segment === "rates" && segments[i - 1] === "billable-time") {
			label = t("settings.billableTime.nav.rates", "Billable rates");
		} else if (
			segment === "cost-rates" &&
			segments[i - 1] === "billable-time"
		) {
			label = t("settings.billableTime.nav.costRates", "Cost rates");
		} else if (
			segment === "accounting" &&
			segments[i - 1] === "billable-time"
		) {
			label = t("settings.billableTime.nav.accounting", "Accounting");
		} else if (segment === "hand-off" && segments[i - 1] === "billable-time") {
			label = t("settings.billableTime.nav.handOff", "Hand-off");
		} else if (segment === "new") {
			label = t("common.new", "New");
		} else if (/^[a-f0-9-]{36}$/i.test(segment)) {
			// This is a UUID - determine the context from the previous segment
			const prevSegment = segments[i - 1];
			if (prevSegment === "employees") {
				label = t("settings.employees.details", "Employee Details");
			} else if (prevSegment === "teams") {
				label = t("settings.teams.details", "Team Details");
			} else {
				label = t("common.details", "Details");
			}
		} else {
			label = segment.charAt(0).toUpperCase() + segment.slice(1);
		}

		breadcrumbs.push({
			label,
			href: currentPath,
		});
	}

	return breadcrumbs;
}

export function SettingsBreadcrumbs() {
	const pathname = usePathname();
	const { t } = useTranslate();

	// Don't show breadcrumbs on the settings index page
	if (pathname === "/settings") {
		return null;
	}

	const breadcrumbs = buildSettingsBreadcrumbs(pathname, t);

	// The first crumb is the way back to every setting. The settings layout's
	// header row places it beside the phone-sized settings menu and pads it.
	return (
		<Breadcrumb
			aria-label={t("settings.breadcrumbs.label", "Settings breadcrumb")}
			className="min-w-0 flex-1"
		>
			<BreadcrumbList className="gap-2 sm:gap-2">
				{breadcrumbs.map((crumb, index) => {
					const isFirst = index === 0;
					const isLast = index === breadcrumbs.length - 1;

					return (
						<Fragment key={crumb.href}>
							{index > 0 ? (
								<BreadcrumbSeparator className="[&>svg]:size-4">
									<IconChevronRight />
								</BreadcrumbSeparator>
							) : null}
							<BreadcrumbItem className="min-w-0 max-w-full">
								{isLast ? (
									<BreadcrumbPage className="flex min-w-0 items-center gap-2 font-medium">
										{isFirst ? (
											<IconSettings className="size-4 shrink-0" aria-hidden="true" />
										) : null}
										<span className="truncate" title={crumb.label}>
											{crumb.label}
										</span>
									</BreadcrumbPage>
								) : (
									<BreadcrumbLink asChild>
										<Link
											href={crumb.href}
											className="flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
										>
											{isFirst ? (
												<IconSettings className="size-4 shrink-0" aria-hidden="true" />
											) : null}
											<span className="truncate" title={crumb.label}>
												{crumb.label}
											</span>
										</Link>
									</BreadcrumbLink>
								)}
							</BreadcrumbItem>
						</Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
