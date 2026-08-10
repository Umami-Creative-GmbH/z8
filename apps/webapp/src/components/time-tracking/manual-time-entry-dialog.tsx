"use client";

import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { updateTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { createManualTimeEntry } from "@/app/[locale]/(app)/time-tracking/actions";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { ProjectSelector } from "@/components/time-tracking/project-selector";
import { TimezoneMismatchDialog } from "@/components/time-tracking/timezone-mismatch-dialog";
import { WorkCategorySelector } from "@/components/time-tracking/work-category-selector";
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
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput } from "@/components/ui/time-input";
import { getBrowserTimezone } from "@/lib/time-tracking/timezone-capture";
import {
	formatTimeInZone,
	getTimezoneAbbreviation,
} from "@/lib/time-tracking/timezone-utils";
import { useRouter } from "@/navigation";

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
}

type Translate = ReturnType<typeof useTranslate>["t"];
type PendingMismatch = {
	value: FormValues;
	browserTimezone: string;
	submissionId: string;
};
type SubmitManualEntry = (
	value: FormValues,
	timezone: string,
	browserTimezone: string | null,
	submissionId: string,
) => Promise<boolean>;

function getDefaultValues(
	employeeTimezone: string,
	defaults: Pick<
		Props,
		"defaultDate" | "defaultClockInTime" | "defaultClockOutTime"
	>,
): FormValues {
	const today = DateTime.now().setZone(employeeTimezone).toISODate() || "";
	return {
		date: defaults.defaultDate ?? today,
		clockInTime: defaults.defaultClockInTime ?? "09:00",
		clockOutTime: defaults.defaultClockOutTime ?? "17:00",
		reason: "",
		projectId: undefined,
		workCategoryId: undefined,
	};
}

