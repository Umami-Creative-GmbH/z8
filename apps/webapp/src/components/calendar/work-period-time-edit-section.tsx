"use client";

import { IconCheck, IconLoader2, IconPencil, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFnType } from "@tolgee/react";
import { type ReactNode, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	getWorkPeriodTimeEditContext,
	updateWorkPeriodTimes,
	type WorkPeriodTimeEditContext,
} from "@/app/[locale]/(app)/time-tracking/actions/work-period-time-edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput } from "@/components/ui/time-input";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { DisplayContext } from "@/lib/datetime/temporal-format";
import { queryKeys } from "@/lib/query/keys";
import { getTimezoneAbbreviation } from "@/lib/time-tracking/timezone-utils";
import {
	haveWorkPeriodDatesChanged,
	haveWorkPeriodTimesChanged,
	resolveWorkPeriodTimeEditRoute,
	type WorkPeriodTimeEditAccess,
	type WorkPeriodTimeEditRoute,
	type WorkPeriodTimeEditValues,
} from "@/lib/time-tracking/work-period-time-edit-policy";
import { formatEventTimeRange } from "./work-period-dialog-utils";

type TimeEditFormValues = WorkPeriodTimeEditValues & { reason: string };

/** Routes that submit a time correction, which always carries a reason. */
function routeNeedsReason(route: WorkPeriodTimeEditRoute | null): boolean {
	return route === "approval_request" || route === "on_behalf_request";
}

function isChronological(values: WorkPeriodTimeEditValues): boolean {
	try {
		const clockIn = Temporal.PlainDateTime.from(
			`${values.clockInDate}T${values.clockInTime}`,
		);
		const clockOut = Temporal.PlainDateTime.from(
			`${values.clockOutDate}T${values.clockOutTime}`,
		);
		return Temporal.PlainDateTime.compare(clockIn, clockOut) < 0;
	} catch {
		return false;
	}
}

function BlockedHint({
	access,
	t,
}: {
	access: WorkPeriodTimeEditAccess;
	t: TFnType;
}) {
	if (access.kind !== "blocked") return null;

	let message: string | null = null;
	if (access.reason === "beyond_approval_window") {
		message = t(
			"calendar.edit.time.beyondWindow",
			"Entries older than {days} days can only be edited by an admin.",
			{ days: access.daysBack },
		);
	} else if (access.reason === "pending_correction") {
		message = t(
			"calendar.edit.time.pendingCorrection",
			"A time change for this entry is already waiting for approval.",
		);
	}

	return message ? (
		<p className="mt-1 text-xs text-muted-foreground">{message}</p>
	) : null;
}

function RouteHint({
	route,
	t,
}: {
	route: WorkPeriodTimeEditRoute | null;
	t: TFnType;
}) {
	if (route === "approval_request") {
		return (
			<p className="text-xs text-amber-600 dark:text-amber-400">
				{t(
					"calendar.edit.time.approvalHint",
					"This change will be sent to your manager for approval.",
				)}
			</p>
		);
	}
	if (route === "on_behalf_request") {
		return (
			<p className="text-xs text-amber-600 dark:text-amber-400">
				{t(
					"calendar.edit.time.onBehalfHint",
					"This change follows the employee's approval chain. If you are their approver, it applies right away.",
				)}
			</p>
		);
	}
	if (route === "admin_direct" || route === "self_service_direct") {
		return (
			<p className="text-xs text-muted-foreground">
				{t("calendar.edit.time.directHint", "This change applies immediately.")}
			</p>
		);
	}
	return null;
}

function EndpointFields({
	legend,
	dateField,
	timeField,
}: {
	legend: string;
	dateField: ReactNode;
	timeField: ReactNode;
}) {
	return (
		<fieldset className="grid min-w-0 grid-cols-2 gap-2">
			<legend className="col-span-2 pb-1 text-sm font-medium">{legend}</legend>
			{dateField}
			{timeField}
		</fieldset>
	);
}

