"use client";

import { IconEdit, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import {
	editSameDayTimeEntry,
	requestTimeCorrection,
} from "@/app/[locale]/(app)/time-tracking/actions/corrections";
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
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput } from "@/components/ui/time-input";
import { getTimezoneAbbreviation } from "@/lib/time-tracking/timezone-utils";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import { useRouter } from "@/navigation";
import { WorkLocationSelector } from "./clock-in-out-widget-parts";
import {
	getTimeCorrectionDefaultValues,
	hasTimeCorrectionChanges,
	isDirectSameDayEdit,
	isValidClockRange,
	type TimeCorrectionFormValues,
} from "./time-correction-dialog-utils";
import { WorkCategorySelector } from "./work-category-selector";

interface WorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
	clockOut?: { notes: string | null } | null;
	workLocationType: WorkLocationType | "field" | null;
	workCategoryId: string | null;
}

interface Props {
	workPeriod: WorkPeriodData;
	employeeId: string;
	isSameDay: boolean;
	employeeTimezone: string;
}

type Translate = ReturnType<typeof useTranslate>["t"];

function CorrectionTrigger({
	isSameDay,
	t,
}: {
	isSameDay: boolean;
	t: Translate;
}) {
	return (
		<ActionPanelTrigger asChild>
			<Button variant="ghost" size="icon">
				<IconEdit className="size-4" />
				<span className="sr-only">
					{isSameDay
						? t("timeTracking.correction.editEntry", "Edit time entry")
						: t(
								"timeTracking.correction.requestCorrection",
								"Request time correction",
							)}
				</span>
			</Button>
		</ActionPanelTrigger>
	);
}

function CorrectionHeader({
	isSameDay,
	t,
}: {
	isSameDay: boolean;
	t: Translate;
}) {
	return (
		<ActionPanelHeader>
			<ActionPanelTitle>
				{isSameDay
					? t("timeTracking.correction.editTitle", "Edit Time Entry")
					: t(
							"timeTracking.correction.requestTitle",
							"Request Time Correction",
						)}
			</ActionPanelTitle>
			<ActionPanelDescription>
				{isSameDay
					? t(
							"timeTracking.correction.editDescription",
							"Make changes to your time entry for today.",
						)
					: t(
							"timeTracking.correction.requestDescription",
							"Submit a correction request for this time entry. Your manager will need to approve it.",
						)}
			</ActionPanelDescription>
		</ActionPanelHeader>
	);
}

function TimeEndpointRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<fieldset className="grid min-w-0 grid-cols-2 content-start gap-2 @[24rem]/correction:grid-cols-[minmax(6rem,8rem)_minmax(0,1fr)_minmax(0,1fr)] @[24rem]/correction:items-start">
			<legend className="col-span-2 min-w-0 break-words pb-2 font-medium text-sm @[24rem]/correction:col-span-1 @[24rem]/correction:pb-0 @[24rem]/correction:pt-2">
				{label}
			</legend>
			{children}
		</fieldset>
	);
}

async function submitTimeCorrection({
	employeeTimezone,
	isSameDay,
	onClose,
	onRefresh,
	submissionIdRef,
	t,
	value,
	workPeriod,
}: {
	employeeTimezone: string;
	isSameDay: boolean;
	onClose: () => void;
	onRefresh: () => void;
	submissionIdRef: { current: string | null };
	t: Translate;
	value: TimeCorrectionFormValues;
	workPeriod: WorkPeriodData;
}) {
	if (
		!isValidClockRange(
			value.clockInDate,
			value.clockInTime,
			value.clockOutDate,
			value.clockOutTime,
		)
	) {
		toast.error(
			t(
				"timeTracking.correction.errors.invalidTimeRange",
				"Clock out time must be after clock in time",
			),
		);
		return;
	}

	if (
		!hasTimeCorrectionChanges({ workPeriod, employeeTimezone, values: value })
	) {
		toast.error(
			t(
				"timeTracking.correction.errors.noChanges",
				"At least one correction value must change",
			),
		);
		return;
	}

	if (
		isDirectSameDayEdit({
			isSameDay,
			workPeriod,
			employeeTimezone,
			values: value,
		})
	) {
		const result = await editSameDayTimeEntry({
			workPeriodId: workPeriod.id,
			newClockInDate: value.clockInDate,
			newClockInTime: value.clockInTime,
			newClockOutDate: value.clockOutDate || undefined,
			newClockOutTime: value.clockOutTime || undefined,
			reason: value.reason || undefined,
			workLocationType: value.workLocationType,
			workCategoryId: value.workCategoryId,
		});

		if (result.success) {
			toast.success(
				t(
					"timeTracking.correction.success.updated",
					"Time entry updated successfully",
				),
			);
			onClose();
			onRefresh();
		} else {
			toast.error(
				result.error ||
					t(
						"timeTracking.correction.errors.updateFailed",
						"Failed to update time entry",
					),
			);
		}
		return;
	}

	const submissionId =
		submissionIdRef.current ?? globalThis.crypto.randomUUID();
	submissionIdRef.current = submissionId;
	const result = await requestTimeCorrection({
		workPeriodId: workPeriod.id,
		submissionId,
		newClockInDate: value.clockInDate,
		newClockInTime: value.clockInTime,
		newClockOutDate: value.clockOutDate || undefined,
		newClockOutTime: value.clockOutTime || undefined,
		reason: value.reason,
		workLocationType: value.workLocationType,
		workCategoryId: value.workCategoryId,
	});

	if (result.success) {
		submissionIdRef.current = null;
		toast.success(
			result.data.status === "approved"
				? t(
						"timeTracking.correction.success.applied",
						"Correction applied successfully",
					)
				: t(
						"timeTracking.correction.success.submitted",
						"Correction request submitted for manager approval",
					),
		);
		onClose();
		if (result.data.status === "approved") onRefresh();
	} else {
		toast.error(
			result.error ||
				t(
					"timeTracking.correction.errors.submitFailed",
					"Failed to submit correction",
				),
		);
	}
}

