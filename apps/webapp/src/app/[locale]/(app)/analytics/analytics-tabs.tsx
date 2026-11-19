"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";
import { usePathname } from "@/navigation";

export function AnalyticsTabs({ children }: { children: ReactNode }) {
	const section = usePathname().split("/")[2] || "overview";
	return (
		<Tabs value={section} className="w-full">
			{children}
		</Tabs>
	);
}
