"use client";

import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Temporal } from "temporal-polyfill";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The empty date accepts the creation-day suggestion in the chosen organization timezone. */
export function OrganizationTrackingSetupFields({
	timezone,
	trackingStartDate,
	suggestedAt,
	disabled,
	onTimezoneChange,
	onDateChange,
	error,
}: {
	timezone: string;
	trackingStartDate: string;
	suggestedAt?: string;
	disabled: boolean;
	onTimezoneChange: (timezone: string) => void;
	onDateChange: (date: string) => void;
	error?: string;
}) {
	const { t } = useTranslate();
	const id = useId();
	const suggestion = suggestedAt
		? Temporal.Instant.from(suggestedAt)
				.toZonedDateTimeISO(timezone)
				.toPlainDate()
				.toString()
		: "";
	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor={`${id}-timezone`}>
					{t("organization.tracking.setup-timezone", "Organization timezone")}
				</Label>
				<TimezonePicker
					id={`${id}-timezone`}
					value={timezone}
					onChange={onTimezoneChange}
					disabled={disabled}
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor={`${id}-date`}>
					{t("organization.tracking.start-date", "Time tracking start date")}
				</Label>
				<Input
					id={`${id}-date`}
					name="trackingStartDate"
					type="date"
					autoComplete="off"
					value={trackingStartDate || suggestion}
					onChange={(event) => onDateChange(event.target.value)}
					disabled={disabled}
					aria-describedby={`${id}-description${error ? ` ${id}-error` : ""}`}
					aria-invalid={!!error}
				/>
				<p id={`${id}-description`} className="text-sm text-muted-foreground">
					{t(
						"organization.tracking.setup-description",
						"Required time and work balances start on this date, or the employee’s actual employment start if later. Employment dates still determine vacation allowance. The suggestion uses the organization’s creation date in its timezone.",
					)}
				</p>
				{error ? (
					<p
						id={`${id}-error`}
						role="alert"
						className="text-sm text-destructive"
					>
						{error}
					</p>
				) : null}
			</div>
		</div>
	);
}
