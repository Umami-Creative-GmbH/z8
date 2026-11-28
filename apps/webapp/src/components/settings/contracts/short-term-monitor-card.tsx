"use client";

import {
	IconCalendarStats,
	IconExternalLink,
	IconLoader2,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	recordAgriculturalDeclarationAction,
	getShortTermMonitorAction,
	recordShortTermPriorEmploymentAction,
	voidShortTermPriorEmploymentAction,
} from "@/app/[locale]/(app)/settings/contracts/short-term-actions";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { StatutoryUsageTier } from "@/lib/statutory/finding";
import type { ShortTermAllowance } from "@/lib/statutory/short-term/judge";
import type {
	ShortTermMonitor,
	ShortTermPriorEmployment,
} from "@/lib/statutory/short-term/monitor";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { formatCents, formatMonth, SHORT_TERM_REFUSALS } from "./short-term-format";
import { shortTermMonitorQueryKey } from "./short-term-query-keys";
import { type Translate, useFormattingLocale, VerificationStatusBadge } from "./short-term-shared";

type PriorKind = ShortTermPriorEmployment["kind"];

function tierLabel(tier: StatutoryUsageTier, t: Translate): string {
	switch (tier) {
		case "ok":
			return t("settings.contracts.shortTerm.tier.ok", "Within the limit");
		case "warning":
			return t("settings.contracts.shortTerm.tier.warning", "Approaching the limit");
		case "critical":
			return t("settings.contracts.shortTerm.tier.critical", "Limit almost reached");
		case "exceeded":
			return t("settings.contracts.shortTerm.tier.exceeded", "Limit exceeded");
	}
}

function quantity(value: number, kind: ShortTermAllowance["limitKind"], t: Translate): string {
	return kind === "work_days"
		? t(
				"settings.contracts.shortTerm.workDays",
				"{count, plural, one {# working day} other {# working days}}",
				{ count: value },
			)
		: t(
				"settings.contracts.shortTerm.calendarDays",
				"{count, plural, one {# calendar day} other {# calendar days}}",
				{ count: value },
			);
}

function priorKindLabel(kind: PriorKind, t: Translate): string {
	return kind === "prior_short_term_work_days"
		? t("settings.contracts.shortTerm.prior.kindDays", "Working days")
		: t("settings.contracts.shortTerm.prior.kindMonths", "Months");
}

function AllowanceSummary({ allowance, t }: { allowance: ShortTermAllowance; t: Translate }) {
	const percent = Math.min(100, allowance.usedPercent);
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<p className="font-semibold text-2xl tabular-nums">
					{allowance.used}
					<span className="font-normal text-base text-muted-foreground"> / {allowance.limit}</span>
				</p>
				<Badge
					variant={
						allowance.tier === "ok"
							? "secondary"
							: allowance.tier === "warning"
								? "outline"
								: "destructive"
					}
				>
					{tierLabel(allowance.tier, t)}
				</Badge>
			</div>
			<Progress
				value={percent}
				aria-label={t("settings.contracts.shortTerm.usedLabel", "Used share of the allowance")}
				className={cn(
					allowance.tier !== "ok" && "[&_[data-slot=progress-indicator]]:bg-destructive",
				)}
			/>
			<p className="text-sm">
				{t("settings.contracts.shortTerm.remaining", "{remaining} left in {year}", {
					remaining: quantity(allowance.remaining, allowance.limitKind, t),
					year: allowance.year,
				})}
			</p>
			<p className="text-muted-foreground text-xs">
				{allowance.limitKind === "work_days"
					? t(
							"settings.contracts.shortTerm.applicableWorkDayLimit",
							"Working-day limit ({limit} days): fewer than 5 working days a week on average, an irregular pattern, or such work together with 5-day weeks or prior working days. Every stint counts with its working days; prior employers are included.",
							{ limit: allowance.limit },
						)
					: allowance.limitKind === "weeks"
						? t(
								"settings.contracts.shortTerm.limitWeeks",
								"Agricultural duration limit: 15 weeks for a single stint or 105 calendar days for combined stints.",
							)
						: t(
								"settings.contracts.shortTerm.limitMonths",
								"3-month limit: 5 or more working days a week throughout. A single stint counts in calendar days up to 3 months from its first day; several stints, including prior employers, add up to 90 calendar days, a full calendar month counting as 30. Pauses between stints do not count.",
							)}{" "}
				{t(
					"settings.contracts.shortTerm.breakdown",
					"Z8 work and planned shifts: {own}; prior employers: {prior}.",
					{
						own: quantity(allowance.ownUsed, allowance.limitKind, t),
						prior: quantity(allowance.priorEmployerUsed, allowance.limitKind, t),
					},
				)}
			</p>
		</div>
	);
}

