"use client";

import { IconPhoneCall } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	getEmployeeOnCallStatusAction,
	getOnCallReferencePeriodAction,
} from "@/app/[locale]/(app)/settings/contracts/on-call-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type {
	OnCallReferenceBreakdown,
	OnCallReferenceMethod,
} from "@/lib/statutory/on-call/reference-period";
import { onCallStatusQueryKey } from "./on-call-query-keys";
import { OnCallReferenceBreakdownView } from "./on-call-reference-breakdown";
import { formatOnCallMinutes, onCallFindingText, onCallHoursKindText } from "./on-call-text";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * § 12 TzBfG on-call status of one employee: agreed terms, open monitor findings and the
 * read-only reference hours for recent sick leave and public holidays. Shown on Employee Detail,
 * the employee's own profile and Absences; renders nothing for employees never on call. The
 * server redacts findings below org admin; the card shows minutes and days only.
 */
export function OnCallStatusCard({
	organizationId,
	employeeId,
	showErrors = false,
}: {
	/** Part of the query key: cached on-call data never shows under another organization. */
	readonly organizationId: string;
	readonly employeeId: string;
	/** Employee Detail shows a failed load; self-service pages stay quiet. */
	readonly showErrors?: boolean;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const [method, setMethod] = useState<OnCallReferenceMethod>("three_months");
	const status = useQuery({
		queryKey: onCallStatusQueryKey(organizationId, employeeId, method),
		queryFn: async () => {
			const result = await getEmployeeOnCallStatusAction({ employeeId, method });
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
	});
	const calculation = useMutation({
		mutationFn: async (eventDate: string) => {
			const result = await getOnCallReferencePeriodAction({ employeeId, eventDate, method });
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
	});
	const form = useForm({
		defaultValues: { eventDate: "" },
		onSubmit: async ({ value }) => {
			await calculation.mutateAsync(value.eventDate);
		},
	});
	const day = (value: string) => formatPlainDate(parsePlainDate(value), locale, "dateMedium");

	// Most employees are never on call: show nothing until the status says otherwise.
	if (status.isPending) return null;
	if (status.isError) {
		return showErrors ? <OnCallStatusError message={status.error.message} /> : null;
	}
	const data = status.data;
	if (!data.hasOnCallTerms) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconPhoneCall aria-hidden="true" className="size-5" />
					{t("common.onCall.title", "On-call work (§ 12 TzBfG)")}
				</CardTitle>
				<CardDescription>
					<OnCallTermsSummary terms={data.terms} />
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<OnCallFindingsSection
					employeeId={employeeId}
					findings={data.findings.filter((finding) => finding.severity !== "info")}
					day={day}
				/>

				<section className="space-y-3" aria-labelledby={`on-call-reference-${employeeId}`}>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h3 id={`on-call-reference-${employeeId}`} className="font-medium text-sm">
							{t("common.onCall.reference.title", "Reference hours for sick pay and holidays")}
						</h3>
						<OnCallReferenceMethodToggle method={method} onChange={setMethod} />
					</div>
					<p className="text-muted-foreground text-sm">
						{t(
							"common.onCall.reference.description",
							"For information only: payroll decides what is paid. Nothing here changes settled days or closed months.",
						)}
					</p>
					<OnCallReferenceEventList events={data.referenceEvents} day={day} />
					<form
						noValidate
						className="flex flex-wrap items-end gap-2"
						aria-busy={calculation.isPending}
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void form.handleSubmit();
						}}
					>
						<form.Field
							name="eventDate"
							validators={{
								onSubmit: ({ value }) =>
									ISO_DATE.test(value)
										? undefined
										: t("common.onCall.reference.dateRequired", "Choose a date."),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("common.onCall.reference.eventDate", "Calculate for a day")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											type="date"
											className="w-44"
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									</TFormControl>
									<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
								</TFormItem>
							)}
						</form.Field>
						<Button type="submit" variant="outline" disabled={calculation.isPending}>
							{t("common.onCall.reference.calculate", "Calculate")}
						</Button>
					</form>
					<OnCallCalculationResult error={calculation.error} breakdown={calculation.data} />
				</section>
			</CardContent>
		</Card>
	);
}

type OnCallStatus = Extract<
	Awaited<ReturnType<typeof getEmployeeOnCallStatusAction>>,
	{ success: true }
>["data"];
type FormatDay = (value: string) => string;

function OnCallStatusError({ message }: { readonly message: string }) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("common.onCall.title", "On-call work (§ 12 TzBfG)")}</CardTitle>
				<CardDescription role="alert">{message}</CardDescription>
			</CardHeader>
		</Card>
	);
}

