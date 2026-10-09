import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import {
	BILLABLE_TIME_SETTINGS_PAGES,
	type BillableTimeSettingsPageId,
} from "./billable-time-settings-pages";

/** Heading and page navigation shared by every Billable Time settings page. */
export async function BillableTimeSettingsShell({
	activePageId,
	children,
}: {
	activePageId: BillableTimeSettingsPageId;
	children: ReactNode;
}) {
	const t = await getTranslate();

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.billableTime.title", "Billable Time")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.billableTime.description",
							"Billable currency and what your organization charges customers for work",
						)}
					</p>
				</div>

				{BILLABLE_TIME_SETTINGS_PAGES.length > 1 && (
					<nav
						aria-label={t("settings.billableTime.nav.label", "Billable Time settings")}
						className="flex flex-wrap gap-2 border-b pb-2"
					>
						{BILLABLE_TIME_SETTINGS_PAGES.map((page) => (
							<Link
								key={page.id}
								href={page.href}
								aria-current={page.id === activePageId ? "page" : undefined}
								className={cn(
									"rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground",
									page.id === activePageId && "bg-muted font-medium text-foreground",
								)}
							>
								{t(page.titleKey, page.titleDefault)}
							</Link>
						))}
					</nav>
				)}

				{children}
			</div>
		</div>
	);
}