function VoidPriorEmploymentForm({
	organizationId,
	employeeId,
	entry,
	onDone,
	t,
}: {
	organizationId: string;
	employeeId: string;
	entry: ShortTermPriorEmployment;
	onDone: () => void;
	t: Translate;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async (reason: string) => {
			const result = await voidShortTermPriorEmploymentAction({
				employeeId,
				offsetId: entry.id,
				reason,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result, SHORT_TERM_REFUSALS));
		},
		onSuccess: () => {
			toast.success(t("settings.contracts.shortTerm.prior.voided", "Entry voided"));
			void queryClient.invalidateQueries({
				queryKey: shortTermMonitorQueryKey(organizationId, employeeId),
			});
			onDone();
		},
		onError: (error) => toast.error(error.message),
	});
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync(value.reason);
		},
	});
	return (
		<form
			noValidate
			className="flex flex-wrap items-end gap-2"
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
							: t("settings.contracts.shortTerm.refusal.noteRequired", "Add a note or reason."),
				}}
			>
				{(field) => (
					<TFormItem className="min-w-56 flex-1">
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.contracts.shortTerm.prior.voidReason", "Why is this entry wrong?")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
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
			<Button type="submit" size="sm" variant="destructive" disabled={mutation.isPending}>
				{t("settings.contracts.shortTerm.prior.voidSubmit", "Void entry")}
			</Button>
			<Button type="button" size="sm" variant="ghost" onClick={onDone}>
				{t("common.cancel", "Cancel")}
			</Button>
		</form>
	);
}

interface PriorEmploymentFormValues {
	kind: PriorKind;
	count: number;
	sourceEmployer: string;
	note: string;
}

