"use client";

import { useTranslate } from "@tolgee/react";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import type { TripDetailsView } from "@/lib/travel-expenses/report-store";
import { MAX_TRIP_PURPOSE_LENGTH, type TripDetailsDraft } from "@/lib/travel-expenses/trip-report";
import { DraftSaveStatus } from "./draft-save-status";
import { TripProjectField } from "./project-picker";
import { TripDestinationsField } from "./trip-destinations-field";
import { fieldErrorMessage, type TripDetailsFieldName } from "./trip-details-form";
import { useTripDetailsDraft } from "./use-trip-details-draft";

/** Autosaving editor of the travel details all expenses of a trip share. */
export function TripDetailsEditor({
	reportId,
	details,
	onDetailsChange,
	onSaved,
	project,
}: {
	reportId: string;
	/** The details as last loaded; later loads never reset entered values. */
	details: TripDetailsView;
	/** The entered details as they change; null while any of them is malformed. */
	onDetailsChange: (details: TripDetailsDraft | null) => void;
	onSaved?: () => void;
	/** The trip's project (#605), which its expenses inherit. */
	project?: { initialProjectId: string | null; onSaved: (projectId: string | null) => void };
}) {
	const { t } = useTranslate();
	const { saver, state, form, changed, resolveWithTheirs } = useTripDetailsDraft({
		reportId,
		details,
		onDetailsChange,
		onSaved,
	});

	const fieldError = (field: TripDetailsFieldName) =>
		state.status === "invalid" ? fieldErrorMessage(t, state.fieldErrors?.[field]) : undefined;

	return (
		<section aria-labelledby={`${reportId}-trip`}>
			<Card>
				<CardHeader>
					<h2 id={`${reportId}-trip`} className="font-semibold leading-none">
						{t("travelExpenses.report.trip.title", "Trip details")}
					</h2>
					<CardDescription>
						{t(
							"travelExpenses.report.trip.description",
							"Every expense of this trip shares these details.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<DraftSaveStatus
						state={state}
						onRetry={() => saver.retry()}
						onKeepMine={() => saver.resolveConflict("keep_mine")}
						onUseTheirs={resolveWithTheirs}
					/>

					<form
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							void saver.flush();
						}}
						className="grid gap-4"
					>
						<form.Field name="purpose">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={!!fieldError("purpose")}>
										{t("travelExpenses.report.trip.fields.purpose", "Purpose of the trip")}
									</TFormLabel>
									<TFormControl hasError={!!fieldError("purpose")}>
										<Input
											name="purpose"
											autoComplete="off"
											maxLength={MAX_TRIP_PURPOSE_LENGTH}
											placeholder={t(
												"travelExpenses.report.trip.fields.purposePlaceholder",
												"e.g. Customer workshop in Hamburg",
											)}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormMessage>{fieldError("purpose")}</TFormMessage>
								</TFormItem>
							)}
						</form.Field>

						<div className="grid gap-4 sm:grid-cols-2">
							<form.Field name="startDate">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={!!fieldError("startDate")}>
											{t("travelExpenses.report.trip.fields.startDate", "First travel day")}
										</TFormLabel>
										<TFormControl hasError={!!fieldError("startDate")}>
											<DatePicker
												name="startDate"
												value={field.state.value}
												onChange={field.handleChange}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormMessage>{fieldError("startDate")}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>
							<form.Subscribe selector={(formState) => formState.values.startDate}>
								{(startDate) => (
									<form.Field name="endDate">
										{(field) => (
											<TFormItem>
												<TFormLabel hasError={!!fieldError("endDate")}>
													{t("travelExpenses.report.trip.fields.endDate", "Last travel day")}
												</TFormLabel>
												<TFormControl hasError={!!fieldError("endDate")}>
													<DatePicker
														name="endDate"
														min={startDate || undefined}
														value={field.state.value}
														onChange={field.handleChange}
														onBlur={field.handleBlur}
													/>
												</TFormControl>
												<TFormMessage>{fieldError("endDate")}</TFormMessage>
											</TFormItem>
										)}
									</form.Field>
								)}
							</form.Subscribe>
						</div>

						<form.Field name="timeZone">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={!!fieldError("timeZone")}>
										{t(
											"travelExpenses.report.trip.fields.timeZone",
											"Time zone of the travel dates",
										)}
									</TFormLabel>
									<TFormControl hasError={!!fieldError("timeZone")}>
										<TimezonePicker value={field.state.value} onChange={field.handleChange} />
									</TFormControl>
									<TFormDescription>
										{t(
											"travelExpenses.report.trip.fields.timeZoneDescription",
											"Travel dates are calendar days in {timeZone}. Reviewers see the same dates, wherever they are.",
											{ timeZone: field.state.value },
										)}
									</TFormDescription>
									<TFormMessage>{fieldError("timeZone")}</TFormMessage>
								</TFormItem>
							)}
						</form.Field>

						{project && (
							<form.Subscribe
								selector={(formState) =>
									`${formState.values.startDate}|${formState.values.endDate}`
								}
							>
								{(dates) => {
									const [startDate, endDate] = dates.split("|").map((date) => (date ? date : null));
									return (
										<TripProjectField
											reportId={reportId}
											startDate={startDate ?? null}
											endDate={endDate ?? null}
											initialProjectId={project.initialProjectId}
											saver={saver}
											onSaved={project.onSaved}
										/>
									);
								}}
							</form.Subscribe>
						)}

						<TripDestinationsField
							form={form}
							reportId={reportId}
							error={fieldError("destinations")}
							onDestinationRemoved={changed}
						/>
					</form>
				</CardContent>
			</Card>
		</section>
	);
}
