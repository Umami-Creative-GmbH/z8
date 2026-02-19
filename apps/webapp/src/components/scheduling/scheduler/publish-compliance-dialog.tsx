"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import type { PublishShiftsResult } from "@/app/[locale]/(app)/scheduling/types";
import type { ScheduleComplianceSummary } from "@/lib/scheduling/compliance/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

type PublishAcknowledgmentRequiredResult = Extract<
	PublishShiftsResult,
	{ published: false; requiresAcknowledgment: true }
>;

export function shouldOpenComplianceDialog(
	result: PublishShiftsResult | null | undefined,
): result is PublishAcknowledgmentRequiredResult {
	if (!result) {
		return false;
	}

	if (result.published || !result.requiresAcknowledgment) {
		return false;
	}

	return result.complianceSummary.totalFindings > 0 && result.evaluationFingerprint.length > 0;
}

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
	if (!summary) {
		return null;
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<IconAlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
						Compliance Acknowledgment Required
					</DialogTitle>
					<DialogDescription>
						Publishing will proceed, but this schedule has compliance warnings that must be
						acknowledged first.
					</DialogDescription>
				</DialogHeader>

				<div className="rounded-md border border-amber-300/70 bg-amber-50/60 p-3">
					<p className="text-sm font-medium text-amber-900">
						{summary.totalFindings} total finding{summary.totalFindings === 1 ? "" : "s"}
					</p>
					<div className="mt-2 flex flex-wrap gap-2">
						<Badge variant="outline">Rest time: {summary.byType.restTime}</Badge>
						<Badge variant="outline">Max hours: {summary.byType.maxHours}</Badge>
						<Badge variant="outline">Overtime: {summary.byType.overtime}</Badge>
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isConfirming}
					>
						Cancel
					</Button>
					<Button type="button" onClick={onConfirm} disabled={isConfirming}>
						{isConfirming ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Publishing…
							</>
						) : (
							"Acknowledge and Publish"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