function WorkPeriodTimeEditForm({
	workPeriodId,
	context,
	onCancel,
	onSaved,
	t,
}: {
	workPeriodId: string;
	context: WorkPeriodTimeEditContext;
	onCancel: () => void;
	onSaved: () => void;
	t: TFnType;
}) {
	const reasonId = useId();
	const submissionIdRef = useRef<string | null>(null);
	const routeFor = (values: WorkPeriodTimeEditValues) =>
		resolveWorkPeriodTimeEditRoute(context.access, {
			datesChanged: haveWorkPeriodDatesChanged(context.values, values),
		});

	const form = useForm({
		defaultValues: { ...context.values, reason: "" } as TimeEditFormValues,
		onSubmit: async ({ value }) => {
			if (!haveWorkPeriodTimesChanged(context.values, value)) {
				toast.error(
					t("calendar.edit.time.noChanges", "Change the date or time first."),
				);
				return;
			}
			if (!isChronological(value)) {
				toast.error(
					t(
						"calendar.edit.time.invalidRange",
						"Clock out must be after clock in.",
					),
				);
				return;
			}
			const route = routeFor(value);
			if (routeNeedsReason(route) && !value.reason.trim()) {
				toast.error(
					t(
						"calendar.edit.time.reasonRequired",
						"Please add a reason for your manager.",
					),
				);
				return;
			}

			const submissionId =
				submissionIdRef.current ?? globalThis.crypto.randomUUID();
			submissionIdRef.current = submissionId;
			const result = await updateWorkPeriodTimes({
				workPeriodId,
				submissionId,
				...value,
			}).catch(() => null);

			if (!result?.success) {
				toast.error(
					result?.error ||
						t("calendar.edit.time.saveFailed", "Failed to update time entry"),
				);
				return;
			}

			submissionIdRef.current = null;
			let message = t("calendar.edit.time.saved", "Time entry updated");
			if (result.data.status === "pending") {
				message =
					route === "on_behalf_request"
						? t(
								"calendar.edit.time.submittedOnBehalf",
								"Change submitted to the employee's approver",
							)
						: t(
								"calendar.edit.time.submitted",
								"Change submitted for manager approval",
							);
			}
			toast.success(message);
			onSaved();
		},
	});

	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<p className="text-xs text-muted-foreground">
				{t(
					"calendar.edit.time.timezoneNote",
					"Times are in the employee's timezone ({timezone})",
					{ timezone: getTimezoneAbbreviation(context.timezone) },
				)}
			</p>
			<EndpointFields
				legend={t("calendar.edit.time.clockIn", "Clock in")}
				dateField={
					<form.Field name="clockInDate">
						{(field) => (
							<Input
								type="date"
								name={field.name}
								autoComplete="off"
								aria-label={t(
									"calendar.edit.time.clockInDate",
									"Clock in date",
								)}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								required
							/>
						)}
					</form.Field>
				}
				timeField={
					<form.Field name="clockInTime">
						{(field) => (
							<TimeInput
								name={field.name}
								autoComplete="off"
								aria-label={t(
									"calendar.edit.time.clockInTime",
									"Clock in time",
								)}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								required
							/>
						)}
					</form.Field>
				}
			/>
			<EndpointFields
				legend={t("calendar.edit.time.clockOut", "Clock out")}
				dateField={
					<form.Field name="clockOutDate">
						{(field) => (
							<Input
								type="date"
								name={field.name}
								autoComplete="off"
								aria-label={t(
									"calendar.edit.time.clockOutDate",
									"Clock out date",
								)}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								required
							/>
						)}
					</form.Field>
				}
				timeField={
					<form.Field name="clockOutTime">
						{(field) => (
							<TimeInput
								name={field.name}
								autoComplete="off"
								aria-label={t(
									"calendar.edit.time.clockOutTime",
									"Clock out time",
								)}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								required
							/>
						)}
					</form.Field>
				}
			/>

			<form.Subscribe
				selector={(state) => ({
					route: routeFor(state.values),
					isSubmitting: state.isSubmitting,
				})}
			>
				{({ route, isSubmitting }) => (
					<>
						<form.Field name="reason">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor={reasonId}>
										{routeNeedsReason(route)
											? t("calendar.edit.time.reasonLabel", "Reason")
											: t("calendar.edit.time.noteLabel", "Note (optional)")}
									</Label>
									<Textarea
										id={reasonId}
										name={field.name}
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={
											routeNeedsReason(route)
												? t(
														"calendar.edit.time.reasonPlaceholder",
														"Explain why this correction is needed…",
													)
												: t(
														"calendar.edit.time.notePlaceholder",
														"Add a note about this change…",
													)
										}
										required={routeNeedsReason(route)}
										rows={2}
										className="resize-none"
									/>
								</div>
							)}
						</form.Field>
						<RouteHint route={route} t={t} />
						<div className="flex gap-2">
							<Button
								type="submit"
								size="sm"
								disabled={isSubmitting}
								className="flex-1"
							>
								{isSubmitting ? (
									<IconLoader2
										className="mr-1 size-4 animate-spin"
										aria-hidden="true"
									/>
								) : (
									<IconCheck className="mr-1 size-4" aria-hidden="true" />
								)}
								{route === "approval_request"
									? t(
											"calendar.edit.time.submitForApproval",
											"Submit for approval",
										)
									: route === "on_behalf_request"
										? t("calendar.edit.time.submitOnBehalf", "Submit change")
										: t("common.save", "Save")}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={onCancel}
								disabled={isSubmitting}
							>
								<IconX className="mr-1 size-4" aria-hidden="true" />
								{t("common.cancel", "Cancel")}
							</Button>
						</div>
					</>
				)}
			</form.Subscribe>
		</form>
	);
}

export function WorkPeriodTimeSection({
	event,
	displayContext,
	onTimesUpdated,
	initialEditing = false,
	t,
}: {
	event: CalendarEvent;
	displayContext: DisplayContext;
	onTimesUpdated?: () => void;
	/** Open the time form right away, e.g. from the calendar context menu. */
	initialEditing?: boolean;
	t: TFnType;
}) {
	const queryClient = useQueryClient();
	const [isEditing, setIsEditing] = useState(initialEditing);
	const queryKey = queryKeys.calendar.workPeriodTimeEdit(event.id);
	const { data: context } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getWorkPeriodTimeEditContext(event.id);
			return result.success ? result.data : null;
		},
		enabled: event.metadata.isRunning !== true,
		staleTime: 0,
	});
	const canEdit = Boolean(context && context.access.kind !== "blocked");

	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<span className="text-sm text-muted-foreground">
					{t("calendar.details.time", "Time")}
				</span>
				{canEdit && !isEditing ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setIsEditing(true)}
						className="h-7 px-2"
					>
						<IconPencil className="mr-1 size-4" aria-hidden="true" />
						{t("calendar.edit.time.edit", "Edit time")}
					</Button>
				) : null}
			</div>

			{isEditing && context && canEdit ? (
				<WorkPeriodTimeEditForm
					workPeriodId={event.id}
					context={context}
					onCancel={() => setIsEditing(false)}
					onSaved={() => {
						setIsEditing(false);
						void queryClient.invalidateQueries({ queryKey });
						onTimesUpdated?.();
					}}
					t={t}
				/>
			) : (
				<>
					<p className="font-medium">
						{formatEventTimeRange(event, displayContext)}
					</p>
					{context ? <BlockedHint access={context.access} t={t} /> : null}
				</>
			)}
		</div>
	);
}
