"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";
import { normalizeAppPath } from "@/lib/navigation/route-metadata";
import { usePathname } from "@/navigation";

export type ReportsTabValue = "time-and-absences" | "projects" | "vehicles";

export function resolveReportsTab(pathname: string): ReportsTabValue {
	const normalized = normalizeAppPath(pathname);
	if (normalized === "/reports/projects" || normalized.startsWith("/reports/projects/")) {
		return "projects";
	}
	if (normalized === "/reports/vehicles" || normalized.startsWith("/reports/vehicles/")) {
		return "vehicles";
	}
	return "time-and-absences";
}

export function ReportsTabs({ children }: { children: ReactNode }) {
	const activeTab = resolveReportsTab(usePathname());
	return (
		<Tabs value={activeTab} className="w-full">
			{children}
		</Tabs>
	);
}