export function TimeCorrectionDialog({
	workPeriod,
	employeeId,
	isSameDay,
	employeeTimezone,
}: Props) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const submissionIdRef = useRef<string | null>(null);
	const router = useRouter();
	const timezoneAbbr = getTimezoneAbbreviation(employeeTimezone);

	const getDefaultValues = (): TimeCorrectionFormValues =>
		getTimeCorrectionDefaultValues(workPeriod, employeeTimezone);

	const form = useForm({
		defaultValues: getDefaultValues(),
		onSubmit: ({ value }) =>
			submitTimeCorrection({
				employeeTimezone,
				isSameDay,
				onClose: () => setOpen(false),
				onRefresh: router.refresh,
				submissionIdRef,
				t,
				value,
				workPeriod,
			}),
	});

	const handleOpenChange = (isOpen: boolean) => {
		if (isOpen) {
			submissionIdRef.current = null;
			form.reset(getDefaultValues());
		}
		setOpen(isOpen);
	};

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<CorrectionTrigger isSameDay={isSameDay} t={t} />
			<ActionPanelContent size="compact">
				<CorrectionHeader isSameDay={isSameDay} t={t} />
				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<ActionPanelBody className="@container/correction grid content-start gap-4">
						<p className="text-xs text-muted-foreground">
							{t(
								"timeTracking.correction.timezoneNote",
								"Times are in your local timezone ({timezone})",
								{ timezone: timezoneAbbr },
							)}
						</p>
						<TimeEndpointRow
							label={t("timeTracking.correction.clockIn", "Clock in")}
						>
							<form.Field name="clockInDate">
								{(field) => (
									<TFormItem className="min-w-0">
										<TFormLabel
											className="sr-only"
											hasError={fieldHasError(field)}
											required
										>
											{t(
												"timeTracking.correction.clockInDate",
												"Clock in date",
											)}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												type="date"
												name="clockInDate"
												autoComplete="off"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												required
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>

							<form.Field name="clockInTime">
								{(field) => (
									<TFormItem className="min-w-0">
										<TFormLabel
											className="sr-only"
											hasError={fieldHasError(field)}
										>
											{t(
												"timeTracking.correction.clockInTime",
												"Clock in time",
											)}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<TimeInput
												name="clockInTime"
												autoComplete="off"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												required
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						</TimeEndpointRow>

						{workPeriod.endTime && (
							<TimeEndpointRow
								label={t("timeTracking.correction.clockOut", "Clock out")}
							>
								<form.Field name="clockOutDate">
									{(field) => (
										<TFormItem className="min-w-0">
											<TFormLabel
												className="sr-only"
												hasError={fieldHasError(field)}
												required
											>
												{t(
													"timeTracking.correction.clockOutDate",
													"Clock out date",
												)}
											</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<Input
													type="date"
													name="clockOutDate"
													autoComplete="off"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
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
										<TFormItem className="min-w-0">
											<TFormLabel
												className="sr-only"
												hasError={fieldHasError(field)}
											>
												{t(
													"timeTracking.correction.clockOutTime",
													"Clock out time",
												)}
											</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<TimeInput
													name="clockOutTime"
													autoComplete="off"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
												/>
											</TFormControl>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>
							</TimeEndpointRow>
						)}

						<form.Field name="workLocationType">
							{(field) => (
								<div className="@container/widget min-w-0">
									<fieldset className="grid min-w-0 gap-2">
										<legend className="font-medium text-sm">
											{t("timeTracking.workLocation", "Work location")}
										</legend>
										<WorkLocationSelector
											value={field.state.value}
											onChange={field.handleChange}
											t={t}
										/>
									</fieldset>
								</div>
							)}
						</form.Field>

						<form.Field name="workCategoryId">
							{(field) => (
								<WorkCategorySelector
									employeeId={employeeId}
									value={field.state.value ?? undefined}
									onValueChange={(value) => field.handleChange(value ?? null)}
									persistPreference={false}
								/>
							)}
						</form.Field>

						<form.Field name="reason">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{isSameDay
											? t(
													"timeTracking.correction.noteLabel",
													"Note (optional)",
												)
											: t(
													"timeTracking.correction.reasonLabel",
													"Reason for Correction",
												)}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											name="reason"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={
												isSameDay
													? t(
															"timeTracking.correction.notePlaceholder",
															"Add a note about this change…",
														)
													: t(
															"timeTracking.correction.reasonPlaceholder",
															"Explain why this correction is needed…",
														)
											}
											required={!isSameDay}
											rows={2}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter className="gap-2 sm:gap-0">
						<ActionPanelClose asChild>
							<Button type="button" variant="outline">
								{t("common.cancel", "Cancel")}
							</Button>
						</ActionPanelClose>
						<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
							{(isSubmitting: boolean) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? (
										<>
											<IconLoader2 className="size-4 animate-spin" />
											{isSameDay
												? t("timeTracking.correction.saving", "Saving…")
												: t(
														"timeTracking.correction.submitting",
														"Submitting…",
													)}
										</>
									) : isSameDay ? (
										t("timeTracking.correction.saveChanges", "Save Changes")
									) : (
										t("timeTracking.correction.submitRequest", "Submit Request")
									)}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
