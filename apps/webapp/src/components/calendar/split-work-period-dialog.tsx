"use client";

import { IconLoader2, IconScissors, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
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
	// One identity per split: a retry after a lost or refused response reuses it, so
	// the server replays a committed split instead of splitting twice.
	const submissionIdRef = useRef<string | null>(null);
	const splitDates = event.endDate
		? getWorkPeriodSplitDates({
				startTime: event.date,
				endTime: event.endDate,
				timezone: displayContext.timezone,
			})
		: [];
	const [splitDate, setSplitDate] = useState(() => splitDates[0] ?? "");

	const { splitResolution, previewDurations, formattedSplitTime, hasAmbiguousSplitTime } =
		resolveSplitPreview({ event, splitDate, splitTime, disambiguation, displayContext });

	// Check if split time is valid
	const isValidSplitTime =
		previewDurations !== null && previewDurations.first > 0 && previewDurations.second > 0;

	const handleSplit = async () => {
		if (!isValidSplitTime) return;

		const submissionId = submissionIdRef.current ?? crypto.randomUUID();
		submissionIdRef.current = submissionId;
		setIsSaving(true);
		const result = await splitWorkPeriod(
			event.id,
			splitDate,
			splitTime,
			beforeNotes.trim() || undefined,
			afterNotes.trim() || undefined,
			disambiguation,
			submissionId,
		).catch(() => null);

		if (!result) {
			toast.error(t("calendar.split.failed", "Failed to split work period"));
		} else if (result.success) {
			toast.success(t("calendar.split.success", "Work period split successfully"));
			submissionIdRef.current = null;
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
		submissionIdRef.current = null;
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
					<CurrentPeriodSummary
						event={event}
						durationMinutes={metadata.durationMinutes}
						displayContext={displayContext}
					/>

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
								{splitErrorMessage(splitResolution.code, t)}
							</p>
						)}
						{hasAmbiguousSplitTime && (
							<OccurrencePicker value={disambiguation} onChange={setDisambiguation} />
						)}
					</div>

					{isValidSplitTime && previewDurations && (
						<div className="space-y-3 rounded-lg border p-3">
							<div className="text-sm font-medium">{t("calendar.split.preview", "Preview")}</div>
							<SplitPeriodPreview
								label={t("calendar.split.firstPeriod", "First Period")}
								from={formatInstant(instantFromDate(event.date), displayContext, "time")}
								to={formattedSplitTime}
								durationMinutes={previewDurations.first}
								placeholder={t("calendar.split.firstNotes", "Notes for first period (optional)")}
								notes={beforeNotes}
								onNotesChange={setBeforeNotes}
							/>
							<SplitPeriodPreview
								label={t("calendar.split.secondPeriod", "Second Period")}
								from={formattedSplitTime}
								to={formatEndTime(event, displayContext)}
								durationMinutes={previewDurations.second}
								placeholder={t("calendar.split.secondNotes", "Notes for second period (optional)")}
								notes={afterNotes}
								onNotesChange={setAfterNotes}
							/>
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

type Translate = ReturnType<typeof useTranslate>["t"];

function resolveSplitPreview({
	event,
	splitDate,
	splitTime,
	disambiguation,
	displayContext,
}: {
	event: CalendarEvent;
	splitDate: string;
	splitTime: string;
	disambiguation: "earlier" | "later" | undefined;
	displayContext: DisplayContext;
}) {
	if (!splitDate || !splitTime || !event.endDate) {
		return {
			splitResolution: null,
			previewDurations: null,
			formattedSplitTime: null,
			hasAmbiguousSplitTime: false,
		};
	}
	const request = {
		startTime: event.date,
		endTime: event.endDate,
		splitDate,
		splitTime,
		timezone: displayContext.timezone,
	};
	const splitResolution = resolveWorkPeriodSplit({ ...request, disambiguation });
	// Without a chosen occurrence, an ambiguous wall time stays ambiguous.
	const unresolved = resolveWorkPeriodSplit(request);
	return {
		splitResolution,
		previewDurations: splitResolution.success
			? {
					first: splitResolution.firstDurationMinutes,
					second: splitResolution.secondDurationMinutes,
				}
			: null,
		formattedSplitTime: splitResolution.success
			? formatInstant(instantFromDate(splitResolution.splitTime), displayContext, "time")
			: null,
		hasAmbiguousSplitTime: !unresolved.success && unresolved.code === "ambiguous",
	};
}

function splitErrorMessage(code: string, t: Translate) {
	if (code === "nonexistent") {
		return t("calendar.split.nonexistentTime", "Split time does not exist on this date");
	}
	if (code === "ambiguous") {
		return t("calendar.split.ambiguousTime", "Choose which occurrence to use");
	}
	return t("calendar.split.invalidTime", "Split time must be between start and end times");
}

function formatEndTime(event: CalendarEvent, displayContext: DisplayContext) {
	return event.endDate
		? formatInstant(instantFromDate(event.endDate), displayContext, "time")
		: "—";
}

function CurrentPeriodSummary({
	event,
	durationMinutes,
	displayContext,
}: {
	event: CalendarEvent;
	durationMinutes: number;
	displayContext: DisplayContext;
}) {
	const { t } = useTranslate();
	return (
		<div className="rounded-lg bg-muted p-3">
			<div className="text-sm font-medium">
				{t("calendar.split.currentPeriod", "Current Work Period")}
			</div>
			<div className="mt-1 text-lg font-semibold">
				{formatInstant(instantFromDate(event.date), displayContext, "time")} -{" "}
				{formatEndTime(event, displayContext)}
			</div>
			<div className="text-sm text-muted-foreground">{formatDuration(durationMinutes)}</div>
		</div>
	);
}

function OccurrencePicker({
	value,
	onChange,
}: {
	value: "earlier" | "later" | undefined;
	onChange: (value: "earlier" | "later") => void;
}) {
	const { t } = useTranslate();
	return (
		<RadioGroup
			aria-label={t("calendar.split.chooseOccurrence", "Choose occurrence")}
			value={value ?? ""}
			onValueChange={(next) => onChange(next as "earlier" | "later")}
			className="gap-2"
		>
			<Label className="text-sm">{t("calendar.split.chooseOccurrence", "Choose occurrence")}</Label>
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
	);
}

function SplitPeriodPreview({
	label,
	from,
	to,
	durationMinutes,
	placeholder,
	notes,
	onNotesChange,
}: {
	label: string;
	from: string | null;
	to: string | null;
	durationMinutes: number;
	placeholder: string;
	notes: string;
	onNotesChange: (notes: string) => void;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium">{label}</span>
				<span className="text-sm text-muted-foreground">
					{from} - {to}
					<span className="ml-2">({formatDuration(durationMinutes)})</span>
				</span>
			</div>
			<Textarea
				placeholder={placeholder}
				value={notes}
				onChange={(e) => onNotesChange(e.target.value)}
				rows={2}
				className="resize-none"
			/>
		</div>
	);
}
