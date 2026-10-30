"use client";

import { useTranslate } from "@tolgee/react";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

/** Same sidebar frame/width as the completed navigation, without protected data. */
export function SidebarLoading(props: React.ComponentProps<typeof Sidebar>) {
	const { t } = useTranslate();
	const label = t("common.loadingRegions.navigation", "Loading navigation");
	return (
		<Sidebar {...props} aria-busy="true" aria-label={label}>
			<span className="sr-only" role="status">
				{label}
			</span>
			<SidebarHeader>
				<Skeleton className="h-10 w-full" />
			</SidebarHeader>
			<SidebarContent className="px-2 py-4" aria-hidden="true">
				<Skeleton className="h-4 w-20" />
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-5/6" />
				<Skeleton className="mt-4 h-4 w-24" />
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-4/5" />
			</SidebarContent>
			<SidebarFooter>
				<Skeleton className="h-10 w-full" />
			</SidebarFooter>
		</Sidebar>
	);
}
