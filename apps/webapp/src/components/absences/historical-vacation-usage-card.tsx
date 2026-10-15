"use client";
import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	previewPreviouslyTakenVacation,
	commitPreviouslyTakenVacation,
} from "@/app/[locale]/(app)/settings/vacation/historical-usage-actions";
import type { HistoricalVacationReview } from "@/lib/absences/historical-vacation";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/components/ui/card";
import {
	HistoricalDatedHistoryAcknowledgement,
	HistoricalVacationReviewPanel,
} from "./historical-vacation-review";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	TFormItem,
	TFormLabel,
	TFormControl,
	TFormDescription,
	TFormMessage,
} from "@/components/ui/tanstack-form";

function clearBusy(setBusy: (value: boolean) => void) {
	setBusy(false);
}

export function HistoricalVacationUsageCard({
	organizationId,
	employeeId,
	initialYear,
	onSaved,
}: {
	organizationId: string;
	employeeId: string;
	initialYear: number;
	onSaved: () => void;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() || "en";
	const dateLabel = (date: string) =>
		formatPlainDate(parsePlainDate(date), locale, "dateMedium");
	const [year, setYear] = useState(initialYear);
	const queryClient = useQueryClient();
	const queryKey = [
		"historical-vacation-context",
		organizationId,
		employeeId,
		year,
	];
	const contextQuery = useQuery({
		queryKey,
		enabled: Number.isInteger(year) && year >= 1900 && year <= 9998,
		queryFn: async () => {
			const result = await previewPreviouslyTakenVacation({
				organizationId,
				employeeId,
				year,
				days: 0,
				reason: "Review recorded historical usage",
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const context = contextQuery.data ?? null;
	const [review, setReview] = useState<HistoricalVacationReview | null>(null);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [acknowledgedContext, setAcknowledgedContext] = useState<string | null>(
		null,
	);
	const form = useForm({
		defaultValues: {
			year: String(initialYear),
			days: "",
			reason: "",
			excludesListedDatedHistory: false,
		},
		onSubmit: async ({ value }) => {
			setBusy(true);
			setMessage("");
			setReview(null);
			try {
				const result = await previewPreviouslyTakenVacation({
					organizationId,
					employeeId,
					year: Number(value.year),
					days: Number(value.days),
					reason: value.reason,
					excludesListedDatedHistory:
						value.excludesListedDatedHistory &&
						acknowledgedContext === context?.fingerprint,
				});
				if (!result.success) {
					setMessage(result.error);
					clearBusy(setBusy);
					return;
				}
				if (
					value.excludesListedDatedHistory &&
					context &&
					JSON.stringify(context.historicalRecords) !==
						JSON.stringify(result.data.historicalRecords)
				) {
					setAcknowledgedContext(null);
					queryClient.setQueryData(queryKey, result.data);
					setMessage(
						t(
							"settings.vacation.historical.historyChanged",
							"The dated history changed. Read the updated list and confirm its exclusion again.",
						),
					);
					clearBusy(setBusy);
					return;
				}
				setReview(result.data);
			} catch {
				setMessage(
					t(
						"settings.vacation.historical.reviewFailed",
						"Could not review the total. Try again.",
					),
				);
			}
			clearBusy(setBusy);
		},
	});

	async function commit() {
		if (!review) return;
		setBusy(true);
		setMessage("");
		try {
			const result = await commitPreviouslyTakenVacation({
				organizationId,
				employeeId,
				year: review.year,
				days: review.days,
				reason: review.reason,
				excludesListedDatedHistory: review.excludesListedDatedHistory,
				fingerprint: review.fingerprint,
			});
			if (!result.success) {
				setMessage(result.error);
				setReview(null);
				clearBusy(setBusy);
				return;
			}
			setMessage(
				t(
					"settings.vacation.historical.saved",
					"Previously taken vacation saved.",
				),
			);
			setReview(null);
			queryClient.setQueryData(queryKey, {
				...result.data,
				recordedDays: result.data.days,
				lastReason: result.data.reason,
			});
			onSaved();
		} catch {
			setReview(null);
			setMessage(
				t(
					"settings.vacation.historical.saveUnconfirmed",
					"Could not confirm the result. Review the total again before retrying.",
				),
			);
		}
		clearBusy(setBusy);
	}
	return (
		<Card className="lg:col-span-3" aria-busy={busy}>
			<CardHeader>
				<CardTitle>
					{t("settings.vacation.historical.title", "Previously taken vacation")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.vacation.historical.description",
						"Record the employee's vacation used before tracking as a separate annual total. This replaces the previous total; it does not reduce their allowance.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form
					className="grid gap-4 md:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field
						name="year"
						validators={{
							onChange: ({ value }) =>
								Number.isInteger(Number(value)) &&
								Number(value) >= 1900 &&
								Number(value) <= 9998
									? undefined
									: t(
											"settings.vacation.historical.invalidYear",
											"Choose a valid calendar year.",
										),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t("settings.vacation.historical.year", "Calendar year")}
								</TFormLabel>
								<TFormControl>
									<Input
										type="number"
										name={field.name}
										autoComplete="off"
										min="1900"
										max="9998"
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => {
											field.handleChange(event.target.value);
											setYear(Number(event.target.value));
											form.setFieldValue("excludesListedDatedHistory", false);
											setAcknowledgedContext(null);
											setReview(null);
										}}
										disabled={busy}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.vacation.historical.yearHint",
										"The calendar year of the historical usage.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Field
						name="days"
						validators={{
							onChange: ({ value }) =>
								value !== "" &&
								Number(value) >= 0 &&
								Number(value) <= 366 &&
								Number(value) % 0.5 === 0
									? undefined
									: t(
											"settings.vacation.historical.invalidDays",
											"Use a nonnegative amount in half-day steps.",
										),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t(
										"settings.vacation.historical.days",
										"Replacement total of previously taken days",
									)}
								</TFormLabel>
								<TFormControl>
									<Input
										type="number"
										name={field.name}
										autoComplete="off"
										min="0"
										max="366"
										step="0.5"
										required
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => {
											field.handleChange(event.target.value);
											setReview(null);
										}}
										disabled={busy || !context}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.vacation.historical.zero",
										"Enter zero to clear the total while keeping its review history.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Field
						name="reason"
						validators={{
							onChange: ({ value }) =>
								value.trim()
									? undefined
									: t(
											"settings.vacation.historical.reasonRequired",
											"Explain the source and reason for this total.",
										),
						}}
					>
						{(field) => (
							<TFormItem className="md:col-span-2">
								<TFormLabel>
									{t(
										"settings.vacation.historical.reason",
										"Source and review reason",
									)}
								</TFormLabel>
								<TFormControl>
									<Textarea
										name={field.name}
										autoComplete="off"
										required
										maxLength={2000}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => {
											field.handleChange(event.target.value);
											setReview(null);
										}}
										disabled={busy || !context}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.vacation.historical.reasonHint",
										"Identify the records used to confirm this total.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					{context && (
						<p className="break-words text-sm text-muted-foreground md:col-span-2">
							{t(
								"settings.vacation.historical.coverage",
								"Recorded total: {days} days. Historical coverage: {start} to {end}. Coverage stays fixed if tracking dates change.",
								{
									days: context.recordedDays,
									start: dateLabel(context.coverageStart),
									end: dateLabel(context.coverageEnd),
								},
							)}
						</p>
					)}
					{context?.lastReason && (
						<p className="break-words text-sm text-muted-foreground md:col-span-2">
							{t(
								"settings.vacation.historical.lastReview",
								"Last review: {reason}",
								{
									reason: context.lastReason,
								},
							)}
						</p>
					)}

					{context && context.historicalRecords.length > 0 ? (
						<form.Field name="excludesListedDatedHistory">
							{(field) => (
								<HistoricalDatedHistoryAcknowledgement
									context={context}
									busy={busy}
									checked={
										field.state.value &&
										acknowledgedContext === context.fingerprint
									}
									name={field.name}
									onBlur={field.handleBlur}
									onCheckedChange={(checked) => {
										field.handleChange(checked);
										setAcknowledgedContext(
											checked ? context.fingerprint : null,
										);
										setReview(null);
									}}
								/>
							)}
						</form.Field>
					) : null}

					<Button type="submit" disabled={busy || !context} className="w-fit">
						{busy && (
							<IconLoader2
								className="size-4 animate-spin motion-reduce:animate-none"
								aria-hidden="true"
							/>
						)}
						{t("settings.vacation.historical.review", "Review balance impact")}
					</Button>
				</form>
				{(message || contextQuery.error) && (
					<p role="status" className="text-sm">
						{message || contextQuery.error?.message}
					</p>
				)}
				{review ? (
					<HistoricalVacationReviewPanel
						review={review}
						busy={busy}
						onCommit={() => void commit()}
					/>
				) : null}
			</CardContent>
		</Card>
	);
}
