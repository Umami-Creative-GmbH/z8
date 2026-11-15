"use client";

import { useTranslate } from "@tolgee/react";
import { AbsenceApprovalsTable } from "@/components/approvals/absence-approvals-table";
import { TimeCorrectionApprovalsTable } from "@/components/approvals/time-correction-approvals-table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganization } from "@/hooks/use-organization";

export function LegacyApprovalsWorkspace({
	userId,
	organizationId,
}: {
	userId: string;
	organizationId: string;
}) {
	const { t } = useTranslate();
	const current = useOrganization();
	if (current.error || (!current.isLoading && !current.isManagerOrAbove)) {
		return (
			<div role="alert" className="space-y-3 rounded-md border p-4">
				<p className="text-sm">
					{t(
						"approvals:approvals.accessChanged",
						"Your approval access is unavailable. Refresh to check your current access.",
					)}
				</p>
				<Button variant="outline" onClick={() => void current.refetch()}>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}
	if (
		current.isLoading ||
		current.userId !== userId ||
		current.activeOrganizationId !== organizationId
	) {
		return (
			<p role="status" className="py-8 text-sm text-muted-foreground">
				{t(
					"approvals:approvals.scopeRefreshing",
					"Checking your current approval access…",
				)}
			</p>
		);
	}
	const scope = { userId, organizationId };
	return (
		<Tabs
			defaultValue="absences"
			className="min-w-0 gap-5"
			key={`${userId}:${organizationId}:${current.role}`}
		>
			<TabsList className="h-auto max-w-full flex-wrap justify-start">
				<TabsTrigger value="absences" className="min-h-10 whitespace-normal">
					{t("approvals:approvals.absenceRequests", "Absence Requests")}
				</TabsTrigger>
				<TabsTrigger value="corrections" className="min-h-10 whitespace-normal">
					{t("approvals:approvals.timeCorrections", "Time Corrections")}
				</TabsTrigger>
			</TabsList>
			<TabsContent value="absences" className="min-w-0 space-y-4">
				<p className="text-sm text-muted-foreground">
					{t(
						"approvals:approvals.absenceRequestsDescription",
						"Review and approve time-off requests from your team members",
					)}
				</p>
				<AbsenceApprovalsTable scope={scope} />
			</TabsContent>
			<TabsContent value="corrections" className="min-w-0 space-y-4">
				<p className="text-sm text-muted-foreground">
					{t(
						"approvals:approvals.timeCorrectionsDescription",
						"Review and approve time entry correction requests from your team members",
					)}
				</p>
				<TimeCorrectionApprovalsTable scope={scope} />
			</TabsContent>
		</Tabs>
	);
}
