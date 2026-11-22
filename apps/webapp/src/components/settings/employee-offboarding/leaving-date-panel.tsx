"use client";

import { IconAlertTriangle, IconCalendarMinus, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { EmployeeOffboardingView } from "@/lib/employee-lifecycle/view-types";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import {
	useEmployeeOffboarding,
	usePastDeparturePreview,
	useRequestIdentity,
} from "@/lib/query/use-employee-offboarding";
import { OFFBOARDING_REFUSALS } from "./offboarding-refusals";
import { ReplacementEmployeeSelect } from "./replacement-employee-select";

export type LeavingDateMode =
	| "will_leave"
	| "offboard_now"
	| "has_left"
	| "correct_past_date"
	| "historical_backfill";

export interface LeavingDatePanelProps {
	organizationId: string;
	employeeId: string;
	/** View supplied by useEmployeeOffboarding if already loaded, or fetched internally. */
	view?: EmployeeOffboardingView | null;
}

function defaultModeForView(view: EmployeeOffboardingView): LeavingDateMode | null {
	if (view.capabilities.schedule) return "will_leave";
	if (view.capabilities.offboardNow) return "offboard_now";
	if (view.capabilities.recordPastDeparture) return "has_left";
	if (view.capabilities.correctPastDepartureDate) return "correct_past_date";
	if (view.capabilities.recordHistoricalDepartureDate) return "historical_backfill";
	return null;
}

/**
 * Unified Leaving Date panel for org admins supporting:
 * - Will Leave (future date)
 * - Offboard Now (immediate)
 * - Has Left (retrospective past date with live closed/settled payroll & post-cutoff work preview)
 * - Strictly date-only Past Date Correction (never reopens effective departures)
 * - Legacy Former Employee historical leaving-date backfill
 * - Scalable searchable ReplacementEmployeeSelect (#1929)
 */
export function LeavingDatePanel({ organizationId, employeeId }: LeavingDatePanelProps) {
	const { t } = useTranslate();
	const offboarding = useEmployeeOffboarding({ organizationId, employeeId });
	const requestIdentity = useRequestIdentity();
	const [submitError, setSubmitError] = useState<string | null>(null);
	const view = offboarding.view;

	const availableModes: LeavingDateMode[] = [];
	if (view?.capabilities.schedule) availableModes.push("will_leave");
	if (view?.capabilities.offboardNow) availableModes.push("offboard_now");
	if (view?.capabilities.recordPastDeparture) availableModes.push("has_left");
	if (view?.capabilities.correctPastDepartureDate) availableModes.push("correct_past_date");
	if (view?.capabilities.recordHistoricalDepartureDate) availableModes.push("historical_backfill");

	const initialMode: LeavingDateMode = (view ? defaultModeForView(view) : null) ?? "will_leave";

	const form = useForm({
		defaultValues: {
			mode: initialMode,
			lastWorkingDay: view?.departure?.lastWorkingDay ?? "",
			replacementEmployeeId: view?.departure?.replacementEmployeeId ?? (null as string | null),
			acknowledgeUnassignedDuties: false,
			reason: "",
		},
		onSubmit: async ({ value }) => {
			if (!view) return;
			setSubmitError(null);
			let result: { success: boolean; error?: string; code?: string; refusal?: string };

			if (value.mode === "will_leave") {
				const intent = {
					employeeId,
					expectedRevision: view.departure?.revision ?? null,
					lastWorkingDay: value.lastWorkingDay,
					replacementEmployeeId: value.replacementEmployeeId,
					acknowledgeUnassignedDuties: value.acknowledgeUnassignedDuties,
				};
				result = await offboarding.scheduleDeparture({
					...intent,
					requestId: requestIdentity.forPayload({ command: "schedule", ...intent }),
				});
			} else if (value.mode === "offboard_now") {
				const intent = {
					employeeId,
					replacementEmployeeId: value.replacementEmployeeId,
					acknowledgeUnassignedDuties: value.acknowledgeUnassignedDuties,
				};
				result = await offboarding.offboardNow({
					...intent,
					requestId: requestIdentity.forPayload({ command: "offboard_now", ...intent }),
				});
			} else if (value.mode === "has_left") {
				const intent = {
					employeeId,
					lastWorkingDay: value.lastWorkingDay,
					replacementEmployeeId: value.replacementEmployeeId,
					acknowledgeUnassignedDuties: value.acknowledgeUnassignedDuties,
				};
				result = await offboarding.recordPastDeparture({
					...intent,
					requestId: requestIdentity.forPayload({ command: "record_past", ...intent }),
				});
			} else if (value.mode === "correct_past_date") {
				if (!view.departure) return;
				const intent = {
					employeeId,
					departureId: view.departure.id,
					expectedRevision: view.departure.revision,
					lastWorkingDay: value.lastWorkingDay,
					reason: value.reason.trim() || null,
				};
				result = await offboarding.correctPastDepartureDate({
					...intent,
					requestId: requestIdentity.forPayload({ command: "correct_past", ...intent }),
				});
			} else {
				const intent = {
					employeeId,
					lastWorkingDay: value.lastWorkingDay,
					reason: value.reason.trim() || null,
				};
				result = await offboarding.recordHistoricalDepartureDate({
					...intent,
					requestId: requestIdentity.forPayload({ command: "historical_backfill", ...intent }),
				});
			}

			if (result.success) {
				requestIdentity.complete();
				toast.success(t("settings.employees.leavingDate.saved", "Leaving date updated"));
			} else {
				setSubmitError(
					actionErrorMessage(t, result, OFFBOARDING_REFUSALS, [
						"settings.employees.offboarding.saveFailed",
						"The departure could not be saved.",
					]),
				);
			}
		},
	});

	const mode = useStore(form.store, (s) => s.values.mode);
	const lastWorkingDay = useStore(form.store, (s) => s.values.lastWorkingDay);
	const replacementEmployeeId = useStore(form.store, (s) => s.values.replacementEmployeeId);

	const activeMode: LeavingDateMode | null = availableModes.includes(mode)
		? mode
		: (availableModes[0] ?? null);

	const pastPreview = usePastDeparturePreview({
		organizationId,
		employeeId,
		lastWorkingDay,
		replacementEmployeeId,
		enabled: activeMode === "has_left" && Boolean(lastWorkingDay),
	});

	if (offboarding.isLoading || !view || availableModes.length === 0 || !activeMode) {
		return null;
	}

	const needsDate = activeMode !== "offboard_now";
	const showsReplacement =
		activeMode === "will_leave" || activeMode === "offboard_now" || activeMode === "has_left";
	const showsReason = activeMode === "correct_past_date" || activeMode === "historical_backfill";

	return (
		<Card data-testid="leaving-date-panel">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<IconCalendarMinus className="size-5" aria-hidden="true" />
					{t("settings.employees.leavingDate.title", "Leaving Date")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.employees.leavingDate.description",
						"Schedule a future departure, offboard immediately, record a retrospective past leaving date, correct a past leaving date, or backfill a legacy former employee's date.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						if (activeMode !== mode) {
							form.setFieldValue("mode", activeMode);
						}
						void form.handleSubmit();
					}}
				>
					{submitError && (
						<Alert variant="destructive" role="alert">
							<IconAlertTriangle className="size-4" aria-hidden="true" />
							<AlertDescription>{submitError}</AlertDescription>
						</Alert>
					)}

					<form.Field name="mode">
						{(field) => (
							<fieldset className="space-y-2">
								<legend className="font-medium text-sm">
									{t("settings.employees.leavingDate.modeLegend", "Leaving date action")}
								</legend>
								<RadioGroup
									value={activeMode}
									onValueChange={(val) => {
										setSubmitError(null);
										field.handleChange(val as LeavingDateMode);
									}}
									className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
								>
									{availableModes.includes("will_leave") && (
										<label
											htmlFor="leaving-mode-will-leave"
											className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
										>
											<RadioGroupItem value="will_leave" id="leaving-mode-will-leave" />
											<span>
												{t("settings.employees.leavingDate.willLeave", "Will Leave (future date)")}
											</span>
										</label>
									)}
									{availableModes.includes("offboard_now") && (
										<label
											htmlFor="leaving-mode-offboard-now"
											className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
										>
											<RadioGroupItem value="offboard_now" id="leaving-mode-offboard-now" />
											<span>
												{t(
													"settings.employees.leavingDate.offboardNow",
													"Offboard Now (immediate)",
												)}
											</span>
										</label>
									)}
									{availableModes.includes("has_left") && (
										<label
											htmlFor="leaving-mode-has-left"
											className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
										>
											<RadioGroupItem value="has_left" id="leaving-mode-has-left" />
											<span>
												{t("settings.employees.leavingDate.hasLeft", "Has Left (past date)")}
											</span>
										</label>
									)}
									{availableModes.includes("correct_past_date") && (
										<label
											htmlFor="leaving-mode-correct-past"
											className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
										>
											<RadioGroupItem value="correct_past_date" id="leaving-mode-correct-past" />
											<span>
												{t(
													"settings.employees.leavingDate.correctPastDate",
													"Correct Past Leaving Date",
												)}
											</span>
										</label>
									)}
									{availableModes.includes("historical_backfill") && (
										<label
											htmlFor="leaving-mode-historical-backfill"
											className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"
										>
											<RadioGroupItem
												value="historical_backfill"
												id="leaving-mode-historical-backfill"
											/>
											<span>
												{t(
													"settings.employees.leavingDate.historicalBackfill",
													"Record Historical Leaving Date",
												)}
											</span>
										</label>
									)}
								</RadioGroup>
							</fieldset>
						)}
					</form.Field>

					{activeMode === "correct_past_date" && (
						<Alert role="note">
							<AlertTitle>
								{t("settings.employees.leavingDate.dateOnlyTitle", "Strictly date-only correction")}
							</AlertTitle>
							<AlertDescription>
								{t(
									"settings.employees.leavingDate.dateOnlyDescription",
									"Correcting a past leaving date adjusts the recorded departure date without reopening the effective departure. Use Rehire to start a new employment period.",
								)}
							</AlertDescription>
						</Alert>
					)}

					{needsDate && (
						<form.Field name="lastWorkingDay">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor="leaving-date-input">
										{t("settings.employees.offboarding.lastWorkingDay", "Last working day")}
									</Label>
									<Input
										id="leaving-date-input"
										type="date"
										required
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										className="max-w-xs"
									/>
								</div>
							)}
						</form.Field>
					)}

					{/* Live Retrospective ("Has Left") Closed/Settled Payroll & Post-Cutoff Work Preview */}
					{activeMode === "has_left" && lastWorkingDay && (
						<div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs" aria-live="polite">
							{pastPreview.isFetching && (
								<p className="flex items-center gap-1.5 text-muted-foreground">
									<IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" />
									{t(
										"settings.employees.leavingDate.loadingPastPreview",
										"Checking post-cutoff work and closed/settled payroll impact…",
									)}
								</p>
							)}
							{pastPreview.data && (
								<div className="space-y-2" data-testid="past-departure-preview">
									<div className="flex flex-wrap gap-2">
										<Badge
											variant={
												pastPreview.data.impact.requiresWorkAfterCutoffReview
													? "destructive"
													: "outline"
											}
										>
											{t(
												"settings.employees.leavingDate.postCutoffWorkCount",
												"{count} work periods after cutoff",
												{ count: pastPreview.data.impact.workAfterCutoff.workPeriodCount },
											)}
										</Badge>
										<Badge
											variant={
												pastPreview.data.impact.requiresPayrollReconciliationReview
													? "destructive"
													: "outline"
											}
										>
											{t(
												"settings.employees.leavingDate.closedMonthsCount",
												"{count} closed months overlapping",
												{
													count: pastPreview.data.impact.payrollReconciliation.closedMonths.length,
												},
											)}
										</Badge>
										<Badge
											variant={
												pastPreview.data.impact.payrollReconciliation.settledDayCount > 0
													? "destructive"
													: "outline"
											}
										>
											{t(
												"settings.employees.leavingDate.settledDaysCount",
												"{count} settled payroll days overlapping",
												{ count: pastPreview.data.impact.payrollReconciliation.settledDayCount },
											)}
										</Badge>
									</div>
									{pastPreview.data.impact.requiresPayrollReconciliationReview && (
										<p className="text-amber-700 dark:text-amber-300">
											{t(
												"settings.employees.leavingDate.payrollUntouchedNotice",
												"Closed months and settled payroll days will remain untouched; a durable payroll_reconciliation review will be opened.",
											)}
										</p>
									)}
									{pastPreview.data.impact.requiresWorkAfterCutoffReview && (
										<p className="text-amber-700 dark:text-amber-300">
											{t(
												"settings.employees.leavingDate.workAfterCutoffNotice",
												"Recorded work exists after the leaving date; a durable work_after_cutoff review will be opened.",
											)}
										</p>
									)}
								</div>
							)}
						</div>
					)}

					{showsReplacement && (
						<form.Field name="replacementEmployeeId">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor="leaving-date-replacement">
										{t("settings.employees.offboarding.replacement", "Replacement for approvals")}
									</Label>
									<ReplacementEmployeeSelect
										id="leaving-date-replacement"
										excludeEmployeeId={employeeId}
										value={field.state.value}
										onChange={field.handleChange}
										allowNone
										className="max-w-md"
									/>
								</div>
							)}
						</form.Field>
					)}

					{showsReplacement && (
						<form.Field name="acknowledgeUnassignedDuties">
							{(field) => (
								<div className="flex items-start gap-2">
									<Checkbox
										id="leaving-date-ack-duties"
										checked={field.state.value}
										onCheckedChange={(c) => field.handleChange(c === true)}
									/>
									<Label htmlFor="leaving-date-ack-duties" className="text-xs leading-snug">
										{t(
											"settings.employees.leavingDate.ackDuties",
											"Admins will handle any unassigned approval duties if no replacement is chosen.",
										)}
									</Label>
								</div>
							)}
						</form.Field>
					)}

					{showsReason && (
						<form.Field name="reason">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor="leaving-date-reason">
										{t("settings.employees.leavingDate.reasonLabel", "Audit note (optional)")}
									</Label>
									<Textarea
										id="leaving-date-reason"
										rows={2}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
							)}
						</form.Field>
					)}

					<div className="flex justify-end">
						<Button
							type="submit"
							variant={activeMode === "offboard_now" ? "destructive" : "default"}
							disabled={offboarding.isMutating || (needsDate && !lastWorkingDay)}
						>
							{offboarding.isMutating ? (
								<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{activeMode === "will_leave"
								? t("settings.employees.leavingDate.submitWillLeave", "Schedule leaving date")
								: activeMode === "offboard_now"
									? t("settings.employees.offboarding.offboardNow", "Offboard now")
									: activeMode === "has_left"
										? t("settings.employees.leavingDate.submitHasLeft", "Record past leaving date")
										: activeMode === "correct_past_date"
											? t("settings.employees.leavingDate.submitCorrectDate", "Correct past date")
											: t(
													"settings.employees.leavingDate.submitHistorical",
													"Record historical date",
												)}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
