"use client";

import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ScheduleComplianceSummary } from "@/lib/scheduling/compliance/types";

interface PublishComplianceDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	summary: ScheduleComplianceSummary | null;
	onConfirm: () => void;
	isConfirming: boolean;
}

export function PublishComplianceDialog({
	open,
	onOpenChange,
	summary,
	onConfirm,
	isConfirming,
}: PublishComplianceDialogProps) {
	const { t } = useTranslate();
	if (!summary) {
		return null;
	}

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle className="flex items-center gap-2">
						<IconAlertTriangle
							className="size-5 text-amber-600"
							aria-hidden="true"
						/>
						{t(
							"scheduling.publish.complianceAcknowledgmentRequired",
							"Compliance Acknowledgment Required",
						)}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"scheduling.publish.acknowledgmentDescription",
							"Publishing will proceed, but this schedule has compliance warnings that must be acknowledged first.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody>
					<div className="rounded-md border border-amber-300/70 bg-amber-50/60 p-3">
						<p className="text-sm font-medium text-amber-900">
							{t(
								"scheduling.publish.totalFindings",
								"{count, plural, one {# total finding} other {# total findings}}",
								{ count: summary.totalFindings },
							)}
						</p>
						<div className="mt-2 flex flex-wrap gap-2">
							<Badge variant="outline">
								{t("scheduling.publish.restTime", "Rest time: {count}", {
									count: summary.byType.restTime,
								})}
							</Badge>
							<Badge variant="outline">
								{t("scheduling.publish.maxHours", "Max hours: {count}", {
									count: summary.byType.maxHours,
								})}
							</Badge>
							<Badge variant="outline">
								{t("scheduling.publish.overtime", "Overtime: {count}", {
									count: summary.byType.overtime,
								})}
							</Badge>
						</div>
					</div>
				</ActionPanelBody>

				<ActionPanelFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isConfirming}
					>
						{t("scheduling.publish.cancel", "Cancel")}
					</Button>
					<Button type="button" onClick={onConfirm} disabled={isConfirming}>
						{isConfirming ? (
							<>
								<IconLoader2 className="mr-2 size-4 animate-spin" />
								{t("scheduling.publish.publishing", "Publishing…")}
							</>
						) : (
							t(
								"scheduling.publish.acknowledgeAndPublish",
								"Acknowledge and Publish",
							)
						)}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