function PriorEmploymentForm({
	organizationId,
	employeeId,
	year,
	t,
}: {
	organizationId: string;
	employeeId: string;
	year: number;
	t: Translate;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async (value: PriorEmploymentFormValues) => {
			const result = await recordShortTermPriorEmploymentAction({
				employeeId,
				kind: value.kind,
				calendarYear: year,
				count: value.count,
				sourceEmployer: value.sourceEmployer.trim() || null,
				note: value.note,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result, SHORT_TERM_REFUSALS));
		},
		onSuccess: () => {
			toast.success(t("settings.contracts.shortTerm.prior.recorded", "Prior employment recorded"));
			void queryClient.invalidateQueries({
				queryKey: shortTermMonitorQueryKey(organizationId, employeeId),
			});
			form.reset();
		},
		onError: (error) => toast.error(error.message),
	});
	const form = useForm({
		defaultValues: {
			kind: "prior_short_term_work_days",
			count: 0,
			sourceEmployer: "",
			note: "",
		} as PriorEmploymentFormValues,
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync(value);
		},
	});

	return (
		<form
			noValidate
			aria-busy={mutation.isPending}
			className="space-y-3 rounded-lg border p-3"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<p className="font-medium text-sm">
				{t("settings.contracts.shortTerm.prior.addTitle", "Add prior employment in {year}", {
					year,
				})}
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<form.Field name="kind">
					{(field) => (
						<TFormItem>
							<TFormLabel>{t("settings.contracts.shortTerm.prior.kind", "Counted in")}</TFormLabel>
							<Select
								value={field.state.value}
								onValueChange={(value) => field.handleChange(value as PriorKind)}
							>
								<TFormControl>
									<SelectTrigger>
										<SelectValue>{priorKindLabel(field.state.value, t)}</SelectValue>
									</SelectTrigger>
								</TFormControl>
								<SelectContent>
									<SelectItem value="prior_short_term_work_days">
										{priorKindLabel("prior_short_term_work_days", t)}
									</SelectItem>
									<SelectItem value="prior_short_term_months">
										{priorKindLabel("prior_short_term_months", t)}
									</SelectItem>
								</SelectContent>
							</Select>
						</TFormItem>
					)}
				</form.Field>
				<form.Field
					name="count"
					validators={{
						onChangeListenTo: ["kind"],
						onSubmit: ({ value, fieldApi }) => {
							const max =
								fieldApi.form.getFieldValue("kind") === "prior_short_term_months" ? 12 : 366;
							return Number.isInteger(value) && value >= 1 && value <= max
								? undefined
								: t(
										"settings.contracts.shortTerm.refusal.invalidValue",
										"Enter whole working days (1–366) or months (1–12).",
									);
						},
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.contracts.shortTerm.prior.count", "Number")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									type="number"
									inputMode="numeric"
									min={1}
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
						<TFormItem className="sm:col-span-2">
							<TFormLabel>
								{t(
									"settings.contracts.shortTerm.prior.sourceEmployer",
									"Prior employer (optional)",
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
								: t("settings.contracts.shortTerm.refusal.noteRequired", "Add a note or reason."),
					}}
				>
					{(field) => (
						<TFormItem className="sm:col-span-2">
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.contracts.shortTerm.prior.note", "Evidence")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Textarea
									rows={2}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
									placeholder={t(
										"settings.contracts.shortTerm.prior.notePlaceholder",
										"e.g. Employment certificate from the prior employer",
									)}
								/>
							</TFormControl>
							<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
			</div>
			<Button type="submit" size="sm" disabled={mutation.isPending}>
				{mutation.isPending ? (
					<IconLoader2
						className="mr-1 size-3.5 animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>
				) : (
					<IconPlus className="mr-1 size-3.5" aria-hidden="true" />
				)}
				{t("settings.contracts.shortTerm.prior.submit", "Record prior employment")}
			</Button>
		</form>
	);
}

function AgriculturalDeclarationForm({
	monitor,
	organizationId,
	t,
}: {
	monitor: ShortTermMonitor;
	organizationId: string;
	t: Translate;
}) {
	const client = useQueryClient();
	const locale = useFormattingLocale();
	const displayDate = (date: string) => formatPlainDate(parsePlainDate(date), locale, "dateMedium");
	const periodStart = (date: string | null | undefined) =>
		date
			? displayDate(date)
			: t("settings.contracts.shortTerm.declaration.unknownStart", "Unknown start date");
	const periods = monitor.declarationPeriods ?? [];
	const form = useForm({
		defaultValues: {
			periodId: periods.at(-1)?.id ?? "",
			effectiveFrom: "",
			establishmentNumber: "",
			eligible: false,
		},
		onSubmit: async ({ value }) => {
			const result = await recordAgriculturalDeclarationAction({
				...value,
				employeeId: monitor.employeeId,
			});
			if (!result.success) {
				toast.error(actionErrorMessage(t, result, {}));
				return;
			}
			await client.invalidateQueries({
				queryKey: shortTermMonitorQueryKey(organizationId, monitor.employeeId),
			});
			toast.success(t("settings.contracts.shortTerm.declaration.saved", "Declaration saved"));
		},
	});
	if (!periods.length) return null;
	return (
		<form
			className="space-y-2"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<h3>
				{t(
					"settings.contracts.shortTerm.declaration.title",
					"Agricultural establishment declaration",
				)}
			</h3>
			{monitor.declarations?.map((row) => (
				<Button
					key={row.periodId + row.effectiveFrom}
					type="button"
					variant="outline"
					onClick={() => form.reset({ ...row })}
				>
					{t(
						"settings.contracts.shortTerm.declaration.edit",
						"Edit declaration from {date} · {number} · Employment from {start}",
						{
							date: displayDate(row.effectiveFrom),
							number: row.establishmentNumber,
							start: periodStart(periods.find((p) => p.id === row.periodId)?.startDate),
						},
					)}
				</Button>
			))}
			<form.Field name="periodId">
				{(f) => (
					<TFormItem>
						<TFormLabel htmlFor={f.name}>
							{t("settings.contracts.shortTerm.declaration.period", "Employment period")}
						</TFormLabel>
						<Select value={f.state.value} onValueChange={f.handleChange}>
							<SelectTrigger id={f.name}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{periods.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{periodStart(p.startDate)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="effectiveFrom">
				{(f) => (
					<TFormItem>
						<TFormLabel htmlFor={f.name}>
							{t("settings.contracts.shortTerm.declaration.from", "Effective from")}
						</TFormLabel>
						<Input
							id={f.name}
							type="date"
							required
							value={f.state.value}
							onChange={(e) => f.handleChange(e.target.value)}
						/>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="establishmentNumber">
				{(f) => (
					<TFormItem>
						<TFormLabel htmlFor={f.name}>
							{t("settings.contracts.shortTerm.declaration.number", "Betriebsnummer (8 digits)")}
						</TFormLabel>
						<Input
							id={f.name}
							required
							pattern="[0-9]{8}"
							value={f.state.value}
							onChange={(e) => f.handleChange(e.target.value)}
						/>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="eligible">
				{(f) => (
					<Label>
						<Checkbox
							checked={f.state.value}
							onCheckedChange={(value) => f.handleChange(value === true)}
						/>
						{t(
							"settings.contracts.shortTerm.declaration.eligible",
							"The establishment qualifies under WZ 2025 groups 01.1–01.6. For mixed establishments, use the activity employing most employees.",
						)}
					</Label>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(pending) => (
					<Button type="submit" disabled={pending}>
						{t("settings.contracts.shortTerm.declaration.save", "Save declaration")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

function PriorEmploymentSection({
	organizationId,
	monitor,
	t,
}: {
	organizationId: string;
	monitor: ShortTermMonitor;
	t: Translate;
}) {
	const [voiding, setVoiding] = useState<string | null>(null);
	const entries = monitor.priorEmployment ?? [];
	return (
		<section className="space-y-3">
			<h3 className="font-medium text-sm">
				{t("settings.contracts.shortTerm.prior.title", "Prior employers in {year}", {
					year: monitor.year,
				})}
			</h3>
			{entries.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.contracts.shortTerm.prior.empty",
						"No prior short-term employment recorded.",
					)}
				</p>
			) : (
				<ul className="space-y-2">
					{entries.map((entry) => (
						<li key={entry.id} className="space-y-2 rounded-lg border p-3 text-sm">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="space-y-0.5">
									<p className="font-medium tabular-nums">
										{entry.count} · {priorKindLabel(entry.kind, t)}
										{entry.sourceEmployer ? ` · ${entry.sourceEmployer}` : ""}
									</p>
									<p className="text-muted-foreground text-xs">{entry.note}</p>
								</div>
								{voiding !== entry.id && (
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => setVoiding(entry.id)}
									>
										<IconTrash className="mr-1 size-3.5" aria-hidden="true" />
										{t("settings.contracts.shortTerm.prior.void", "Void")}
									</Button>
								)}
							</div>
							{voiding === entry.id && (
								<VoidPriorEmploymentForm
									organizationId={organizationId}
									employeeId={monitor.employeeId}
									entry={entry}
									onDone={() => setVoiding(null)}
									t={t}
								/>
							)}
						</li>
					))}
				</ul>
			)}
			<AgriculturalDeclarationForm monitor={monitor} organizationId={organizationId} t={t} />
			<PriorEmploymentForm
				organizationId={organizationId}
				employeeId={monitor.employeeId}
				year={monitor.year}
				t={t}
			/>
		</section>
	);
}

function VerificationSection({ monitor, t }: { monitor: ShortTermMonitor; t: Translate }) {
	const locale = useFormattingLocale();
	const prompts = monitor.findings.filter(
		(finding) => finding.kind === "short_term_berufsmaessigkeit_check",
	);
	if (prompts.length === 0) return null;
	return (
		<section className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium text-sm">
					{t("settings.contracts.shortTerm.verification.title", "Earnings above the Minijob limit")}
				</h3>
				<Button asChild variant="ghost" size="sm">
					<Link href="/settings/contracts?tab=reviews">
						<IconExternalLink className="mr-1 size-3.5" aria-hidden="true" />
						{t("settings.contracts.shortTerm.verification.openReviews", "Open Reviews & Conflicts")}
					</Link>
				</Button>
			</div>
			<ul className="space-y-2">
				{prompts.map((finding) => {
					const amounts = finding.adminDetail?.amountsCents;
					const currency = finding.adminDetail?.currency ?? "EUR";
					return (
						<li
							key={finding.id}
							className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
						>
							<span className="tabular-nums">
								{formatMonth(finding.subjectKey, locale)} ·{" "}
								{t("settings.contracts.shortTerm.verification.amounts", "{total} of {cap}", {
									total: formatCents(amounts?.total, currency, locale),
									cap: formatCents(amounts?.cap, currency, locale),
								})}
							</span>
							<VerificationStatusBadge acknowledgement={finding.acknowledgement} t={t} />
						</li>
					);
				})}
			</ul>
		</section>
	);
}

/**
 * #1990: the short-term employment monitor on Employee Detail. Scoped managers see the wage-free
 * allowance; org admins also see earnings checks and keep the prior-employer entries.
 */
export function ShortTermMonitorCard({
	organizationId,
	employeeId,
	isOrgAdmin,
}: {
	organizationId: string;
	employeeId: string;
	isOrgAdmin: boolean;
}) {
	const { t } = useTranslate();
	// Null: the organization's current year, as the server sees it.
	const [year, setYear] = useState<number | null>(null);
	const [currentYear, setCurrentYear] = useState<number | null>(null);
	const query = useQuery({
		queryKey: shortTermMonitorQueryKey(organizationId, employeeId, year),
		queryFn: async () => {
			const result = await getShortTermMonitorAction({ employeeId, year: year ?? undefined });
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			if (year === null) setCurrentYear(result.data.year);
			return result.data;
		},
		// Terms, wages, leaving dates and work policies change in other tabs and cards: refetch
		// whenever the card mounts instead of showing figures cached before them.
		refetchOnMount: "always",
		// While another year loads, keep this employee's card (and the focused year selector) on
		// screen. Never another organization's or employee's data.
		placeholderData: (previous, previousQuery) => {
			const [, , previousOrganization, previousEmployee] = previousQuery?.queryKey ?? [];
			return previousOrganization === organizationId && previousEmployee === employeeId
				? previous
				: undefined;
		},
	});
	const monitor = query.data;
	const loadingYear = query.isPlaceholderData;
	// Not short-term this year: the card stays to open last year or next year if one applies (a
	// fixed term agreed for next year counts as soon as it is agreed).
	const currentNotApplying = year === null && !loadingYear && monitor?.applies === false;
	const adjacentYear = (offset: number) => ({
		queryKey: shortTermMonitorQueryKey(
			organizationId,
			employeeId,
			monitor ? monitor.year + offset : null,
		),
		queryFn: async () => {
			const result = await getShortTermMonitorAction({
				employeeId,
				year: monitor ? monitor.year + offset : undefined,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
		enabled: currentNotApplying && monitor !== undefined,
		refetchOnMount: "always" as const,
	});
	const previous = useQuery(adjacentYear(-1));
	const next = useQuery(adjacentYear(1));
	// Nothing to show for employees who are short-term neither this year, last year nor next year.
	if (
		!monitor ||
		(currentNotApplying && previous.data?.applies !== true && next.data?.applies !== true)
	) {
		return null;
	}
	const thisYear = currentYear ?? monitor.year;
	const shownYear = year ?? thisYear;

	return (
		<Card id="short-term">
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1.5">
						<CardTitle className="flex items-center gap-2">
							<IconCalendarStats className="size-5 text-primary" aria-hidden="true" />
							{t("settings.contracts.shortTerm.title", "Short-term employment")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.contracts.shortTerm.description",
								"Calendar-year allowance under § 8 Abs. 1 Nr. 2 SGB IV, from completed work, planned shifts and prior employers. Warnings never block clocking in or out.",
							)}
						</CardDescription>
					</div>
					<Select
						value={String(shownYear)}
						onValueChange={(value) => {
							const chosen = Number(value);
							setYear(chosen === thisYear ? null : chosen);
						}}
					>
						<SelectTrigger
							className="w-28"
							aria-label={t("settings.contracts.shortTerm.year", "Calendar year")}
						>
							<SelectValue>{String(shownYear)}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{[thisYear + 1, thisYear, thisYear - 1].map((option) => (
								<SelectItem key={option} value={String(option)}>
									{option}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{loadingYear ? (
					<span role="status" aria-label={t("common.loading", "Loading…")}>
						<IconLoader2
							className="size-4 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
					</span>
				) : !monitor.applies ? (
					<p className="text-muted-foreground text-sm">
						{t("settings.contracts.shortTerm.notApplicable", "Not employed short-term in {year}.", {
							year: monitor.year,
						})}
					</p>
				) : monitor.allowance ? (
					<AllowanceSummary allowance={monitor.allowance} t={t} />
				) : (
					<p className="text-muted-foreground text-sm">
						{t(
							"settings.contracts.shortTerm.noBaseline",
							"No statutory limit is available for {year}.",
							{ year: monitor.year },
						)}
					</p>
				)}
				{isOrgAdmin && monitor.audience === "full" && !loadingYear && (
					<>
						<VerificationSection monitor={monitor} t={t} />
						<PriorEmploymentSection organizationId={organizationId} monitor={monitor} t={t} />
					</>
				)}
			</CardContent>
		</Card>
	);
}