function OnCallTermsSummary({ terms }: { readonly terms: OnCallStatus["terms"] }) {
	const { t } = useTranslate();
	if (!terms) return t("common.onCall.notToday", "Not on call today.");
	return [
		onCallHoursKindText(terms.hoursKind, t),
		terms.weeklyMinutes === null
			? null
			: t("common.onCall.weekly", "{duration} per week", {
					duration: formatOnCallMinutes(terms.weeklyMinutes),
				}),
		terms.dailyMinutes === null
			? t("common.onCall.statutoryMinimumCall", "Statutory minimum call applies")
			: t("common.onCall.minimumCall", "Minimum call {duration}", {
					duration: formatOnCallMinutes(terms.dailyMinutes),
				}),
	]
		.filter(Boolean)
		.join(" · ");
}

function OnCallFindingsSection({
	employeeId,
	findings,
	day,
}: {
	readonly employeeId: string;
	readonly findings: OnCallStatus["findings"];
	readonly day: FormatDay;
}) {
	const { t } = useTranslate();
	return (
		<section className="space-y-2" aria-labelledby={`on-call-findings-${employeeId}`}>
			<h3 id={`on-call-findings-${employeeId}`} className="font-medium text-sm">
				{t("common.onCall.findingsTitle", "Checks of the last and next four weeks")}
			</h3>
			{findings.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{t("common.onCall.noFindings", "No on-call rule is at risk.")}
				</p>
			) : (
				<ul className="space-y-1.5 text-sm">
					{findings.map((finding) => (
						<li key={finding.id} className="flex flex-wrap items-center gap-2">
							<Badge variant={finding.severity === "critical" ? "destructive" : "secondary"}>
								{day(finding.periodStart)}
							</Badge>
							<span>{onCallFindingText(finding, t)}</span>
							<OnCallAcknowledgementBadge status={finding.acknowledgement?.status} />
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function OnCallAcknowledgementBadge({
	status,
}: {
	readonly status: NonNullable<OnCallStatus["findings"][number]["acknowledgement"]>["status"] | undefined;
}) {
	const { t } = useTranslate();
	if (status === "current") {
		return (
			<Badge variant="outline">
				{t("common.onCall.agreementDocumented", "Agreement documented")}
			</Badge>
		);
	}
	if (status === "stale") {
		return (
			<Badge variant="outline">
				{t("common.onCall.agreementStale", "Shift changed since the agreement")}
			</Badge>
		);
	}
	return null;
}

function OnCallReferenceMethodToggle({
	method,
	onChange,
}: {
	readonly method: OnCallReferenceMethod;
	readonly onChange: (method: OnCallReferenceMethod) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex gap-1" role="group">
			<Button
				type="button"
				size="sm"
				variant={method === "three_months" ? "secondary" : "ghost"}
				aria-pressed={method === "three_months"}
				onClick={() => onChange("three_months")}
			>
				{t("common.onCall.reference.threeMonths", "3 months")}
			</Button>
			<Button
				type="button"
				size="sm"
				variant={method === "thirteen_weeks" ? "secondary" : "ghost"}
				aria-pressed={method === "thirteen_weeks"}
				onClick={() => onChange("thirteen_weeks")}
			>
				{t("common.onCall.reference.thirteenWeeks", "13 weeks")}
			</Button>
		</div>
	);
}

function OnCallReferenceEventList({
	events,
	day,
}: {
	readonly events: OnCallStatus["referenceEvents"];
	readonly day: FormatDay;
}) {
	const { t } = useTranslate();
	if (events.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				{t(
					"common.onCall.reference.noEvents",
					"No sick leave or public holiday on an on-call day in the last three months.",
				)}
			</p>
		);
	}
	return (
		<ul className="space-y-3">
			{events.map((event) => (
				<li key={`${event.kind}-${event.eventDate}`} className="rounded-lg border p-3">
					<p className="mb-2 font-medium text-sm">
						{event.kind === "sick_leave"
							? t("common.onCall.reference.sickLeave", "Sick leave from {date}", {
									date: day(event.eventDate),
								})
							: t("common.onCall.reference.publicHoliday", "Public holiday on {date}", {
									date: day(event.eventDate),
								})}
					</p>
					<OnCallReferenceBreakdownView breakdown={event.breakdown} />
				</li>
			))}
		</ul>
	);
}

function OnCallCalculationResult({
	error,
	breakdown,
}: {
	readonly error: Error | null;
	readonly breakdown: OnCallReferenceBreakdown | undefined;
}) {
	return (
		<>
			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error.message}
				</p>
			) : null}
			{breakdown ? (
				<div className="rounded-lg border p-3">
					<OnCallReferenceBreakdownView breakdown={breakdown} />
				</div>
			) : null}
		</>
	);
}
