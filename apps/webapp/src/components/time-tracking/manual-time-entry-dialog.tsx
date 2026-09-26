"use client";

import { IconAlertCircle, IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { updateTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { createManualTimeEntry } from "@/app/[locale]/(app)/time-tracking/actions";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { ProjectSelectorView } from "@/components/time-tracking/project-selector";
import {
	canDiscardManualRecovery,
	frozenManualCommand,
	type ManualRecoveryRecord,
	type ManualRecoveryScope,
} from "@/components/time-tracking/manual-command-recovery";
import { TimezoneMismatchDialog } from "@/components/time-tracking/timezone-mismatch-dialog";
import {
	type ManualAttemptOutcome,
	type ManualLookupOutcome,
	useManualCommandRecovery,
} from "@/components/time-tracking/use-manual-command-recovery";
import {
	type ManualEntryTargetContext,
	ManualEntryTargetContextError,
	useManualEntryTargetContext,
} from "@/components/time-tracking/use-manual-entry-target-context";
import { WorkCategorySelectorView } from "@/components/time-tracking/work-category-selector";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelClose,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
} from "@/components/ui/action-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput } from "@/components/ui/time-input";
import { queryKeys } from "@/lib/query/keys";
import {
	describeManualWallTime,
	interpretManualInterval,
	MANUAL_TIME_ENTRY_COMMAND_VERSION,
	type ManualEndpointCommand,
	type ManualEndpointOccurrence,
	type ManualTimeEntryCommand,
	type ManualWallTime,
	type ManualZoneBasis,
} from "@/lib/time-tracking/manual-command";
import {
	formatUtcOffset,
	getBrowserTimezone,
} from "@/lib/time-tracking/timezone-capture";
import {
	formatTimeInZone,
	getTimezoneAbbreviation,
} from "@/lib/time-tracking/timezone-utils";
import { useRouter } from "@/navigation";
import {
	MANUAL_ENTRY_COLLISION,
	MANUAL_ENTRY_CONTEXT_MISMATCH,
	MANUAL_ENTRY_NOT_ADOPTED,
	MANUAL_ENTRY_REFRESH_REQUIRED,
	type ManualTimeEntryResult,
} from "@/app/[locale]/(app)/time-tracking/actions/types";

interface Props {
	employeeId: string;
	employeeTimezone: string;
	hasManager: boolean;
	onSuccess?: () => void;
	targetEmployeeId?: string;
	targetEmployeeName?: string;
	defaultDate?: string;
	defaultClockInTime?: string;
	defaultClockOutTime?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideTrigger?: boolean;
}

interface FormValues {
	date: string;
	clockInTime: string;
	clockOutTime: string;
	reason: string;
	projectId: string | undefined;
	workCategoryId: string | undefined;
	/** Version-2 commands: the chosen occurrence of a repeated wall-clock time. */
	clockInOccurrence: ManualEndpointOccurrence | undefined;
	clockOutOccurrence: ManualEndpointOccurrence | undefined;
}

type Translate = ReturnType<typeof useTranslate>["t"];
type PendingMismatch = {
	value: FormValues;
	browserTimezone: string;
	submissionId: string;
	/** Version-2 commands: the user, organization and target captured at submit. */
	target: ManualRecoveryScope | null;
};
type SubmitManualEntry = (
	value: FormValues,
	timezone: string,
	browserTimezone: string | null,
	submissionId: string,
	basis: ManualZoneBasis,
	target: ManualRecoveryScope | null,
) => Promise<boolean>;
type Message = readonly [key: string, fallback: string];

const STRICT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STRICT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const MESSAGES = {
	invalidTimeRange: [
		"timeTracking.manualEntry.errors.invalidTimeRange",
		"Clock out time must be after clock in time",
	],
	futureTime: [
		"timeTracking.manualEntry.errors.futureTime",
		"Cannot create entries for future times",
	],
	tooLong: [
		"timeTracking.manualEntry.errors.tooLong",
		"Work period cannot exceed 24 hours",
	],
	nonexistentTime: [
		"timeTracking.manualEntry.errors.nonexistentTime",
		"This time doesn't exist on this date because the clocks move forward.",
	],
	occurrenceRequired: [
		"timeTracking.manualEntry.errors.occurrenceRequired",
		"This time occurs twice on this date. Choose which one you mean.",
	],
	reconfirm: [
		"timeTracking.manualEntry.errors.reconfirm",
		"The timezone or times changed. Review the entry and submit it again.",
	],
	refresh: [
		"timeTracking.manualEntry.errors.refresh",
		"Manual entry settings changed. Review the entry and submit it again.",
	],
	overlap: [
		"timeTracking.manualEntry.errors.overlap",
		"This time overlaps recorded work. Choose a range that doesn't overlap existing entries.",
	],
	collision: [
		"timeTracking.manualEntry.errors.collision",
		"This entry conflicts with an earlier submission or changed work. Check your existing entries.",
	],
	historyReview: [
		"timeTracking.manualEntry.errors.historyReview",
		"This time history needs review before new entries can be saved. Contact your administrator.",
	],
	uncertain: [
		"timeTracking.manualEntry.recovery.uncertainToast",
		"We couldn't confirm whether this entry was saved. It's kept under Unconfirmed entries, where you can retry it exactly or check its status.",
	],
	stillUncertain: [
		"timeTracking.manualEntry.recovery.stillUncertain",
		"Still not confirmed. The entry is kept; try again when you're back online.",
	],
	contextMismatch: [
		"timeTracking.manualEntry.recovery.contextMismatch",
		"You're signed in to a different account or organization. Switch back to handle this entry.",
	],
	checkFailed: [
		"timeTracking.manualEntry.recovery.checkFailed",
		"Couldn't check this entry right now. Try again later.",
	],
	saved: ["timeTracking.manualEntry.recovery.saved", "This entry was saved."],
	savedForApproval: [
		"timeTracking.manualEntry.recovery.savedForApproval",
		"This entry was saved and submitted for approval. Its current status: {status}.",
	],
	notCommitted: [
		"timeTracking.manualEntry.recovery.notCommittedToast",
		"No save was found for this entry. Retry it exactly, or edit it as a new entry.",
	],
	unsupported: [
		"timeTracking.manualEntry.recovery.unsupportedToast",
		"This entry's status can't be checked right now. Retrying sends exactly the same entry.",
	],
} as const satisfies Record<string, Message>;

const APPROVAL_STATUS_MESSAGES = {
	pending: ["timeTracking.manualEntry.recovery.status.pending", "pending"],
	approved: ["timeTracking.manualEntry.recovery.status.approved", "approved"],
	rejected: ["timeTracking.manualEntry.recovery.status.rejected", "rejected"],
} as const satisfies Record<string, Message>;

/** How a complete date and time map to instants in the zone; null while incomplete. */
function describeEndpoint(
	date: string,
	time: string,
	timezone: string | null,
): ManualWallTime | null {
	if (!timezone || !STRICT_DATE.test(date) || !STRICT_TIME.test(time)) {
		return null;
	}
	try {
		return describeManualWallTime(date, time, timezone);
	} catch {
		return null;
	}
}

function endpointCommand(
	date: string,
	time: string,
	occurrence: ManualEndpointOccurrence | undefined,
	timezone: string,
): { ok: true; endpoint: ManualEndpointCommand } | { ok: false; message: Message } {
	const wallTime = describeEndpoint(date, time, timezone);
	if (!wallTime) return { ok: false, message: MESSAGES.invalidTimeRange };
	if (wallTime.kind === "gap") return { ok: false, message: MESSAGES.nonexistentTime };
	if (wallTime.kind === "unique") {
		return {
			ok: true,
			endpoint: { time, occurrence: null, displayedOffsetMinutes: wallTime.offsetMinutes },
		};
	}
	if (!occurrence) return { ok: false, message: MESSAGES.occurrenceRequired };
	return {
		ok: true,
		endpoint: {
			time,
			occurrence,
			displayedOffsetMinutes:
				occurrence === "earlier"
					? wallTime.earlierOffsetMinutes
					: wallTime.laterOffsetMinutes,
		},
	};
}

const INTERVAL_MESSAGES: Record<string, Message> = {
	future_endpoint: MESSAGES.futureTime,
	interval_too_long: MESSAGES.tooLong,
	nonpositive_interval: MESSAGES.invalidTimeRange,
	nonexistent_time: MESSAGES.nonexistentTime,
	occurrence_required: MESSAGES.occurrenceRequired,
};

/**
 * Freeze the confirmed draft as a version-2 command with the offsets this form
 * showed. The browser runs the same interpreter as the server, for feedback
 * only; the server interprets the command again under protection.
 */
function buildManualCommand(input: {
	value: FormValues;
	targetEmployeeId: string;
	timezone: string;
	basis: ManualZoneBasis;
	browserTimezone: string | null;
	submissionId: string;
}): { ok: true; command: ManualTimeEntryCommand } | { ok: false; message: Message } {
	const { value, timezone } = input;
	const clockIn = endpointCommand(
		value.date,
		value.clockInTime,
		value.clockInOccurrence,
		timezone,
	);
	if (!clockIn.ok) return clockIn;
	const clockOut = endpointCommand(
		value.date,
		value.clockOutTime,
		value.clockOutOccurrence,
		timezone,
	);
	if (!clockOut.ok) return clockOut;
	const command: ManualTimeEntryCommand = {
		version: MANUAL_TIME_ENTRY_COMMAND_VERSION,
		submissionId: input.submissionId,
		targetEmployeeId: input.targetEmployeeId,
		date: value.date,
		clockIn: clockIn.endpoint,
		clockOut: clockOut.endpoint,
		zone: { basis: input.basis, timezone },
		browserTimezone: input.browserTimezone,
		reason: value.reason,
		projectId: value.projectId ?? null,
		workCategoryId: value.workCategoryId ?? null,
	};
	const interval = interpretManualInterval({
		command,
		timezone,
		now: Temporal.Now.instant(),
	});
	if (!interval.ok) {
		return {
			ok: false,
			message: INTERVAL_MESSAGES[interval.rejection.reason] ?? MESSAGES.reconfirm,
		};
	}
	return { ok: true, command };
}

/** The localized message for a server outcome that needs the user's review. */
function outcomeMessage(result: ManualTimeEntryResult): Message | null {
	if (result.success) return null;
	if (
		result.code === MANUAL_ENTRY_NOT_ADOPTED ||
		result.code === MANUAL_ENTRY_REFRESH_REQUIRED
	) {
		return MESSAGES.refresh;
	}
	if (result.code === MANUAL_ENTRY_COLLISION) return MESSAGES.collision;
	const reason = result.rejection?.reason;
	if (reason === "reconfirmation_required") return MESSAGES.reconfirm;
	if (reason === "occupancy_conflict") return MESSAGES.overlap;
	if (reason === "append_review_required") return MESSAGES.historyReview;
	return reason ? (INTERVAL_MESSAGES[reason] ?? null) : null;
}

/**
 * Version-2 continuation into another zone: the draft can be sent unchanged
 * only when neither endpoint needs an occurrence choice there. Otherwise the
 * form shows the new zone so the user confirms what it means in that zone.
 */
function needsReviewInZone(value: FormValues, timezone: string): boolean {
	return [value.clockInTime, value.clockOutTime].some(
		(time) => describeEndpoint(value.date, time, timezone)?.kind !== "unique",
	);
}

/** Outcomes after which the advisory context and confirmations must be refreshed. */
function needsReconfirmation(result: ManualTimeEntryResult): boolean {
	return (
		!result.success &&
		(result.code === MANUAL_ENTRY_NOT_ADOPTED ||
			result.code === MANUAL_ENTRY_REFRESH_REQUIRED ||
			result.rejection?.reason === "reconfirmation_required" ||
			result.rejection?.reason === "occurrence_required")
	);
}

function getDefaultValues(
	timezone: string,
	defaults: Pick<
		Props,
		"defaultDate" | "defaultClockInTime" | "defaultClockOutTime"
	>,
): FormValues {
	const now = Temporal.Now.zonedDateTimeISO(timezone);
	return {
		date: defaults.defaultDate ?? now.toPlainDate().toString(),
		clockInTime: defaults.defaultClockInTime ?? "09:00",
		clockOutTime:
			defaults.defaultClockOutTime ??
			`${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`,
		reason: "",
		projectId: undefined,
		workCategoryId: undefined,
		clockInOccurrence: undefined,
		clockOutOccurrence: undefined,
	};
}

function isFutureDate(date: string, timezone: string): boolean {
	try {
		return (
			Temporal.PlainDate.compare(
				Temporal.PlainDate.from(date),
				Temporal.Now.plainDateISO(timezone),
			) > 0
		);
	} catch {
		return false;
	}
}

function useManualEntryForm({
	commandVersion,
	contextTargetEmployeeId,
	zoneBasis,
	defaults,
	effectiveTimezone,
	setPendingMismatch,
	submitManualEntry,
	t,
	targetEmployeeId,
	isTimezoneContinuationPendingRef,
	recoveryScope,
}: {
	/** From the advisory target context; `2` builds strict versioned commands. */
	commandVersion: 1 | 2;
	contextTargetEmployeeId: string | null;
	/** The session and target a version-2 command is frozen for (#310). */
	recoveryScope: ManualRecoveryScope | null;
	/** `browser` while a self entry continues once in the browser zone. */
	zoneBasis: ManualZoneBasis;
	defaults: Pick<
		Props,
		"defaultDate" | "defaultClockInTime" | "defaultClockOutTime"
	>;
	/** The authoritative target zone, or null until the target context has loaded. */
	effectiveTimezone: string | null;
	setPendingMismatch: (value: PendingMismatch) => void;
	submitManualEntry: SubmitManualEntry;
	t: Translate;
	targetEmployeeId?: string;
	isTimezoneContinuationPendingRef: React.RefObject<boolean>;
}) {
	return useForm({
		defaultValues: getDefaultValues(effectiveTimezone ?? "UTC", defaults),
		onSubmit: async ({ value }) => {
			if (isTimezoneContinuationPendingRef.current || !effectiveTimezone) {
				return;
			}

			const browserTimezone = getBrowserTimezone();
			const submissionId = crypto.randomUUID();
			if (commandVersion === 2) {
				// UTC order decides repeated-hour ranges, so the wall-clock
				// comparison below does not apply; the shared interpreter does.
				const built = contextTargetEmployeeId
					? buildManualCommand({
							value,
							targetEmployeeId: contextTargetEmployeeId,
							timezone: effectiveTimezone,
							basis: zoneBasis,
							browserTimezone: targetEmployeeId ? null : browserTimezone,
							submissionId,
						})
					: null;
				if (!built?.ok) {
					const message = built?.message ?? MESSAGES.refresh;
					toast.error(t(message[0], message[1]));
					return;
				}
				if (
					!targetEmployeeId &&
					browserTimezone &&
					browserTimezone !== effectiveTimezone
				) {
					setPendingMismatch({
						value,
						browserTimezone,
						submissionId,
						target: recoveryScope,
					});
					return;
				}
				await submitManualEntry(
					value,
					effectiveTimezone,
					targetEmployeeId ? null : browserTimezone,
					submissionId,
					zoneBasis,
					recoveryScope,
				);
				return;
			}

			const [inHours, inMinutes] = value.clockInTime.split(":").map(Number);
			const [outHours, outMinutes] = value.clockOutTime.split(":").map(Number);
			const clockInMinutes = inHours * 60 + inMinutes;
			const clockOutMinutes = outHours * 60 + outMinutes;

			if (clockOutMinutes <= clockInMinutes) {
				toast.error(
					t(
						"timeTracking.manualEntry.errors.invalidTimeRange",
						"Clock out time must be after clock in time",
					),
				);
				return;
			}

			if (isFutureDate(value.date, effectiveTimezone)) {
				toast.error(
					t(
						"timeTracking.manualEntry.errors.futureDate",
						"Cannot create entries for future dates",
					),
				);
				return;
			}

			if (clockOutMinutes - clockInMinutes > 24 * 60) {
				toast.error(
					t(
						"timeTracking.manualEntry.errors.tooLong",
						"Work period cannot exceed 24 hours",
					),
				);
				return;
			}

			if (
				!targetEmployeeId &&
				browserTimezone &&
				browserTimezone !== effectiveTimezone
			) {
				setPendingMismatch({ value, browserTimezone, submissionId, target: null });
				return;
			}

			await submitManualEntry(
				value,
				effectiveTimezone,
				!targetEmployeeId && browserTimezone === effectiveTimezone
					? browserTimezone
					: null,
				submissionId,
				"target",
				null,
			);
		},
	});
}

type ManualEntryFormApi = ReturnType<typeof useManualEntryForm>;

async function runTimezoneContinuation(
	pendingRef: React.RefObject<boolean>,
	setPending: (pending: boolean) => void,
	task: () => Promise<void>,
) {
	pendingRef.current = true;
	setPending(true);
	try {
		await task();
	} finally {
		pendingRef.current = false;
		setPending(false);
	}
}

/**
 * Version-2 commands: a repeated wall-clock time needs an explicit occurrence,
 * labelled with its UTC offset; a spring-forward time is flagged immediately.
 */
function EndpointOccurrenceChoice({
	endpoint,
	form,
	t,
	timezone,
}: {
	endpoint: "clockIn" | "clockOut";
	form: ManualEntryFormApi;
	t: Translate;
	timezone: string | null;
}) {
	return (
		<form.Subscribe<string>
			selector={(state) =>
				`${state.values.date}|${endpoint === "clockIn" ? state.values.clockInTime : state.values.clockOutTime}`
			}
		>
			{(key: string) => {
				const [date = "", time = ""] = key.split("|");
				const wallTime = describeEndpoint(date, time, timezone);
				if (!wallTime || wallTime.kind === "unique") return null;
				if (wallTime.kind === "gap") {
					return (
						<p role="alert" className="text-xs text-destructive">
							{t(MESSAGES.nonexistentTime[0], MESSAGES.nonexistentTime[1])}
						</p>
					);
				}
				const choice = (
					field: {
						state: { value: ManualEndpointOccurrence | undefined };
						handleChange: (value: ManualEndpointOccurrence) => void;
					},
				) => (
					<fieldset className="grid gap-2 rounded-md border p-3">
						<legend className="px-1 text-sm">
							{t(
								"timeTracking.manualEntry.occurrence.legend",
								"{time} occurs twice on this date. Which one do you mean?",
								{ time },
							)}
						</legend>
						<RadioGroup
							value={field.state.value ?? ""}
							onValueChange={(value) =>
								field.handleChange(value as ManualEndpointOccurrence)
							}
							className="gap-2"
						>
							<Label className="flex items-center gap-2 font-normal">
								<RadioGroupItem value="earlier" />
								{t("timeTracking.manualEntry.occurrence.earlier", "First, {offset}", {
									offset: formatUtcOffset(wallTime.earlierOffsetMinutes),
								})}
							</Label>
							<Label className="flex items-center gap-2 font-normal">
								<RadioGroupItem value="later" />
								{t("timeTracking.manualEntry.occurrence.later", "Second, {offset}", {
									offset: formatUtcOffset(wallTime.laterOffsetMinutes),
								})}
							</Label>
						</RadioGroup>
					</fieldset>
				);
				return endpoint === "clockIn" ? (
					<form.Field name="clockInOccurrence">{choice}</form.Field>
				) : (
					<form.Field name="clockOutOccurrence">{choice}</form.Field>
				);
			}}
		</form.Subscribe>
	);
}

function TargetContextStatus({
	context,
	effectiveTimezone,
	error,
	isLoading,
	onRetry,
	t,
	targetEmployeeName,
}: {
	context: ManualEntryTargetContext | null;
	effectiveTimezone: string | null;
	error: Error | null;
	isLoading: boolean;
	onRetry: () => void;
	t: Translate;
	targetEmployeeName?: string;
}) {
	if (error) {
		const notAuthorized =
			error instanceof ManualEntryTargetContextError && error.notAuthorized;
		return (
			<Alert variant="destructive">
				<IconAlertCircle aria-hidden="true" />
				<AlertDescription>
					<p>
						{notAuthorized
							? t(
									"timeTracking.manualEntry.context.notAuthorized",
									"You can't create time entries for this employee.",
								)
							: t(
									"timeTracking.manualEntry.context.loadFailed",
									"Couldn't load the timezone and choices for this entry.",
								)}
					</p>
					{notAuthorized ? null : (
						<Button
							type="button"
							variant="link"
							className="h-auto p-0"
							onClick={onRetry}
						>
							{t("timeTracking.manualEntry.context.retry", "Try again")}
						</Button>
					)}
				</AlertDescription>
			</Alert>
		);
	}

	if (isLoading || !context || !effectiveTimezone) {
		return (
			<p
				role="status"
				className="flex items-center gap-2 text-xs text-muted-foreground"
			>
				<IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" />
				{t(
					"timeTracking.manualEntry.context.loading",
					"Loading entry options…",
				)}
			</p>
		);
	}

	const timezoneLabel = getTimezoneAbbreviation(effectiveTimezone);
	if (context.isOwnEntry) {
		return (
			<p role="status" className="text-xs text-muted-foreground">
				{t(
					"timeTracking.correction.timezoneNote",
					"Times are in your local timezone ({timezone})",
					{ timezone: timezoneLabel },
				)}
			</p>
		);
	}

	const employee =
		targetEmployeeName ??
		t("timeTracking.manualEntry.context.thisEmployee", "this employee");
	const timezone = `${effectiveTimezone} (${timezoneLabel})`;
	return (
		<div role="status" className="grid gap-0.5 text-xs text-muted-foreground">
			<p>
				{t(
					"timeTracking.manualEntry.context.targetTimezone",
					"Times are in {employee}'s timezone: {timezone}",
					{ employee, timezone },
				)}
			</p>
			{context.timezoneSource === "organization" ? (
				<p>
					{t(
						"timeTracking.manualEntry.context.organizationFallback",
						"{employee} has no personal timezone, so the organization's timezone is used.",
						{ employee },
					)}
				</p>
			) : null}
			{context.timezoneSource === "default" ? (
				<p>
					{t(
						"timeTracking.manualEntry.context.utcFallback",
						"Neither {employee} nor the organization has a timezone set, so UTC is used.",
						{ employee },
					)}
				</p>
			) : null}
		</div>
	);
}

function recoveryStatusMessage(record: ManualRecoveryRecord): Message {
	switch (record.status) {
		case "uncertain":
			return [
				"timeTracking.manualEntry.recovery.uncertain",
				"Not confirmed. It may already be saved.",
			];
		case "not_committed":
			return ["timeTracking.manualEntry.recovery.notCommitted", "No save found."];
		case "conflict":
			return MESSAGES.collision;
		case "unsupported":
			return [
				"timeTracking.manualEntry.recovery.unsupported",
				"Its status can't be checked. It may already be saved.",
			];
	}
}

/**
 * Commands frozen in this tab for the current user, organization and target
 * whose outcome is still open (#310). Nothing is resent unless the user asks.
 */
function ManualRecoveryPanel({
	busyId,
	onDiscard,
	onEditAsNew,
	onLookup,
	onRetry,
	records,
	t,
}: {
	busyId: string | null;
	onDiscard: (record: ManualRecoveryRecord) => void;
	onEditAsNew: (record: ManualRecoveryRecord) => void;
	onLookup: (record: ManualRecoveryRecord) => void;
	onRetry: (record: ManualRecoveryRecord) => void;
	records: ManualRecoveryRecord[];
	t: Translate;
}) {
	const headingId = useId();
	if (records.length === 0) return null;
	return (
		<section aria-labelledby={headingId} className="grid gap-2 rounded-md border p-3">
			<div className="grid gap-0.5">
				<h3 id={headingId} className="text-sm font-medium">
					{t("timeTracking.manualEntry.recovery.title", "Unconfirmed entries")}
				</h3>
				<p className="text-xs text-muted-foreground">
					{t(
						"timeTracking.manualEntry.recovery.description",
						"These entries were sent from this tab without a confirmed result. Nothing is sent again unless you choose to.",
					)}
				</p>
			</div>
			<ul className="grid gap-2">
				{records.map((record) => {
					const command = frozenManualCommand(record);
					const status = recoveryStatusMessage(record);
					const busy = busyId !== null;
					const summary = t(
						"timeTracking.manualEntry.recovery.summary",
						"{date}, {clockIn}–{clockOut} ({timezone})",
						{
							date: command.date,
							clockIn: command.clockIn.time,
							clockOut: command.clockOut.time,
							timezone: command.zone.timezone,
						},
					);
					return (
						<li
							key={record.submissionId}
							aria-label={summary}
							className="grid gap-1.5 rounded-md bg-muted/50 p-2"
						>
							<p className="text-sm font-medium tabular-nums">{summary}</p>
							<p className="truncate text-xs text-muted-foreground">{command.reason}</p>
							<p className="text-xs">
								{t(status[0], status[1])}
								{record.code === MANUAL_ENTRY_CONTEXT_MISMATCH
									? ` ${t(MESSAGES.contextMismatch[0], MESSAGES.contextMismatch[1])}`
									: null}
							</p>
							<div className="flex flex-wrap gap-2">
								{record.status !== "conflict" ? (
									<>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={busy}
											onClick={() => onRetry(record)}
										>
											{busyId === record.submissionId ? (
												<IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" />
											) : null}
											{t("timeTracking.manualEntry.recovery.retry", "Retry exactly")}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={busy}
											onClick={() => onLookup(record)}
										>
											{t("timeTracking.manualEntry.recovery.check", "Check status")}
										</Button>
									</>
								) : null}
								{record.status === "not_committed" ? (
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={busy}
										onClick={() => onEditAsNew(record)}
									>
										{t("timeTracking.manualEntry.recovery.editAsNew", "Edit as new entry")}
									</Button>
								) : null}
								{canDiscardManualRecovery(record) ? (
									<Button
										type="button"
										size="sm"
										variant="ghost"
										disabled={busy}
										onClick={() => onDiscard(record)}
									>
										{t("timeTracking.manualEntry.recovery.discard", "Dismiss")}
									</Button>
								) : null}
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function ManualEntryFormContent({
	context,
	contextError,
	effectiveTimezone,
	form,
	isContextLoading,
	isTimezoneContinuationPending,
	onRetryContext,
	recoveryPanel,
	revalidationMessage,
	t,
	targetEmployeeId,
	targetEmployeeName,
}: {
	recoveryPanel: ReactNode;
	context: ManualEntryTargetContext | null;
	contextError: Error | null;
	effectiveTimezone: string | null;
	form: ManualEntryFormApi;
	isContextLoading: boolean;
	isTimezoneContinuationPending: boolean;
	onRetryContext: () => void;
	revalidationMessage: string;
	t: Translate;
	targetEmployeeId?: string;
	targetEmployeeName?: string;
}) {
	const validateTime = ({ value }: { value: string }) =>
		/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
			? undefined
			: t(
					"timeTracking.manualEntry.errors.invalidTime",
					"Enter a complete, valid time",
				);
	const isContextReady = Boolean(context && effectiveTimezone && !contextError);
	const isOwnEntry = context?.isOwnEntry ?? !targetEmployeeId;
	const selectorsLoading = isContextLoading || (!context && !contextError);

	return (
		<ActionPanelContent size="compact">
			<ActionPanelHeader>
				<ActionPanelTitle>
					{targetEmployeeName
						? t(
								"timeTracking.manualEntry.titleForEmployee",
								"Add Manual Time Entry for {employee}",
								{ employee: targetEmployeeName },
							)
						: t("timeTracking.manualEntry.title", "Add Manual Time Entry")}
				</ActionPanelTitle>
				<ActionPanelDescription>
					{t(
						"timeTracking.manualEntry.description",
						"Create a time entry for a past date. Approval may be required based on your organization's change policy.",
					)}
				</ActionPanelDescription>
			</ActionPanelHeader>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					form.handleSubmit();
				}}
				className="flex min-h-0 flex-col"
			>
				<ActionPanelBody className="grid gap-4">
					<TargetContextStatus
						context={context}
						effectiveTimezone={effectiveTimezone}
						error={contextError}
						isLoading={isContextLoading}
						onRetry={onRetryContext}
						t={t}
						targetEmployeeName={targetEmployeeName}
					/>
					{recoveryPanel}

					<form.Field
						name="date"
						listeners={{
							onChange: () => {
								form.setFieldValue("clockInOccurrence", undefined);
								form.setFieldValue("clockOutOccurrence", undefined);
							},
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("timeTracking.manualEntry.dateLabel", "Date")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<DatePicker
										name="date"
										value={field.state.value}
										onChange={field.handleChange}
										onBlur={field.handleBlur}
										max={
											effectiveTimezone
												? Temporal.Now.plainDateISO(
														effectiveTimezone,
													).toString()
												: undefined
										}
										required
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<div className="grid grid-cols-2 gap-4">
						<form.Field
							name="clockInTime"
							validators={{ onChange: validateTime, onSubmit: validateTime }}
							listeners={{
								onChange: () => form.setFieldValue("clockInOccurrence", undefined),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("timeTracking.manualEntry.clockInLabel", "Clock In")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<TimeInput
											name="clockInTime"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											onBlur={field.handleBlur}
											required
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						<form.Field
							name="clockOutTime"
							validators={{ onChange: validateTime, onSubmit: validateTime }}
							listeners={{
								onChange: () => form.setFieldValue("clockOutOccurrence", undefined),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("timeTracking.manualEntry.clockOutLabel", "Clock Out")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<TimeInput
											name="clockOutTime"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											onBlur={field.handleBlur}
											required
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>
					{context?.manualCommandVersion === 2 ? (
						<>
							<EndpointOccurrenceChoice
								endpoint="clockIn"
								form={form}
								t={t}
								timezone={effectiveTimezone}
							/>
							<EndpointOccurrenceChoice
								endpoint="clockOut"
								form={form}
								t={t}
								timezone={effectiveTimezone}
							/>
						</>
					) : null}

					<form.Field name="reason">
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("timeTracking.manualEntry.reasonLabel", "Reason")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Textarea
										name="reason"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"timeTracking.manualEntry.reasonPlaceholder",
											"Describe what you worked on…",
										)}
										required
										rows={2}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field name="projectId">
						{(field) => (
							<ProjectSelectorView
								value={field.state.value}
								onValueChange={field.handleChange}
								projects={context?.projects ?? []}
								isLoading={selectorsLoading}
								isError={Boolean(contextError)}
								persistPreference={isOwnEntry}
							/>
						)}
					</form.Field>
					<form.Field name="workCategoryId">
						{(field) => (
							<WorkCategorySelectorView
								employeeId={context?.targetEmployeeId ?? targetEmployeeId ?? ""}
								value={field.state.value}
								onValueChange={field.handleChange}
								categories={context?.categories ?? []}
								isLoading={selectorsLoading}
								isError={Boolean(contextError)}
								persistPreference={isOwnEntry}
							/>
						)}
					</form.Field>
					{/* Kept mounted so screen readers announce changes to it. */}
					<p
						role="status"
						className={
							revalidationMessage ? "text-xs text-muted-foreground" : "sr-only"
						}
					>
						{revalidationMessage}
					</p>
				</ActionPanelBody>

				<ActionPanelFooter className="gap-2">
					<ActionPanelClose asChild>
						<Button
							type="button"
							variant="outline"
							disabled={isTimezoneContinuationPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
					</ActionPanelClose>
					<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
						{(isSubmitting: boolean) => (
							<Button
								type="submit"
								disabled={
									isSubmitting ||
									isTimezoneContinuationPending ||
									!isContextReady
								}
							>
								{isSubmitting ? (
									<>
										<IconLoader2 className="size-4 animate-spin" />
										{t("timeTracking.manualEntry.submitting", "Creating…")}
									</>
								) : (
									t("timeTracking.manualEntry.submit", "Create Entry")
								)}
							</Button>
						)}
					</form.Subscribe>
				</ActionPanelFooter>
			</form>
		</ActionPanelContent>
	);
}

/**
 * Drop draft selections the current target cannot use. Changing the target
 * clears project/category choices and any pending timezone confirmation;
 * a refreshed context for the same target only drops choices that are no
 * longer eligible.
 */
function useTargetDraftRevalidation({
	context,
	form,
	open,
	setPendingMismatch,
	t,
	targetEmployeeId,
}: {
	context: ManualEntryTargetContext | null;
	form: ManualEntryFormApi;
	open: boolean;
	setPendingMismatch: (value: PendingMismatch | null) => void;
	t: Translate;
	targetEmployeeId?: string;
}) {
	const [message, setMessage] = useState("");
	const targetKey = targetEmployeeId ?? null;
	const previousTargetKeyRef = useRef(targetKey);

	useEffect(() => {
		if (previousTargetKeyRef.current === targetKey) return;
		previousTargetKeyRef.current = targetKey;

		const { projectId, workCategoryId } = form.state.values;
		form.setFieldValue("projectId", undefined);
		form.setFieldValue("workCategoryId", undefined);
		setPendingMismatch(null);
		setMessage(
			open && (projectId || workCategoryId)
				? t(
						"timeTracking.manualEntry.context.targetChanged",
						"The employee changed, so the project and category were cleared.",
					)
				: "",
		);
	}, [form, open, setPendingMismatch, t, targetKey]);

	useEffect(() => {
		if (!context) return;

		const { projectId, workCategoryId } = form.state.values;
		const projectIneligible =
			projectId !== undefined &&
			!context.projects.some((project) => project.id === projectId);
		const categoryIneligible =
			workCategoryId !== undefined &&
			!context.categories.some((category) => category.id === workCategoryId);

		if (projectIneligible) form.setFieldValue("projectId", undefined);
		if (categoryIneligible) form.setFieldValue("workCategoryId", undefined);
		if (projectIneligible || categoryIneligible) {
			setMessage(
				t(
					"timeTracking.manualEntry.context.choicesCleared",
					"A selected project or category is no longer available and was cleared.",
				),
			);
		}
	}, [context, form, t]);

	return { message, clearMessage: () => setMessage("") };
}

type ZoneChoice = { source: string; value: string } | null;

/**
 * The zone a draft is entered in. Self entries may continue in the browser zone
 * after updating the saved one; on-behalf entries always use the target's zone.
 */
function resolveManualEntryZone(
	context: ManualEntryTargetContext | null | undefined,
	continueOnceZone: ZoneChoice,
	timezoneOverride: ZoneChoice,
): { effectiveTimezone: string | null; zoneBasis: ManualZoneBasis } {
	const contextTimezone = context?.timezone ?? null;
	if (!contextTimezone || !context?.isOwnEntry) {
		return { effectiveTimezone: contextTimezone, zoneBasis: "target" };
	}
	if (context.manualCommandVersion === 2 && continueOnceZone?.source === contextTimezone) {
		return { effectiveTimezone: continueOnceZone.value, zoneBasis: "browser" };
	}
	return {
		effectiveTimezone:
			timezoneOverride?.source === contextTimezone ? timezoneOverride.value : contextTimezone,
		zoneBasis: "target",
	};
}

function announceCreatedEntry(
	result: Extract<ManualTimeEntryResult, { success: true }>,
	timezone: string,
	timeFormat: ReturnType<typeof useTimeFormat>,
	t: Translate,
) {
	// Show adjusted times info if times were modified
	if (result.data?.wasAdjusted && result.data.adjustedTimes) {
		const adjustedIn = formatTimeInZone(
			result.data.adjustedTimes.clockIn,
			timezone,
			false,
			timeFormat,
		);
		const adjustedOut = formatTimeInZone(
			result.data.adjustedTimes.clockOut,
			timezone,
			false,
			timeFormat,
		);
		toast.info(
			t(
				"timeTracking.manualEntry.success.adjusted",
				"Times adjusted to {clockIn} - {clockOut} to avoid overlap",
				{ clockIn: adjustedIn, clockOut: adjustedOut },
			),
			{ duration: 6000 },
		);
	}

	toast.success(
		result.data?.requiresApproval
			? t(
					"timeTracking.manualEntry.success.pendingApproval",
					"Time entry submitted for manager approval",
				)
			: t("timeTracking.manualEntry.success.created", "Time entry created successfully"),
	);
}

function announceRefusedEntry(
	result: Extract<ManualTimeEntryResult, { success: false }>,
	t: Translate,
) {
	const message = outcomeMessage(result);
	toast.error(
		message
			? t(message[0], message[1])
			: result.error ||
					t("timeTracking.manualEntry.errors.createFailed", "Failed to create time entry"),
	);
}

/** Recovery of this tab's frozen commands, acting on the stored records. */
function ConnectedManualRecoveryPanel({
	form,
	onCommitted,
	recovery,
	t,
}: {
	form: ReturnType<typeof useManualEntryForm>;
	onCommitted: () => void;
	recovery: ReturnType<typeof useManualCommandRecovery>;
	t: Translate;
}) {
	function refusalMessage(code: string, error: string) {
		return code === MANUAL_ENTRY_CONTEXT_MISMATCH
			? t(MESSAGES.contextMismatch[0], MESSAGES.contextMismatch[1])
			: error;
	}

	async function handleRecoveryRetry(record: ManualRecoveryRecord) {
		const outcome: ManualAttemptOutcome | null = await recovery.retry(record);
		if (!outcome) return;
		const { result, verdict } = outcome;
		if (verdict.kind === "committed" && result?.success) {
			onCommitted();
			toast.success(
				result.data.requiresApproval
					? t(
							"timeTracking.manualEntry.success.pendingApproval",
							"Time entry submitted for manager approval",
						)
					: t("timeTracking.manualEntry.success.created", "Time entry created successfully"),
			);
			return;
		}
		if (verdict.kind === "uncertain" || !result || result.success) {
			toast.error(t(MESSAGES.stillUncertain[0], MESSAGES.stillUncertain[1]));
			return;
		}
		if (verdict.kind === "refused") {
			toast.error(refusalMessage(verdict.code, result.error));
			return;
		}
		const message = outcomeMessage(result);
		toast.error(message ? t(message[0], message[1]) : result.error);
	}

	async function handleRecoveryLookup(record: ManualRecoveryRecord) {
		const outcome: ManualLookupOutcome | null = await recovery.lookup(record);
		if (!outcome) return;
		const { result } = outcome;
		switch (result?.status) {
			case "committed": {
				const { requiresApproval, currentApprovalStatus } = result.data;
				onCommitted();
				// The original outcome, with the current status read separately.
				const status = APPROVAL_STATUS_MESSAGES[currentApprovalStatus];
				toast.success(
					requiresApproval
						? t(MESSAGES.savedForApproval[0], MESSAGES.savedForApproval[1], {
								status: t(status[0], status[1]),
							})
						: t(MESSAGES.saved[0], MESSAGES.saved[1]),
				);
				return;
			}
			case "not_committed":
				toast.info(t(MESSAGES.notCommitted[0], MESSAGES.notCommitted[1]));
				return;
			case "conflict":
				toast.error(t(MESSAGES.collision[0], MESSAGES.collision[1]));
				return;
			case "unsupported":
				toast.error(t(MESSAGES.unsupported[0], MESSAGES.unsupported[1]));
				return;
			case "refused":
				toast.error(refusalMessage(result.code, result.error));
				return;
			default:
				toast.error(t(MESSAGES.checkFailed[0], MESSAGES.checkFailed[1]));
		}
	}

	/** Conclusively unsaved: its values become the editable draft for a fresh submission. */
	function handleRecoveryEditAsNew(record: ManualRecoveryRecord) {
		const command = frozenManualCommand(record);
		form.setFieldValue("date", command.date);
		form.setFieldValue("clockInTime", command.clockIn.time);
		form.setFieldValue("clockOutTime", command.clockOut.time);
		form.setFieldValue("reason", command.reason);
		form.setFieldValue("projectId", command.projectId ?? undefined);
		form.setFieldValue("workCategoryId", command.workCategoryId ?? undefined);
		recovery.discard(record);
	}

	return (
		<ManualRecoveryPanel
			busyId={recovery.busyId}
			onDiscard={recovery.discard}
			onEditAsNew={handleRecoveryEditAsNew}
			onLookup={(record) => void handleRecoveryLookup(record)}
			onRetry={(record) => void handleRecoveryRetry(record)}
			records={recovery.records}
			t={t}
		/>
	);
}

/**
 * Continuations after the browser and saved zones disagreed: update the saved
 * zone and submit, or submit once in the browser zone.
 */
function useTimezoneContinuation({
	context,
	pendingMismatch,
	setPendingMismatch,
	setTimezoneOverride,
	setContinueOnceZone,
	clearOccurrences,
	submitManualEntry,
	pendingRef,
	t,
}: {
	context: ManualEntryTargetContext | null;
	pendingMismatch: PendingMismatch | null;
	setPendingMismatch: (mismatch: PendingMismatch | null) => void;
	setTimezoneOverride: (zone: ZoneChoice) => void;
	setContinueOnceZone: (zone: ZoneChoice) => void;
	clearOccurrences: () => void;
	submitManualEntry: SubmitManualEntry;
	pendingRef: React.RefObject<boolean>;
	t: Translate;
}) {
	const queryClient = useQueryClient();
	const [isPending, setIsPending] = useState(false);
	const contextTimezone = context?.timezone ?? null;

	async function updateTimezoneAndSubmit() {
		if (!pendingMismatch || pendingRef.current) return;

		await runTimezoneContinuation(
			pendingRef,
			setIsPending,
			async () => {
				try {
					const result = await updateTimezone(pendingMismatch.browserTimezone);
					if (!result?.success) {
						toast.error(result?.error || "Failed to update timezone");
						return;
					}

					const { value, browserTimezone, submissionId, target } = pendingMismatch;
					if (contextTimezone) {
						setTimezoneOverride({
							source: contextTimezone,
							value: browserTimezone,
						});
					}
					setPendingMismatch(null);
					void queryClient.invalidateQueries({
						queryKey: queryKeys.manualEntry.all,
					});
					if (
						context?.manualCommandVersion === 2 &&
						needsReviewInZone(value, browserTimezone)
					) {
						clearOccurrences();
						toast.error(t(MESSAGES.occurrenceRequired[0], MESSAGES.occurrenceRequired[1]));
						return;
					}
					await submitManualEntry(
						value,
						browserTimezone,
						browserTimezone,
						submissionId,
						"target",
						target,
					);
				} catch {
					toast.error("An error occurred while updating timezone");
				}
			},
		);
	}

	async function continueOnce() {
		if (!pendingMismatch || pendingRef.current) return;

		await runTimezoneContinuation(
			pendingRef,
			setIsPending,
			async () => {
				const { value, browserTimezone, submissionId, target } = pendingMismatch;
				if (context?.manualCommandVersion === 2 && contextTimezone) {
					// The form now shows the browser zone; its choices apply there.
					setContinueOnceZone({ source: contextTimezone, value: browserTimezone });
					if (needsReviewInZone(value, browserTimezone)) {
						setPendingMismatch(null);
						clearOccurrences();
						toast.error(t(MESSAGES.occurrenceRequired[0], MESSAGES.occurrenceRequired[1]));
						return;
					}
				}
				await submitManualEntry(
					value,
					browserTimezone,
					browserTimezone,
					submissionId,
					"browser",
					target,
				);
				setPendingMismatch(null);
			},
		);
	}

	return { isPending, updateTimezoneAndSubmit, continueOnce };
}

export function ManualTimeEntryDialog({
	employeeId: _employeeId,
	employeeTimezone,
	hasManager: _hasManager,
	onSuccess,
	targetEmployeeId,
	targetEmployeeName,
	defaultDate,
	defaultClockInTime,
	defaultClockOutTime,
	open: controlledOpen,
	onOpenChange,
	hideTrigger = false,
}: Props) {
	const { t } = useTranslate();
	const [internalOpen, setInternalOpen] = useState(false);
	const [pendingMismatch, setPendingMismatch] =
		useState<PendingMismatch | null>(null);
	const [timezoneOverride, setTimezoneOverride] = useState<{
		source: string;
		value: string;
	} | null>(null);
	// Version-2 self entries continued once in the browser zone for this draft.
	const [continueOnceZone, setContinueOnceZone] = useState<{
		source: string;
		value: string;
	} | null>(null);
	const isTimezoneContinuationPendingRef = useRef(false);
	const wasOpenRef = useRef(false);
	const router = useRouter();
	const timeFormat = useTimeFormat();
	const open = controlledOpen ?? internalOpen;
	const targetContext = useManualEntryTargetContext(targetEmployeeId, open);
	const context = targetContext.context;
	const { effectiveTimezone, zoneBasis } = resolveManualEntryZone(
		context,
		continueOnceZone,
		timezoneOverride,
	);
	const defaultsTimezone = effectiveTimezone ?? employeeTimezone;
	// Callers may not know the target's name (e.g. a calendar opened by URL).
	const resolvedTargetName =
		targetEmployeeName ||
		(context && !context.isOwnEntry ? context.targetName : "") ||
		undefined;
	// Frozen commands belong to the session's user and organization and the target (#310).
	const recoveryScope: ManualRecoveryScope | null = context?.recoveryContext
		? {
				userId: context.recoveryContext.userId,
				organizationId: context.recoveryContext.organizationId,
				targetEmployeeId: context.targetEmployeeId,
			}
		: null;
	const recovery = useManualCommandRecovery(recoveryScope);

	async function submitManualEntry(
		value: FormValues,
		timezone: string,
		browserTimezone: string | null,
		submissionId: string,
		basis: ManualZoneBasis,
		target: ManualRecoveryScope | null,
	) {
		let result: ManualTimeEntryResult;
		if (context?.manualCommandVersion === 2) {
			if (!target) {
				toast.error(t(MESSAGES.refresh[0], MESSAGES.refresh[1]));
				return false;
			}
			// Built once, after zone and occurrence confirmation, for the target captured
			// at submit; the stored bytes are what every later retry sends.
			const built = buildManualCommand({
				value,
				targetEmployeeId: target.targetEmployeeId,
				timezone,
				basis,
				browserTimezone,
				submissionId,
			});
			if (!built.ok) {
				toast.error(t(built.message[0], built.message[1]));
				return false;
			}
			const attempt = await recovery.submit(target, built.command);
			if (attempt.verdict.kind === "uncertain" || !attempt.result) {
				toast.error(t(MESSAGES.uncertain[0], MESSAGES.uncertain[1]));
				return false;
			}
			result = attempt.result;
		} else {
			result = await createManualTimeEntry({
				submissionId,
				...(targetEmployeeId ? { employeeId: targetEmployeeId } : {}),
				date: value.date,
				clockInTime: value.clockInTime,
				clockOutTime: value.clockOutTime,
				reason: value.reason,
				timezone,
				browserTimezone,
				projectId: value.projectId,
				workCategoryId: value.workCategoryId,
			});
		}

		if (result.success) {
			announceCreatedEntry(result, timezone, timeFormat, t);
			handleOpenChange(false);
			router.refresh();
			onSuccess?.();
			return true;
		}
		announceRefusedEntry(result, t);
		if (needsReconfirmation(result)) clearOccurrences();
		// The server rejected the draft; refresh the advisory context so the
		// form reflects the target's current zone and eligible choices.
		void targetContext.refetch();
		return false;
	}

	const form = useManualEntryForm({
		commandVersion: context?.manualCommandVersion ?? 1,
		contextTargetEmployeeId: context?.targetEmployeeId ?? null,
		recoveryScope,
		zoneBasis,
		defaults: { defaultDate, defaultClockInTime, defaultClockOutTime },
		effectiveTimezone,
		setPendingMismatch,
		submitManualEntry,
		t,
		targetEmployeeId,
		isTimezoneContinuationPendingRef,
	});
	function clearOccurrences() {
		form.setFieldValue("clockInOccurrence", undefined);
		form.setFieldValue("clockOutOccurrence", undefined);
	}

	// A different target, zone or zone basis changes what a repeated time means.
	const occurrenceScope = `${targetEmployeeId ?? ""}|${effectiveTimezone ?? ""}|${zoneBasis}`;
	const occurrenceScopeRef = useRef(occurrenceScope);
	useEffect(() => {
		if (occurrenceScopeRef.current === occurrenceScope) return;
		occurrenceScopeRef.current = occurrenceScope;
		form.setFieldValue("clockInOccurrence", undefined);
		form.setFieldValue("clockOutOccurrence", undefined);
	}, [form, occurrenceScope]);

	const revalidation = useTargetDraftRevalidation({
		context,
		form,
		open,
		setPendingMismatch,
		t,
		targetEmployeeId,
	});

	const continuation = useTimezoneContinuation({
		context,
		pendingMismatch,
		setPendingMismatch,
		setTimezoneOverride,
		setContinueOnceZone,
		clearOccurrences,
		submitManualEntry,
		pendingRef: isTimezoneContinuationPendingRef,
		t,
	});

	const handleOpenChange = (isOpen: boolean) => {
		if (!isOpen) setContinueOnceZone(null);
		if (isOpen) {
			form.reset(
				getDefaultValues(defaultsTimezone, {
					defaultDate,
					defaultClockInTime,
					defaultClockOutTime,
				}),
			);
			revalidation.clearMessage();
		}
		if (controlledOpen === undefined) {
			setInternalOpen(isOpen);
		}
		onOpenChange?.(isOpen);
	};

	useEffect(() => {
		if (open && !wasOpenRef.current) {
			form.reset(
				getDefaultValues(defaultsTimezone, {
					defaultDate,
					defaultClockInTime,
					defaultClockOutTime,
				}),
			);
			revalidation.clearMessage();
			// Another dialog in this tab may have settled a frozen command.
			recovery.refresh();
		}
		wasOpenRef.current = open;
	});

	return (
		<>
			<ActionPanel open={open} onOpenChange={handleOpenChange}>
				{hideTrigger ? null : (
					<ActionPanelTrigger asChild>
						<Button
							aria-label={t(
								"timeTracking.manualEntry.addButton",
								"Add Manual Entry",
							)}
							className="size-8"
							variant="outline"
							size="icon"
						>
							<IconPlus aria-hidden="true" className="size-4" />
						</Button>
					</ActionPanelTrigger>
				)}
				<ManualEntryFormContent
					context={context}
					contextError={targetContext.error}
					effectiveTimezone={effectiveTimezone}
					form={form}
					isContextLoading={targetContext.isLoading}
					isTimezoneContinuationPending={continuation.isPending}
					onRetryContext={() => void targetContext.refetch()}
					recoveryPanel={
						<ConnectedManualRecoveryPanel
							form={form}
							onCommitted={() => {
								router.refresh();
								onSuccess?.();
							}}
							recovery={recovery}
							t={t}
						/>
					}
					revalidationMessage={revalidation.message}
					t={t}
					targetEmployeeId={targetEmployeeId}
					targetEmployeeName={resolvedTargetName}
				/>
			</ActionPanel>
			{pendingMismatch && effectiveTimezone ? (
				<TimezoneMismatchDialog
					open
					savedTimezone={effectiveTimezone}
					browserTimezone={pendingMismatch.browserTimezone}
					isPending={continuation.isPending}
					onUpdateAndContinue={continuation.updateTimezoneAndSubmit}
					onContinueOnce={continuation.continueOnce}
					onCancel={() => setPendingMismatch(null)}
				/>
			) : null}
		</>
	);
}
