"use client";

import {
	IconAlertTriangle,
	IconLoader2,
	IconPlus,
	IconSchool,
	IconTrash,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getWorkingStudentMonitorAction,
	recordWorkingStudentLectureFreePeriodAction,
	recordWorkingStudentPriorWeeksAction,
	voidWorkingStudentLectureFreePeriodAction,
	voidWorkingStudentPriorWeeksAction,
} from "@/app/[locale]/(app)/settings/contracts/working-student-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import type { EmployeeContextRefusal } from "@/lib/statutory/employee-context";
import type {
	WorkingStudentFindingView,
	WorkingStudentMonitorView,
	WorkingStudentWeekView,
} from "@/lib/statutory/working-student/views";
import {
	invalidateWorkingStudentFindings,
	workingStudentQueryKeys,
} from "./working-student-queries";

type Translate = ReturnType<typeof useTranslate>["t"];

const CONTEXT_REFUSALS = {
	statutory_period_overlap: [
		"settings.contracts.workingStudent.refusal.overlap",
		"This period overlaps a recorded lecture-free period.",
	],
	statutory_invalid_range: [
		"settings.contracts.workingStudent.refusal.invalidRange",
		"Check the dates: the end must not be before the start, and prior weeks start on a Monday.",
	],
	statutory_invalid_value: [
		"settings.contracts.workingStudent.refusal.invalidValue",
		"Enter a number of weeks from 1 to 53.",
	],
	statutory_note_required: [
		"settings.contracts.workingStudent.refusal.noteRequired",
		"Add a note explaining the entry.",
	],
	statutory_release_single_day: [
		"settings.contracts.workingStudent.refusal.invalidRange",
		"Check the dates: the end must not be before the start, and prior weeks start on a Monday.",
	],
} satisfies RefusalMessages<EmployeeContextRefusal>;

function hours(minutes: number, locale: string): string {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes / 60);
}

export function workingStudentFindingText(
	finding: WorkingStudentFindingView,
	t: Translate,
	locale: string,
) {
	const { used, limit } = finding.summary;
	if (finding.kind === "working_student_lecture_week" && used && limit) {
		return t(
			"settings.contracts.workingStudent.finding.lectureWeek",
			"{hours} h of weekday daytime work in a lecture week (limit {limit} h)",
			{ hours: hours(used.value, locale), limit: hours(limit.value, locale) },
		);
	}
	if (finding.kind === "working_student_26_week_ceiling" && used && limit) {
		return t(
			"settings.contracts.workingStudent.finding.ceiling",
			"{used} of {limit} weeks above 20 h in the last 12 months",
			{ used: used.value, limit: limit.value },
		);
	}
	return t("settings.contracts.workingStudent.finding.generic", "Working-student limit at risk");
}

function SeverityBadge({ severity }: { severity: WorkingStudentFindingView["severity"] }) {
	const { t } = useTranslate();
	return severity === "critical" ? (
		<Badge variant="destructive">
			{t("settings.contracts.workingStudent.severity.critical", "Critical")}
		</Badge>
	) : (
		<Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
			{t("settings.contracts.workingStudent.severity.warning", "Warning")}
		</Badge>
	);
}

export function AcknowledgementBadge({
	status,
}: {
	status: "none" | "current" | "stale" | undefined;
}) {
	const { t } = useTranslate();
	if (status === "current") {
		return (
			<Badge variant="secondary">
				{t("settings.contracts.workingStudent.ack.current", "Acknowledged")}
			</Badge>
		);
	}
	if (status === "stale") {
		return (
			<Badge variant="outline">
				{t("settings.contracts.workingStudent.ack.stale", "Changed since acknowledged")}
			</Badge>
		);
	}
	return null;
}

function weekStatus(week: WorkingStudentWeekView, t: Translate) {
	if (week.lectureBreach) {
		return (
			<Badge variant="destructive">
				{t("settings.contracts.workingStudent.week.breach", "Above 20 h in lecture time")}
			</Badge>
		);
	}
	if (week.overLimit) {
		return (
			<Badge variant="outline">
				{t("settings.contracts.workingStudent.week.permitted", "Above 20 h, permitted")}
			</Badge>
		);
	}
	return (
		<span className="text-muted-foreground text-xs">
			{t("settings.contracts.workingStudent.week.within", "Within 20 h")}
		</span>
	);
}

