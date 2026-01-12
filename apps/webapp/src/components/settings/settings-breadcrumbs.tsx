"use client";

import { IconChevronRight, IconSettings } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { Link } from "@/navigation";

interface Breadcrumb {
	label: string;
	href: string;
}

export function SettingsBreadcrumbs() {
	const pathname = usePathname();
	const { t } = useTranslate();

	// Don't show breadcrumbs on the settings index page
	if (pathname === "/settings") {
		return null;
	}

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
		currentPath += `/${segment}`;

		// Get label for this segment
		let label = segment;

		// Handle special cases for better labels
		if (segment === "profile") {
			label = t("settings.profile.title", "Profile");
		} else if (segment === "organizations") {
			label = t("settings.organizations.title", "Organizations & Teams");
		} else if (segment === "security") {
			label = t("settings.security.title", "Security");
		} else if (segment === "holidays") {
			label = t("settings.holidays.title", "Holidays");
		} else if (segment === "vacation") {
			label = t("settings.vacation.title", "Vacation");
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
		} else if (segment === "history") {
			label = t("settings.vacation.history.title", "History");
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
			// Capitalize first letter for other segments
			label = segment.charAt(0).toUpperCase() + segment.slice(1);
		}

		breadcrumbs.push({
			label,
			href: currentPath,
		});
	}

	return (
		<nav className="flex items-center gap-2 text-sm text-muted-foreground mb-4 px-6 pt-4">
			<IconSettings className="size-4" />
			{breadcrumbs.map((crumb, index) => {
				const isLast = index === breadcrumbs.length - 1;

				return (
					<Fragment key={crumb.href}>
						{index > 0 && <IconChevronRight className="size-4" />}
						{isLast ? (
							<span className="text-foreground font-medium">{crumb.label}</span>
						) : (
							<Link href={crumb.href} className="hover:text-foreground transition-colors">
								{crumb.label}
							</Link>
						)}
					</Fragment>
				);
			})}
		</nav>
	);
}
