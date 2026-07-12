"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import type { WorkPolicyViolationWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
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
import { Textarea } from "@/components/ui/textarea";
import { formatEmployeeName, getViolationTypeLabel, violationTypeColors } from "./helpers";

interface AcknowledgementPanelProps {
	open: boolean;
	violation: WorkPolicyViolationWithDetails | null;
	note: string;
	onOpenChange: (open: boolean) => void;
	onNoteChange: (note: string) => void;
	onCancel: () => void;
	onConfirm: () => void;
	isPending: boolean;
}

export function AcknowledgementPanel({
	open,
	violation,
	note,
	onOpenChange,
	onNoteChange,
	onCancel,
	onConfirm,
	isPending,
}: AcknowledgementPanelProps) {
	const { t } = useTranslate();

	return (
		<ActionPanel
			open={open}
			onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : onCancel())}
		>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.workPolicies.acknowledgeViolation", "Acknowledge Violation")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.workPolicies.acknowledgeDescription",
							"Add an optional note explaining how this violation was addressed.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody className="space-y-4">
					{violation ? (
						<div className="rounded-lg border bg-muted/30 p-4">
							<div className="grid grid-cols-2 gap-2 text-sm">
								<div>
									<span className="text-muted-foreground">
										{t("settings.workPolicies.employeeLabel", "Employee:")}
									</span>{" "}
									<span className="font-medium">
										{formatEmployeeName(violation.employee, t("common.unknown", "Unknown"))}
									</span>
								</div>
								<div>
									<span className="text-muted-foreground">
										{t("settings.workPolicies.dateLabel", "Date:")}
									</span>{" "}
									<span className="font-medium">
										{DateTime.fromJSDate(violation.violationDate).toFormat("LLL d, yyyy")}
									</span>
								</div>
								<div className="col-span-2">
									<span className="text-muted-foreground">
										{t("settings.workPolicies.typeLabel", "Type:")}
									</span>{" "}
									<Badge variant={violationTypeColors[violation.violationType] || "outline"}>
										{getViolationTypeLabel(violation.violationType, t)}
									</Badge>
								</div>
							</div>
						</div>
					) : null}

					<div className="space-y-2">
						<label htmlFor="acknowledge-note" className="text-sm font-medium">
							{t("settings.workPolicies.note", "Note")} ({t("common.optional", "optional")})
						</label>
						<Textarea
							id="acknowledge-note"
							name="acknowledge-note"
							autoComplete="off"
							value={note}
							onChange={(event) => onNoteChange(event.target.value)}
							placeholder={t(
								"settings.workPolicies.notePlaceholder",
								"How was this violation addressed?",
							)}
							rows={3}
						/>
					</div>
				</ActionPanelBody>

				<ActionPanelFooter>
					<Button type="button" variant="outline" onClick={onCancel}>
						{t("common.cancel", "Cancel")}
					</Button>
					<Button onClick={onConfirm} disabled={isPending}>
						{isPending ? <IconLoader2 className="mr-2 size-4 animate-spin" /> : null}
						{t("settings.workPolicies.acknowledge", "Acknowledge")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