function useMonitorMutation<Input>(
	organizationId: string,
	employeeId: string,
	run: (
		input: Input,
	) => Promise<{ success: true } | { success: false; error: string; refusal?: string }>,
	successMessage: string,
) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: Input) => {
			const result = await run(input);
			if (!result.success) throw new Error(actionErrorMessage(t, result, CONTEXT_REFUSALS));
		},
		onSuccess: () => {
			toast.success(successMessage);
			void invalidateWorkingStudentFindings(queryClient, organizationId, employeeId);
		},
		onError: (error) => toast.error(error.message),
	});
}

function VoidControl({
	label,
	onVoid,
	pending,
}: {
	label: string;
	onVoid: (reason: string) => Promise<void>;
	pending: boolean;
}) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			await onVoid(value.reason);
			setOpen(false);
		},
	});
	if (!open) {
		return (
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => setOpen(true)}
				aria-label={label}
			>
				<IconTrash className="size-4" aria-hidden="true" />
			</Button>
		);
	}
	return (
		<form
			noValidate
			className="flex flex-wrap items-start gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="reason"
				validators={{
					onSubmit: ({ value }) =>
						value.trim()
							? undefined
							: t(
									"settings.contracts.workingStudent.voidReasonRequired",
									"Say why this entry is voided.",
								),
				}}
			>
				{(field) => (
					<TFormItem className="min-w-56 flex-1">
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name={field.name}
								value={field.state.value}
								placeholder={t(
									"settings.contracts.workingStudent.voidReason",
									"Reason for voiding",
								)}
								aria-label={t("settings.contracts.workingStudent.voidReason", "Reason for voiding")}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
						<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<Button type="submit" size="sm" variant="destructive" disabled={pending}>
				{t("settings.contracts.workingStudent.void", "Void")}
			</Button>
			<Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
				{t("settings.contracts.workingStudent.cancel", "Cancel")}
			</Button>
		</form>
	);
}

function LectureFreeForm({
	organizationId,
	employeeId,
}: {
	organizationId: string;
	employeeId: string;
}) {
	const { t } = useTranslate();
	const mutation = useMonitorMutation(
		organizationId,
		employeeId,
		recordWorkingStudentLectureFreePeriodAction,
		t("settings.contracts.workingStudent.lectureFree.saved", "Lecture-free period recorded"),
	);
	const form = useForm({
		defaultValues: { startsOn: "", endsOn: "", note: "" },
		onSubmit: async ({ value, formApi }) => {
			await mutation.mutateAsync({
				employeeId,
				startsOn: value.startsOn,
				endsOn: value.endsOn,
				note: value.note.trim() || null,
			});
			formApi.reset();
		},
	});
	const required = (value: string) =>
		value ? undefined : t("settings.contracts.workingStudent.dateRequired", "Choose a date.");

	return (
		<form
			noValidate
			aria-busy={mutation.isPending}
			className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="startsOn" validators={{ onSubmit: ({ value }) => required(value) }}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t(
								"settings.contracts.workingStudent.lectureFree.startsOn",
								"First lecture-free day",
							)}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								type="date"
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
			<form.Field name="endsOn" validators={{ onSubmit: ({ value }) => required(value) }}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.contracts.workingStudent.lectureFree.endsOn", "Last lecture-free day")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								type="date"
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
			<form.Field name="note">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("settings.contracts.workingStudent.note", "Note (optional)")}
						</TFormLabel>
						<TFormControl>
							<Input
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<Button type="submit" disabled={mutation.isPending}>
				{mutation.isPending ? (
					<IconLoader2
						className="size-4 animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>
				) : (
					<IconPlus className="size-4" aria-hidden="true" />
				)}
				{t("settings.contracts.workingStudent.lectureFree.add", "Add period")}
			</Button>
		</form>
	);
}

