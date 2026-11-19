"use client";

import { type ReactNode, useState } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";

import { ReportReadScope } from "./report-read-scope";

/** Presentation lifetime only. Every read and command still authorizes on the server. */
export function ReportWorkspaceScope({
	userId,
	organizationId,
	employeeId,
	arrival,
	children,
}: {
	userId: string;
	organizationId: string;
	employeeId: string;
	arrival: string;
	children: ReactNode;
}) {
	const current = useOrganization();
	const [lifetime, setLifetime] = useState({ arrival, readArrival: arrival, retired: false });
	if (
		current.userId !== userId ||
		current.activeOrganizationId !== organizationId ||
		current.employeeId !== employeeId
	) {
		if (!lifetime.retired || lifetime.arrival !== arrival) {
			setLifetime({ ...lifetime, arrival, retired: true });
		}
		return null;
	}
	if (lifetime.retired && lifetime.arrival === arrival) return null;
	// Keep the query namespace through ordinary refresh. A retired view must
	// receive a new authorized arrival and start with fresh reads.
	const readArrival = lifetime.retired ? arrival : lifetime.readArrival;
	if (lifetime.arrival !== arrival) setLifetime({ arrival, readArrival, retired: false });
	return (
		<ReportReadScope value={[userId, organizationId, employeeId, readArrival]}>
			{children}
		</ReportReadScope>
	);
}
