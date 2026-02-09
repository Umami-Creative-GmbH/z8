"use client";

import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import { createManualTimeEntry } from "@/app/[locale]/(app)/time-tracking/actions";
import { ProjectSelector } from "@/components/time-tracking/project-selector";
import { WorkCategorySelector } from "@/components/time-tracking/work-category-selector";
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
import {
	fieldHasError,
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { getTimezoneAbbreviation } from "@/lib/time-tracking/timezone-utils";
import { useRouter } from "@/navigation";

interface Props {
	employeeId: string;
	employeeTimezone: string;
	hasManager: boolean;
	onSuccess?: () => void;
}

interface FormValues {
	date: string;
	clockInTime: string;
	clockOutTime: string;
	reason: string;
	projectId: string | undefined;
	workCategoryId: string | undefined;
}

export function ManualTimeEntryDialog({
	employeeId,
	employeeTimezone,
	hasManager: _hasManager,
	onSuccess,
}: Props) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const router = useRouter();
	const timezoneAbbr = getTimezoneAbbreviation(employeeTimezone);

	// Default to today's date
	const getDefaultValues = (): FormValues => {
		const today = DateTime.now().setZone(employeeTimezone).toISODate() || "";
		return {
			date: today,
			clockInTime: "09:00",
			clockOutTime: "17:00",
			reason: "",
			projectId: undefined,
			workCategoryId: undefined,
		};
	};

	const form = useForm({
		defaultValues: getDefaultValues(),
		onSubmit: async ({ value }) => {
			// Validate time span - clock out must be after clock in
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

			// Validate date is not in the future
			const selectedDate = DateTime.fromISO(value.date, { zone: employeeTimezone });
			const now = DateTime.now().setZone(employeeTimezone);
			if (selectedDate.startOf("day") > now.startOf("day")) {
				toast.error(
					t("timeTracking.manualEntry.errors.futureDate", "Cannot create entries for future dates"),
				);
				return;
			}

			// Validate work period duration (max 24 hours)
			const durationMinutes = clockOutMinutes - clockInMinutes;
			if (durationMinutes > 24 * 60) {
				toast.error(
					t("timeTracking.manualEntry.errors.tooLong", "Work period cannot exceed 24 hours"),
				);
				return;
			}

			const result = await createManualTimeEntry({
				date: value.date,
				clockInTime: value.clockInTime,
				clockOutTime: value.clockOutTime,
				reason: value.reason,
				projectId: value.projectId,
				workCategoryId: value.workCategoryId,
			});

			if (result.success) {
				// Show adjusted times info if times were modified
				if (result.data?.wasAdjusted && result.data.adjustedTimes) {
					const adjustedIn = DateTime.fromISO(result.data.adjustedTimes.clockIn)
						.setZone(employeeTimezone)
						.toFormat("HH:mm");
					const adjustedOut = DateTime.fromISO(result.data.adjustedTimes.clockOut)
						.setZone(employeeTimezone)
						.toFormat("HH:mm");
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
						t("timeTracking.manualEntry.success.created", "Time entry created successfully"),
					);
				}
				setOpen(false);
				router.refresh();
				onSuccess?.();
			} else {
				toast.error(
					result.error ||
						t("timeTracking.manualEntry.errors.createFailed", "Failed to create time entry"),
				);
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
				<Button variant="outline" size="sm">
					<IconPlus className="size-4" />
					{t("timeTracking.manualEntry.addButton", "Add Manual Entry")}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("timeTracking.manualEntry.title", "Add Manual Time Entry")}</DialogTitle>
					<DialogDescription>
						{t(
							"timeTracking.manualEntry.description",
							"Create a time entry for a past date. Approval may be required based on your organization's change policy.",
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

						{/* Date Field */}
						<form.Field name="date">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("timeTracking.manualEntry.dateLabel", "Date")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											type="date"
											name="date"
											autoComplete="off"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											max={DateTime.now().setZone(employeeTimezone).toISODate() || undefined}
											required
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						{/* Time Fields */}
						<div className="grid grid-cols-2 gap-4">
							<form.Field name="clockInTime">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("timeTracking.manualEntry.clockInLabel", "Clock In")}
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

							<form.Field name="clockOutTime">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("timeTracking.manualEntry.clockOutLabel", "Clock Out")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												type="time"
												name="clockOutTime"
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
						</div>

						{/* Reason Field */}
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
											onChange={(e) => field.handleChange(e.target.value)}
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

						{/* Project Selector */}
						<form.Field name="projectId">
							{(field) => (
								<ProjectSelector
									value={field.state.value}
									onValueChange={(value) => field.handleChange(value)}
									autoSelectLast={false}
								/>
							)}
						</form.Field>

						{/* Work Category Selector */}
						<form.Field name="workCategoryId">
							{(field) => (
								<WorkCategorySelector
									employeeId={employeeId}
									value={field.state.value}
									onValueChange={(value) => field.handleChange(value)}
									autoSelectLast={false}
								/>
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
											{t("timeTracking.manualEntry.submitting", "Creating…")}
										</>
									) : (
										t("timeTracking.manualEntry.submit", "Create Entry")
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