function useManualEntryForm({
	defaults,
	employeeTimezone,
	setPendingMismatch,
	submitManualEntry,
	t,
	targetEmployeeId,
	isTimezoneContinuationPendingRef,
}: {
	defaults: Pick<
		Props,
		"defaultDate" | "defaultClockInTime" | "defaultClockOutTime"
	>;
	employeeTimezone: string;
	setPendingMismatch: (value: PendingMismatch) => void;
	submitManualEntry: SubmitManualEntry;
	t: Translate;
	targetEmployeeId?: string;
	isTimezoneContinuationPendingRef: React.RefObject<boolean>;
}) {
	return useForm({
		defaultValues: getDefaultValues(employeeTimezone, defaults),
		onSubmit: async ({ value }) => {
			if (isTimezoneContinuationPendingRef.current) return;

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

			const selectedDate = DateTime.fromISO(value.date, {
				zone: employeeTimezone,
			});
			const now = DateTime.now().setZone(employeeTimezone);
			if (selectedDate.startOf("day") > now.startOf("day")) {
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

			const browserTimezone = getBrowserTimezone();
			const submissionId = crypto.randomUUID();
			if (
				!targetEmployeeId &&
				browserTimezone &&
				browserTimezone !== employeeTimezone
			) {
				setPendingMismatch({ value, browserTimezone, submissionId });
				return;
			}

			await submitManualEntry(
				value,
				employeeTimezone,
				!targetEmployeeId && browserTimezone === employeeTimezone
					? browserTimezone
					: null,
				submissionId,
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

function ManualEntryFormContent({
	employeeId,
	employeeTimezone,
	form,
	isTimezoneContinuationPending,
	t,
	targetEmployeeId,
	targetEmployeeName,
	timezoneAbbr,
}: {
	employeeId: string;
	employeeTimezone: string;
	form: ManualEntryFormApi;
	isTimezoneContinuationPending: boolean;
	t: Translate;
	targetEmployeeId?: string;
	targetEmployeeName?: string;
	timezoneAbbr: string;
}) {
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
					<p className="text-xs text-muted-foreground">
						{t(
							"timeTracking.correction.timezoneNote",
							"Times are in your local timezone ({timezone})",
							{ timezone: timezoneAbbr },
						)}
					</p>

					<form.Field name="date">
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
											DateTime.now().setZone(employeeTimezone).toISODate() ||
											undefined
										}
										required
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<div className="grid grid-cols-2 gap-4">
						<form.Field name="clockInTime">
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
						<form.Field name="clockOutTime">
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
							<ProjectSelector
								value={field.state.value}
								onValueChange={field.handleChange}
							/>
						)}
					</form.Field>
					<form.Field name="workCategoryId">
						{(field) => (
							<WorkCategorySelector
								employeeId={targetEmployeeId ?? employeeId}
								value={field.state.value}
								onValueChange={field.handleChange}
							/>
						)}
					</form.Field>
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
								disabled={isSubmitting || isTimezoneContinuationPending}
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

export function ManualTimeEntryDialog({
	employeeId,
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
	const [isTimezoneContinuationPending, setIsTimezoneContinuationPending] =
		useState(false);
	const [timezoneOverride, setTimezoneOverride] = useState<{
		source: string;
		value: string;
	} | null>(null);
	const isTimezoneContinuationPendingRef = useRef(false);
	const wasOpenRef = useRef(false);
	const router = useRouter();
	const timeFormat = useTimeFormat();
	const effectiveEmployeeTimezone =
		timezoneOverride?.source === employeeTimezone
			? timezoneOverride.value
			: employeeTimezone;
	const timezoneAbbr = getTimezoneAbbreviation(effectiveEmployeeTimezone);
	const open = controlledOpen ?? internalOpen;

	async function submitManualEntry(
		value: FormValues,
		timezone: string,
		browserTimezone: string | null,
		submissionId: string,
	) {
		const result = await createManualTimeEntry({
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

		if (result.success) {
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

			if (result.data?.requiresApproval) {
				toast.success(
					t(
						"timeTracking.manualEntry.success.pendingApproval",
						"Time entry submitted for manager approval",
					),
				);
			} else {
				toast.success(
					t(
						"timeTracking.manualEntry.success.created",
						"Time entry created successfully",
					),
				);
			}
			handleOpenChange(false);
			router.refresh();
			onSuccess?.();
			return true;
		} else {
			toast.error(
				result.error ||
					t(
						"timeTracking.manualEntry.errors.createFailed",
						"Failed to create time entry",
					),
			);
			return false;
		}
	}

	const form = useManualEntryForm({
		defaults: { defaultDate, defaultClockInTime, defaultClockOutTime },
		employeeTimezone: effectiveEmployeeTimezone,
		setPendingMismatch,
		submitManualEntry,
		t,
		targetEmployeeId,
		isTimezoneContinuationPendingRef,
	});

	async function handleUpdateTimezoneAndSubmit() {
		if (!pendingMismatch || isTimezoneContinuationPendingRef.current) return;

		await runTimezoneContinuation(
			isTimezoneContinuationPendingRef,
			setIsTimezoneContinuationPending,
			async () => {
				try {
					const result = await updateTimezone(pendingMismatch.browserTimezone);
					if (!result?.success) {
						toast.error(result?.error || "Failed to update timezone");
						return;
					}

					const { value, browserTimezone, submissionId } = pendingMismatch;
					setTimezoneOverride({
						source: employeeTimezone,
						value: browserTimezone,
					});
					setPendingMismatch(null);
					await submitManualEntry(
						value,
						browserTimezone,
						browserTimezone,
						submissionId,
					);
				} catch {
					toast.error("An error occurred while updating timezone");
				}
			},
		);
	}

	async function handleContinueOnce() {
		if (!pendingMismatch || isTimezoneContinuationPendingRef.current) return;

		await runTimezoneContinuation(
			isTimezoneContinuationPendingRef,
			setIsTimezoneContinuationPending,
			async () => {
				const { value, browserTimezone, submissionId } = pendingMismatch;
				await submitManualEntry(
					value,
					browserTimezone,
					browserTimezone,
					submissionId,
				);
				setPendingMismatch(null);
			},
		);
	}

	const handleOpenChange = (isOpen: boolean) => {
		if (isOpen) {
			form.reset(
				getDefaultValues(effectiveEmployeeTimezone, {
					defaultDate,
					defaultClockInTime,
					defaultClockOutTime,
				}),
			);
		}
		if (controlledOpen === undefined) {
			setInternalOpen(isOpen);
		}
		onOpenChange?.(isOpen);
	};

	useEffect(() => {
		if (open && !wasOpenRef.current) {
			form.reset(
				getDefaultValues(effectiveEmployeeTimezone, {
					defaultDate,
					defaultClockInTime,
					defaultClockOutTime,
				}),
			);
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
					employeeId={employeeId}
					employeeTimezone={effectiveEmployeeTimezone}
					form={form}
					isTimezoneContinuationPending={isTimezoneContinuationPending}
					t={t}
					targetEmployeeId={targetEmployeeId}
					targetEmployeeName={targetEmployeeName}
					timezoneAbbr={timezoneAbbr}
				/>
			</ActionPanel>
			{pendingMismatch ? (
				<TimezoneMismatchDialog
					open
					savedTimezone={effectiveEmployeeTimezone}
					browserTimezone={pendingMismatch.browserTimezone}
					isPending={isTimezoneContinuationPending}
					onUpdateAndContinue={handleUpdateTimezoneAndSubmit}
					onContinueOnce={handleContinueOnce}
					onCancel={() => setPendingMismatch(null)}
				/>
			) : null}
		</>
	);
}
