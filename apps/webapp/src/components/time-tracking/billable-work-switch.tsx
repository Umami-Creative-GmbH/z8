"use client";

import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useBillableTimeEnabled } from "@/stores/organization-settings-store";
import type { BillableChoice } from "./billable-choice";

/**
 * The billable toggle (#900), next to wherever the project of work is chosen.
 * Shown only while Billable Time is on and a project is chosen; disabled for a
 * project without a customer.
 */
export function BillableWorkSwitch({
	choice,
	onChange,
	disabled = false,
}: {
	choice: BillableChoice;
	onChange: (billable: boolean) => void;
	disabled?: boolean;
}) {
	const { t } = useTranslate();
	const enabled = useBillableTimeEnabled();
	const id = useId();
	if (!enabled || !choice.visible) return null;
	const descriptionId = `${id}-description`;

	return (
		<div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
			<div className="min-w-0 space-y-0.5">
				<Label htmlFor={id}>{t("timeTracking.billable.label", "Billable")}</Label>
				<p id={descriptionId} className="text-xs text-muted-foreground">
					{choice.enabled
						? t("timeTracking.billable.description", "Chargeable to the project's customer")
						: t(
								"timeTracking.billable.noCustomer",
								"Only work on a project with a customer can be billable",
							)}
				</p>
			</div>
			<Switch
				id={id}
				aria-describedby={descriptionId}
				checked={choice.checked}
				onCheckedChange={(checked) => onChange(checked)}
				disabled={disabled || !choice.enabled}
			/>
		</div>
	);
}
