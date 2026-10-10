"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { Temporal } from "temporal-polyfill";
import {
	applyBulkBillability,
	previewBulkBillability,
} from "@/app/[locale]/(app)/settings/billable-time/bulk-billability-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { useDisplayContext } from "@/hooks/use-display-context";
import { queryKeys } from "@/lib/query/keys";
import { BulkBillabilityForm } from "./bulk-billability-form";

/**
 * A side panel to mark one customer project's work in a date range billable or
 * non-billable (#901). Owners and admins only; the actions check again.
 */
export function BulkBillabilityActionPanel({
	open,
	onOpenChange,
	project,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	project: { id: string; name: string } | null;
}) {
	const { t } = useTranslate();
	const { timezone } = useDisplayContext();
	const queryClient = useQueryClient();
	const today = Temporal.Now.plainDateISO(timezone);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.billableTime.bulk.title", "Mark work on {name}", {
							name: project?.name ?? "",
						})}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.billableTime.bulk.description",
							"Mark the project's work in a date range billable or non-billable.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody>
					{open && project && (
						<BulkBillabilityForm
							key={project.id}
							initialRange={{
								fromDay: today.with({ day: 1 }).toString(),
								toDay: today.toString(),
							}}
							onPreview={(choice) => previewBulkBillability({ projectId: project.id, ...choice })}
							onApply={(choice) => applyBulkBillability({ projectId: project.id, ...choice })}
							onApplied={() => {
								void queryClient.invalidateQueries({ queryKey: queryKeys.timeRecords.all });
							}}
						/>
					)}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