function PriorWeeksForm({
	organizationId,
	employeeId,
}: {
	organizationId: string;
	employeeId: string;
}) {
	const { t } = useTranslate();
	const mutation = useMonitorMutation(
		organizationId,
		employeeId,
		recordWorkingStudentPriorWeeksAction,
		t("settings.contracts.workingStudent.prior.saved", "Prior-employer weeks recorded"),
	);
	const form = useForm({
		defaultValues: { firstWeekStartsOn: "", count: 1, sourceEmployer: "", note: "" },
		onSubmit: async ({ value, formApi }) => {
			await mutation.mutateAsync({
				employeeId,
				firstWeekStartsOn: value.firstWeekStartsOn,
				count: value.count,
				sourceEmployer: value.sourceEmployer.trim() || null,
				note: value.note,
			});
			formApi.reset();
		},
	});

	return (
		<form
			noValidate
			aria-busy={mutation.isPending}
			className="grid gap-3 sm:grid-cols-2"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="firstWeekStartsOn"
				validators={{
					onSubmit: ({ value }) => {
						if (!value)
							return t("settings.contracts.workingStudent.dateRequired", "Choose a date.");
						return parsePlainDate(value).dayOfWeek === 1
							? undefined
							: t(
									"settings.contracts.workingStudent.prior.monday",
									"Choose the Monday the first week starts on.",
								);
					},
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.contracts.workingStudent.prior.firstWeek", "First week (Monday)")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								type="date"
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
			<form.Field
				name="count"
				validators={{
					onSubmit: ({ value }) =>
						Number.isInteger(value) && value >= 1 && value <= 53
							? undefined
							: t(
									"settings.contracts.workingStudent.refusal.invalidValue",
									"Enter a number of weeks from 1 to 53.",
								),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.contracts.workingStudent.prior.count", "Consecutive weeks above 20 h")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								type="number"
								inputMode="numeric"
								min={1}
								max={53}
								step={1}
								className="tabular-nums"
								name={field.name}
								value={Number.isNaN(field.state.value) ? "" : field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.valueAsNumber)}
							/>
						</TFormControl>
						<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="sourceEmployer">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t(
								"settings.contracts.workingStudent.prior.employer",
								"Previous employer (optional)",
							)}
						</TFormLabel>
						<TFormControl>
							<Input
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="note"
				validators={{
					onSubmit: ({ value }) =>
						value.trim()
							? undefined
							: t(
									"settings.contracts.workingStudent.refusal.noteRequired",
									"Add a note explaining the entry.",
								),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.contracts.workingStudent.prior.note", "Evidence")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name={field.name}
								value={field.state.value}
								placeholder={t(
									"settings.contracts.workingStudent.prior.notePlaceholder",
									"e.g. certificate of the previous employer",
								)}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
						<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<div className="flex justify-end sm:col-span-2">
				<Button type="submit" disabled={mutation.isPending}>
					{mutation.isPending ? (
						<IconLoader2
							className="size-4 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
					) : (
						<IconPlus className="size-4" aria-hidden="true" />
					)}
					{t("settings.contracts.workingStudent.prior.add", "Add prior weeks")}
				</Button>
			</div>
		</form>
	);
}

function MonitorContent({
	view,
	organizationId,
	employeeId,
	canManage,
	locale,
}: {
	view: WorkingStudentMonitorView;
	organizationId: string;
	employeeId: string;
	canManage: boolean;
	locale: string;
}) {
	const { t } = useTranslate();
	const formatDate = (date: string) => formatPlainDate(parsePlainDate(date), locale, "dateMedium");
	const voidPeriod = useMonitorMutation(
		organizationId,
		employeeId,
		voidWorkingStudentLectureFreePeriodAction,
		t("settings.contracts.workingStudent.voided", "Entry voided"),
	);
	const voidPrior = useMonitorMutation(
		organizationId,
		employeeId,
		voidWorkingStudentPriorWeeksAction,
		t("settings.contracts.workingStudent.voided", "Entry voided"),
	);
	const openFindings = view.findings.filter(
		(finding) => finding.acknowledgement?.status !== "current",
	);
	// Weeks with a profile change carry minutes worked under another profile.
	const showOtherProfile = view.weeks.some((week) => week.otherProfileMinutes > 0);

	return (
		<div className="space-y-6">
			{view.rolling ? (
				<section aria-labelledby="ws-rolling" className="space-y-1">
					<h3 id="ws-rolling" className="font-medium text-sm">
						{t("settings.contracts.workingStudent.rolling.title", "26-week balance")}
					</h3>
					<p className="text-sm">
						{view.rolling.limitWeeks === null
							? t(
									"settings.contracts.workingStudent.rolling.noBaseline",
									"No statutory baseline covers this week.",
								)
							: t(
									"settings.contracts.workingStudent.rolling.summary",
									"{used} of {limit} weeks above 20 h in the last 12 months; {remaining} remaining.",
									{
										used: view.rolling.usedWeeks,
										limit: view.rolling.limitWeeks,
										remaining: view.rolling.remainingWeeks ?? 0,
									},
								)}
					</p>
				</section>
			) : (
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.contracts.workingStudent.notCurrent",
						"Not a working student this week. Recorded weeks and periods stay available.",
					)}
				</p>
			)}

			{openFindings.length > 0 && (
				<ul
					className="space-y-2"
					aria-label={t("settings.contracts.workingStudent.findings", "Open findings")}
				>
					{openFindings.map((finding) => (
						<li
							key={finding.id}
							className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
						>
							<IconAlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
							<SeverityBadge severity={finding.severity} />
							<span className="font-medium tabular-nums">{finding.subjectKey}</span>
							<span>{workingStudentFindingText(finding, t, locale)}</span>
							<AcknowledgementBadge status={finding.acknowledgement?.status} />
						</li>
					))}
				</ul>
			)}

			{view.weeks.length > 0 && (
				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.contracts.workingStudent.column.week", "Week")}</TableHead>
								<TableHead className="text-right">
									{t("settings.contracts.workingStudent.column.total", "Total")}
								</TableHead>
								<TableHead className="text-right">
									{t("settings.contracts.workingStudent.column.core", "Lecture daytime")}
								</TableHead>
								<TableHead className="text-right">
									{t("settings.contracts.workingStudent.column.lectureFree", "Lecture-free")}
								</TableHead>
								<TableHead className="text-right">
									{t("settings.contracts.workingStudent.column.eveningWeekend", "Evening/weekend")}
								</TableHead>
								{showOtherProfile && (
									<TableHead className="text-right">
										{t("settings.contracts.workingStudent.column.otherProfile", "Other profile")}
									</TableHead>
								)}
								<TableHead>
									{t("settings.contracts.workingStudent.column.status", "Status")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{view.weeks.map((week) => (
								<TableRow key={week.weekStart}>
									<TableCell className="whitespace-nowrap text-xs tabular-nums">
										<span className="font-medium">{week.subjectKey}</span>{" "}
										<span className="text-muted-foreground">{formatDate(week.weekStart)}</span>
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{hours(week.totalMinutes, locale)} h
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{hours(week.coreMinutes, locale)} h
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{hours(week.lectureFreeMinutes, locale)} h
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{hours(week.eveningWeekendMinutes, locale)} h
									</TableCell>
									{showOtherProfile && (
										<TableCell className="text-right tabular-nums">
											{hours(week.otherProfileMinutes, locale)} h
										</TableCell>
									)}
									<TableCell>{weekStatus(week, t)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<section aria-labelledby="ws-lecture-free" className="space-y-3">
				<h3 id="ws-lecture-free" className="font-medium text-sm">
					{t("settings.contracts.workingStudent.lectureFree.title", "Lecture-free periods")}
				</h3>
				{view.lectureFreePeriods.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t(
							"settings.contracts.workingStudent.lectureFree.empty",
							"No lecture-free periods recorded.",
						)}
					</p>
				) : (
					<ul className="space-y-2">
						{view.lectureFreePeriods.map((period) => (
							<li
								key={period.id}
								className="flex flex-wrap items-center justify-between gap-2 text-sm"
							>
								<span className="tabular-nums">
									{formatDate(period.startsOn)} – {formatDate(period.endsOn)}
									{period.note ? (
										<span className="text-muted-foreground"> · {period.note}</span>
									) : null}
								</span>
								{canManage && (
									<VoidControl
										label={t(
											"settings.contracts.workingStudent.lectureFree.void",
											"Void lecture-free period",
										)}
										pending={voidPeriod.isPending}
										onVoid={(reason) =>
											voidPeriod.mutateAsync({ employeeId, periodId: period.id, reason })
										}
									/>
								)}
							</li>
						))}
					</ul>
				)}
				{canManage && <LectureFreeForm organizationId={organizationId} employeeId={employeeId} />}
			</section>

			{canManage && view.priorWeeks && (
				<section aria-labelledby="ws-prior" className="space-y-3">
					<h3 id="ws-prior" className="font-medium text-sm">
						{t("settings.contracts.workingStudent.prior.title", "Prior-employer weeks above 20 h")}
					</h3>
					{view.priorWeeks.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.contracts.workingStudent.prior.empty",
								"No prior-employer weeks recorded.",
							)}
						</p>
					) : (
						<ul className="space-y-2">
							{view.priorWeeks.map((run) => (
								<li
									key={run.id}
									className="flex flex-wrap items-center justify-between gap-2 text-sm"
								>
									<span>
										{t(
											"settings.contracts.workingStudent.prior.run",
											"{count, plural, one {# week} other {# weeks}} from {from}",
											{ count: run.count, from: formatDate(run.firstWeekStartsOn) },
										)}
										{run.sourceEmployer ? ` · ${run.sourceEmployer}` : ""}
										<span className="text-muted-foreground"> · {run.note}</span>
									</span>
									<VoidControl
										label={t(
											"settings.contracts.workingStudent.prior.void",
											"Void prior-employer weeks",
										)}
										pending={voidPrior.isPending}
										onVoid={(reason) =>
											voidPrior.mutateAsync({ employeeId, offsetId: run.id, reason })
										}
									/>
								</li>
							))}
						</ul>
					)}
					<PriorWeeksForm organizationId={organizationId} employeeId={employeeId} />
				</section>
			)}
		</div>
	);
}

/**
 * Working-student monitor on Employee Detail (#1991): the 20-hour lecture-week rule, the rolling
 * 26-week balance and the statutory context behind them. Renders nothing for employees who never
 * had working-student terms. Org admins (`canManage`) record lecture-free periods and prior-employer
 * weeks; scoped managers read the wage-free view.
 */
export function WorkingStudentMonitorCard({
	organizationId,
	employeeId,
	canManage,
}: {
	organizationId: string;
	employeeId: string;
	canManage: boolean;
}) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const query = useQuery({
		queryKey: workingStudentQueryKeys.monitor(organizationId, employeeId),
		queryFn: async () => {
			const result = await getWorkingStudentMonitorAction({ employeeId });
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
		staleTime: 60 * 1000,
	});

	if (query.isLoading || (query.data && !query.data.applies)) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconSchool className="size-5 text-primary" aria-hidden="true" />
					{t("settings.contracts.workingStudent.title", "Working student (§ 6 SGB V)")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.contracts.workingStudent.description",
						"In lecture periods, weekday daytime work (06:00–18:00) may not exceed 20 hours a week; evening, night, weekend and lecture-free work may. Every week above 20 hours counts toward 26 weeks in 12 months, including weeks under another employment profile. Warnings never block clocking.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isError || !query.data ? (
					<Alert variant="destructive">
						<IconAlertTriangle className="size-4" aria-hidden="true" />
						<AlertDescription>
							{t(
								"settings.contracts.workingStudent.loadFailed",
								"Could not load the working-student monitor.",
							)}
						</AlertDescription>
					</Alert>
				) : (
					<MonitorContent
						view={query.data}
						organizationId={organizationId}
						employeeId={employeeId}
						canManage={canManage}
						locale={locale}
					/>
				)}
			</CardContent>
		</Card>
	);
}
