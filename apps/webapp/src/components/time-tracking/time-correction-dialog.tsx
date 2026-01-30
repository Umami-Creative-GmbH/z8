"use client";

import { useForm } from "@tanstack/react-form";
import { IconEdit, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	editSameDayTimeEntry,
	requestTimeCorrection,
} from "@/app/[locale]/(app)/time-tracking/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	fieldHasError,
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { formatTimeInZone, getTimezoneAbbreviation } from "@/lib/time-tracking/timezone-utils";

interface WorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
	clockOut?: { notes: string | null } | null;
}

interface Props {
	workPeriod: WorkPeriodData;
	isSameDay: boolean;
	employeeTimezone: string;
}

interface FormValues {
	clockInTime: string;
	clockOutTime: string;
	reason: string;
}

export function TimeCorrectionDialog({ workPeriod, isSameDay, employeeTimezone }: Props) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const router = useRouter();
	const timezoneAbbr = getTimezoneAbbreviation(employeeTimezone);

	const getDefaultValues = (): FormValues => ({
		clockInTime: formatTimeInZone(workPeriod.startTime, employeeTimezone),
		clockOutTime: workPeriod.endTime ? formatTimeInZone(workPeriod.endTime, employeeTimezone) : "",
		reason: workPeriod.clockOut?.notes || "",
	});

	const form = useForm({
		defaultValues: getDefaultValues(),
		onSubmit: async ({ value }) => {
			// Validate time span - clock out must be after clock in
			if (value.clockOutTime) {
				const [inHours, inMinutes] = value.clockInTime.split(":").map(Number);
				const [outHours, outMinutes] = value.clockOutTime.split(":").map(Number);
				const clockInMinutes = inHours * 60 + inMinutes;
				const clockOutMinutes = outHours * 60 + outMinutes;

				if (clockOutMinutes <= clockInMinutes) {
					toast.error(
						t(
							"timeTracking.correction.errors.invalidTimeRange",
							"Clock out time must be after clock in time",
						),
					);
					return;
				}
			}

			if (isSameDay) {
				const result = await editSameDayTimeEntry({
					workPeriodId: workPeriod.id,
					newClockInTime: value.clockInTime,
					newClockOutTime: value.clockOutTime || undefined,
					reason: value.reason || undefined,
				});

				if (result.success) {
					toast.success(
						t("timeTracking.correction.success.updated", "Time entry updated successfully"),
					);
					setOpen(false);
					router.refresh();
				} else {
					toast.error(
						result.error ||
							t("timeTracking.correction.errors.updateFailed", "Failed to update time entry"),
					);
				}
			} else {
				const result = await requestTimeCorrection({
					workPeriodId: workPeriod.id,
					newClockInTime: value.clockInTime,
					newClockOutTime: value.clockOutTime || undefined,
					reason: value.reason,
				});

				if (result.success) {
					toast.success(
						t(
							"timeTracking.correction.success.submitted",
							"Correction request submitted for manager approval",
						),
					);
					setOpen(false);
				} else {
					toast.error(
						result.error ||
							t("timeTracking.correction.errors.submitFailed", "Failed to submit correction"),
					);
				}
			}
		},
	});

	const handleOpenChange = (isOpen: boolean) => {
		if (isOpen) {
			form.reset(getDefaultValues());
		}
		setOpen(isOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="icon">
					<IconEdit className="size-4" />
					<span className="sr-only">
						{isSameDay
							? t("timeTracking.correction.editEntry", "Edit time entry")
							: t("timeTracking.correction.requestCorrection", "Request time correction")}
					</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{isSameDay
							? t("timeTracking.correction.editTitle", "Edit Time Entry")
							: t("timeTracking.correction.requestTitle", "Request Time Correction")}
					</DialogTitle>
					<DialogDescription>
						{isSameDay
							? t(
									"timeTracking.correction.editDescription",
									"Make changes to your time entry for today.",
								)
							: t(
									"timeTracking.correction.requestDescription",
									"Submit a correction request for this time entry. Your manager will need to approve it.",
								)}
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<div className="grid gap-4 py-4">
						<p className="text-xs text-muted-foreground">
							{t(
								"timeTracking.correction.timezoneNote",
								"Times are in your local timezone ({timezone})",
								{ timezone: timezoneAbbr },
							)}
						</p>
						<div className="grid grid-cols-2 gap-4">
							<form.Field name="clockInTime">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("timeTracking.correction.clockIn", "Clock In")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												type="time"
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

							{workPeriod.endTime && (
								<form.Field name="clockOutTime">
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={fieldHasError(field)}>
												{t("timeTracking.correction.clockOut", "Clock Out")}
											</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<Input
													type="time"
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
							)}
						</div>

						<form.Field name="reason">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{isSameDay
											? t("timeTracking.correction.noteLabel", "Note (optional)")
											: t("timeTracking.correction.reasonLabel", "Reason for Correction")}
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
					</div>

					<DialogFooter className="gap-2 sm:gap-0">
						<DialogClose asChild>
							<Button type="button" variant="outline">
								{t("common.cancel", "Cancel")}
							</Button>
						</DialogClose>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? (
										<>
											<IconLoader2 className="size-4 animate-spin" />
											{isSameDay
												? t("timeTracking.correction.saving", "Saving…")
												: t("timeTracking.correction.submitting", "Submitting…")}
										</>
									) : isSameDay ? (
										t("timeTracking.correction.saveChanges", "Save Changes")
									) : (
										t("timeTracking.correction.submitRequest", "Submit Request")
									)}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
