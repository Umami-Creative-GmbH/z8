"use client";

import { IconAlertCircle, IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { updateTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { createManualTimeEntry } from "@/app/[locale]/(app)/time-tracking/actions";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { ProjectSelectorView } from "@/components/time-tracking/project-selector";
import { TimezoneMismatchDialog } from "@/components/time-tracking/timezone-mismatch-dialog";
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
	defaults,
	effectiveTimezone,
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

			const browserTimezone = getBrowserTimezone();
			const submissionId = crypto.randomUUID();
			if (
				!targetEmployeeId &&
				browserTimezone &&
				browserTimezone !== effectiveTimezone
			) {
				setPendingMismatch({ value, browserTimezone, submissionId });
				return;
			}

			await submitManualEntry(
				value,
				effectiveTimezone,
				!targetEmployeeId && browserTimezone === effectiveTimezone
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

function ManualEntryFormContent({
	context,
	contextError,
	effectiveTimezone,
	form,
	isContextLoading,
	isTimezoneContinuationPending,
	onRetryContext,
	revalidationMessage,
	t,
	targetEmployeeId,
	targetEmployeeName,
}: {
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
	const queryClient = useQueryClient();
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
	const open = controlledOpen ?? internalOpen;
	const targetContext = useManualEntryTargetContext(targetEmployeeId, open);
	const context = targetContext.context;
	const contextTimezone = context?.timezone ?? null;
	// Self entries may continue in the browser zone after updating the saved one;
	// on-behalf entries always use the target's zone.
	const effectiveTimezone =
		contextTimezone &&
		context?.isOwnEntry &&
		timezoneOverride?.source === contextTimezone
			? timezoneOverride.value
			: contextTimezone;
	const defaultsTimezone = effectiveTimezone ?? employeeTimezone;

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
			// The server rejected the draft; refresh the advisory context so the
			// form reflects the target's current zone and eligible choices.
			void targetContext.refetch();
			return false;
		}
	}

	const form = useManualEntryForm({
		defaults: { defaultDate, defaultClockInTime, defaultClockOutTime },
		effectiveTimezone,
		setPendingMismatch,
		submitManualEntry,
		t,
		targetEmployeeId,
		isTimezoneContinuationPendingRef,
	});
	const revalidation = useTargetDraftRevalidation({
		context,
		form,
		open,
		setPendingMismatch,
		t,
		targetEmployeeId,
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
					isTimezoneContinuationPending={isTimezoneContinuationPending}
					onRetryContext={() => void targetContext.refetch()}
					revalidationMessage={revalidation.message}
					t={t}
					targetEmployeeId={targetEmployeeId}
					targetEmployeeName={targetEmployeeName}
				/>
			</ActionPanel>
			{pendingMismatch && effectiveTimezone ? (
				<TimezoneMismatchDialog
					open
					savedTimezone={effectiveTimezone}
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
