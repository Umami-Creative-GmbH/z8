"use client";

import type { ReactNode } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";

/** RSC arrivals and open task panels must belong to the displayed account and organization. */
export function MyDocumentsScope({
	userId,
	organizationId,
	employeeId,
	children,
}: {
	userId: string;
	organizationId: string;
	employeeId: string;
	children: ReactNode;
}) {
	const current = useOrganization();
	if (
		current.userId !== userId ||
		current.activeOrganizationId !== organizationId ||
		current.employeeId !== employeeId
	)
		return null;
	return children;
}
