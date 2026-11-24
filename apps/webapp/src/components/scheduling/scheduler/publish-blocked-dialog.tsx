"use client";

import { IconLock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { DateRange } from "@/app/[locale]/(app)/scheduling/types";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import type { ScheduleStatutoryFindings } from "@/lib/statutory/scheduling/findings-list";
import { StatutoryFindingsList } from "./statutory-findings-list";

interface PublishBlockedDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	statutoryFindings: ScheduleStatutoryFindings | null;
	dateRange: DateRange;
	shiftEmployeeIds?: ReadonlySet<string>;
}

/**
 * The JArbSchG publish block's refusal (#2026): which employee, which limit and which day blocks
 * publishing, so the planner knows what to change.
 */
export function PublishBlockedDialog({
	open,
	onOpenChange,
	statutoryFindings,
	dateRange,
	shiftEmployeeIds,
}: PublishBlockedDialogProps) {
	const { t } = useTranslate();
	if (!statutoryFindings) {
		return null;
	}

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle className="flex items-center gap-2">
						<IconLock className="size-5 text-destructive" aria-hidden="true" />
						{t("scheduling:scheduling.statutory.findings.blockedTitle", "Publishing refused")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"scheduling.scheduler.publish.statutoryBlocked",
							"Some shifts break youth protection limits (JArbSchG). Change the shifts or acknowledge a statutory sector exception before publishing.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody>
					<StatutoryFindingsList
						findings={statutoryFindings}
						dateRange={dateRange}
						shiftEmployeeIds={shiftEmployeeIds}
						label={t(
							"scheduling:scheduling.statutory.findings.blockingListLabel",
							"Findings that block publishing",
						)}
					/>
				</ActionPanelBody>

				<ActionPanelFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("scheduling:scheduling.statutory.findings.close", "Close")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
