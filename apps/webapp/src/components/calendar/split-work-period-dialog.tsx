"use client";

import { IconLoader2, IconScissors, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { splitWorkPeriod } from "@/app/[locale]/(app)/time-tracking/actions";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput } from "@/components/ui/time-input";
import type { CalendarEvent } from "@/lib/calendar/types";
import { instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatInstant,
	formatPlainDate,
} from "@/lib/datetime/temporal-format";
import {
	getWorkPeriodSplitDates,
	resolveWorkPeriodSplit,
} from "@/lib/time-tracking/split-work-period";
import { formatDuration, getWorkPeriodDialogMetadata } from "./work-period-dialog-utils";

interface SplitWorkPeriodDialogProps {
	event: CalendarEvent;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSplitComplete?: () => void;
	displayContext: DisplayContext;
}

export function SplitWorkPeriodDialog({
	event,
	open,
	onOpenChange,
	onSplitComplete,
	displayContext,
}: SplitWorkPeriodDialogProps) {
	const { t } = useTranslate();

	// Get metadata with defaults
	const metadata = getWorkPeriodDialogMetadata(event);

	// State for split configuration
	const [splitTime, setSplitTime] = useState("");
	const [beforeNotes, setBeforeNotes] = useState(metadata.notes || "");
	const [afterNotes, setAfterNotes] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [disambiguation, setDisambiguation] = useState<"earlier" | "later" | undefined>();
	const splitDates = event.endDate
		? getWorkPeriodSplitDates({
				startTime: event.date,
				endTime: event.endDate,
				timezone: displayContext.timezone,
			})
		: [];
	const [splitDate, setSplitDate] = useState(() => splitDates[0] ?? "");

	// Calculate preview durations
	const splitResolution = (() => {
		if (!splitDate || !splitTime || !event.endDate) return null;

		return resolveWorkPeriodSplit({
			startTime: event.date,
			endTime: event.endDate,
			splitDate,
			splitTime,
			timezone: displayContext.timezone,
			disambiguation,
		});
	})();
	const previewDurations =
		splitResolution?.success === true
			? {
					first: splitResolution.firstDurationMinutes,
					second: splitResolution.secondDurationMinutes,
				}
			: null;
	const formattedSplitTime =
		splitResolution?.success === true
			? formatInstant(instantFromDate(splitResolution.splitTime), displayContext, "time")
			: null;
	const unresolvedSplitResolution =
		splitDate.length > 0 && splitTime.length > 0 && event.endDate
			? resolveWorkPeriodSplit({
					startTime: event.date,
					endTime: event.endDate,
					splitDate,
					splitTime,
					timezone: displayContext.timezone,
				})
			: null;
	const hasAmbiguousSplitTime =
		unresolvedSplitResolution?.success === false && unresolvedSplitResolution.code === "ambiguous";

	// Check if split time is valid
	const isValidSplitTime =
		previewDurations !== null && previewDurations.first > 0 && previewDurations.second > 0;

	const handleSplit = async () => {
		if (!isValidSplitTime) return;

		setIsSaving(true);
		const result = await splitWorkPeriod(
			event.id,
			splitDate,
			splitTime,
			beforeNotes.trim() || undefined,
			afterNotes.trim() || undefined,
			disambiguation,
		).catch(() => null);

		if (!result) {
			toast.error(t("calendar.split.failed", "Failed to split work period"));
		} else if (result.success) {
			toast.success(t("calendar.split.success", "Work period split successfully"));
			onSplitComplete?.();
			onOpenChange(false);
		} else {
			toast.error(result.error || t("calendar.split.failed", "Failed to split work period"));
		}

		setIsSaving(false);
	};

	const handleClose = () => {
		setSplitTime("");
		setSplitDate(splitDates[0] ?? "");
		setBeforeNotes(metadata.notes || "");
		setAfterNotes("");
		onOpenChange(false);
	};

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<div className="flex items-center gap-2">
						<IconScissors className="size-5" />
						<ActionPanelTitle>{t("calendar.split.title", "Split Work Period")}</ActionPanelTitle>
					</div>
					<ActionPanelDescription>
						{t("calendar.split.description", "Divide this work period into two separate sessions.")}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody className="space-y-4">
					{/* Current work period info */}
					<div className="rounded-lg bg-muted p-3">
						<div className="text-sm font-medium">
							{t("calendar.split.currentPeriod", "Current Work Period")}
						</div>
						<div className="mt-1 text-lg font-semibold">
							{formatInstant(instantFromDate(event.date), displayContext, "time")} -{" "}
							{event.endDate
								? formatInstant(instantFromDate(event.endDate), displayContext, "time")
								: "—"}
						</div>
						<div className="text-sm text-muted-foreground">
							{formatDuration(metadata.durationMinutes)}
						</div>
					</div>

					{/* Split time input */}
					<div className="space-y-2">
						<Label htmlFor="splitDate">{t("calendar.split.splitDate", "Split date")}</Label>
						<select
							id="splitDate"
							aria-label={t("calendar.split.splitDate", "Split date")}
							value={splitDate}
							onChange={(event) => {
								setSplitDate(event.target.value);
								setDisambiguation(undefined);
							}}
							className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs"
						>
							{splitDates.map((date) => (
								<option key={date} value={date}>
									{formatPlainDate(parsePlainDate(date), displayContext.locale, "dateMedium")}
								</option>
							))}
						</select>
						<Label htmlFor="splitTime">{t("calendar.split.splitAt", "Split at")}</Label>
						<TimeInput
							id="splitTime"
							value={splitTime}
							onChange={(e) => setSplitTime(e.target.value)}
							className="w-full"
						/>
						{splitResolution && !splitResolution.success && (
							<p className="text-sm text-destructive">
								{splitResolution.code === "nonexistent"
									? t("calendar.split.nonexistentTime", "Split time does not exist on this date")
									: splitResolution.code === "ambiguous"
										? t("calendar.split.ambiguousTime", "Choose which occurrence to use")
										: t(
												"calendar.split.invalidTime",
												"Split time must be between start and end times",
											)}
							</p>
						)}
						{hasAmbiguousSplitTime && (
							<RadioGroup
								aria-label={t("calendar.split.chooseOccurrence", "Choose occurrence")}
								value={disambiguation ?? ""}
								onValueChange={(value) => setDisambiguation(value as "earlier" | "later")}
								className="gap-2"
							>
								<Label className="text-sm">
									{t("calendar.split.chooseOccurrence", "Choose occurrence")}
								</Label>
								<div className="flex gap-3">
									<Label className="flex items-center gap-2">
										<RadioGroupItem value="earlier" />
										{t("calendar.split.earlierOccurrence", "Earlier occurrence")}
									</Label>
									<Label className="flex items-center gap-2">
										<RadioGroupItem value="later" />
										{t("calendar.split.laterOccurrence", "Later occurrence")}
									</Label>
								</div>
							</RadioGroup>
						)}
					</div>

					{/* Preview */}
					{isValidSplitTime && previewDurations && (
						<div className="space-y-3 rounded-lg border p-3">
							<div className="text-sm font-medium">{t("calendar.split.preview", "Preview")}</div>

							{/* First period */}
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">
										{t("calendar.split.firstPeriod", "First Period")}
									</span>
									<span className="text-sm text-muted-foreground">
										{formatInstant(instantFromDate(event.date), displayContext, "time")} -{" "}
										{formattedSplitTime}
										<span className="ml-2">({formatDuration(previewDurations.first)})</span>
									</span>
								</div>
								<Textarea
									placeholder={t("calendar.split.firstNotes", "Notes for first period (optional)")}
									value={beforeNotes}
									onChange={(e) => setBeforeNotes(e.target.value)}
									rows={2}
									className="resize-none"
								/>
							</div>

							{/* Second period */}
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">
										{t("calendar.split.secondPeriod", "Second Period")}
									</span>
									<span className="text-sm text-muted-foreground">
										{formattedSplitTime} -{" "}
										{event.endDate
											? formatInstant(instantFromDate(event.endDate), displayContext, "time")
											: "—"}
										<span className="ml-2">({formatDuration(previewDurations.second)})</span>
									</span>
								</div>
								<Textarea
									placeholder={t(
										"calendar.split.secondNotes",
										"Notes for second period (optional)",
									)}
									value={afterNotes}
									onChange={(e) => setAfterNotes(e.target.value)}
									rows={2}
									className="resize-none"
								/>
							</div>
						</div>
					)}
				</ActionPanelBody>

				<ActionPanelFooter className="gap-2 sm:gap-0">
					<Button variant="outline" onClick={handleClose} disabled={isSaving}>
						<IconX className="size-4 mr-1" />
						{t("common.cancel", "Cancel")}
					</Button>
					<Button onClick={handleSplit} disabled={!isValidSplitTime || isSaving}>
						{isSaving ? (
							<IconLoader2 className="size-4 animate-spin mr-1" />
						) : (
							<IconScissors className="size-4 mr-1" />
						)}
						{t("calendar.split.confirm", "Split Work Period")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
