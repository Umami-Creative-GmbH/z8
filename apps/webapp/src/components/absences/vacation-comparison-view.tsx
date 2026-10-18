"use client";

import {
	IconAlertTriangle,
	IconCopy,
	IconLoader2,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { type UseQueryResult, useQueries } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useEffect, useId, useRef } from "react";
import { getAbsenceComparisonPreview } from "@/app/[locale]/(app)/absences/actions";
import type { AbsenceComparisonRefusal } from "@/app/[locale]/(app)/absences/plan-preview";
import { Button } from "@/components/ui/button";
import type { AbsencePlanPreview } from "@/lib/absences/absence-plan-preview";
import {
	addComparisonAlternative,
	type ComparisonDates,
	type ComparisonOption,
	canAddComparisonAlternative,
	comparisonDatesOf,
	comparisonOptionIssue,
	comparisonOptions,
	comparisonPreviewRequest,
	duplicateComparisonOption,
	removeComparisonAlternative,
	updateComparisonAlternative,
	type VacationComparison,
} from "@/lib/absences/vacation-comparison";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";
import { queryKeys } from "@/lib/query/keys";
import {
	ABSENCE_DURATION_FIELDS,
	AbsenceDurationFields,
	durationIssueMessage,
	useAbsenceForm,
} from "./absence-duration-fields";
import { noWorkingDaysMessage } from "./absence-plan-preview-messages";
import { AbsencePlanPreviewSections } from "./absence-plan-preview-panel";

type TranslateFn = ReturnType<typeof useTranslate>["t"];

type OptionQuery = UseQueryResult<AbsencePlanPreview, Error>;

/** A refused or failed comparison evaluation; `code` set when the server refused the option. */
class ComparisonPreviewError extends Error {
	constructor(
		message: string,
		readonly code: AbsenceComparisonRefusal | undefined,
	) {
		super(message);
	}
}

interface VacationComparisonViewProps {
	comparison: VacationComparison;
	onChange: (comparison: VacationComparison) => void;
	onApply: (option: ComparisonOption, label: string) => void;
	organizationId: string;
	userId: string;
}

/**
 * Compares the original draft with up to two alternatives (#1342). Each option is its own
 * hypothetical request, evaluated by the shared preview; options never deduct from each other and
 * nothing is saved, reserved or submitted.
 */
export function VacationComparisonView({
	comparison,
	onChange,
	onApply,
	organizationId,
	userId,
}: VacationComparisonViewProps) {
	const { t } = useTranslate();
	const options = comparisonOptions(comparison);
	const queries = useQueries({
		queries: options.map((option) => {
			const request = comparisonPreviewRequest(comparison.categoryId, option);
			return {
				// Keyed by context and input: a response for an earlier input never lands on this one.
				queryKey: queryKeys.absencePlanPreview.comparison(organizationId, userId, request),
				queryFn: async (): Promise<AbsencePlanPreview> => {
					const result = await getAbsenceComparisonPreview(request);
					if (!result.success) {
						throw new ComparisonPreviewError(result.error, result.code);
					}
					return result.data;
				},
				enabled: comparisonOptionIssue(option) === null,
				// Opening the comparison always evaluates every option again.
				staleTime: 0,
				// A refusal does not change on retry; a failed read is retried once.
				retry: (failureCount: number, error: Error) =>
					!(error instanceof ComparisonPreviewError && error.code) && failureCount < 1,
			};
		}),
	});
	const canAdd = canAddComparisonAlternative(comparison);
	const containerRef = useRef<HTMLDivElement>(null);
	// Keyboard and screen-reader users land on the comparison, not on the panel edge.
	useEffect(() => {
		containerRef.current?.focus();
	}, []);
	const isRefreshing = queries.some((query) => query.isFetching);

	const refreshAll = () => {
		options.forEach((option, index) => {
			if (comparisonOptionIssue(option) === null) void queries[index]?.refetch();
		});
	};

	return (
		<div className="space-y-4 outline-none" ref={containerRef} tabIndex={-1}>
			<p className="text-muted-foreground text-sm">
				{t(
					"absences.comparison.description",
					"Compare your request with up to two other date ranges. Each option is checked on its own against your recorded balances and the published schedule. Nothing is saved, reserved or submitted.",
				)}
			</p>
			<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
				<Button
					type="button"
					variant="outline"
					onClick={() => onChange(addComparisonAlternative(comparison))}
					disabled={!canAdd}
				>
					<IconPlus className="size-4" aria-hidden="true" />
					{t("absences.comparison.addAlternative", "Add alternative")}
				</Button>
				<Button type="button" variant="outline" onClick={refreshAll} disabled={isRefreshing}>
					<IconRefresh
						className={isRefreshing ? "size-4 motion-safe:animate-spin" : "size-4"}
						aria-hidden="true"
					/>
					{t("absences.comparison.refreshAll", "Refresh all")}
				</Button>
				{!canAdd && (
					<p className="text-muted-foreground text-xs">
						{t("absences.comparison.capReached", "You can compare up to two alternatives.")}
					</p>
				)}
			</div>
			<ol className="space-y-4">
				{options.map((option, index) => (
					<li key={option.id}>
						<ComparisonOptionCard
							canDuplicate={canAdd}
							comparison={comparison}
							onApply={onApply}
							onChange={onChange}
							option={option}
							query={queries[index]}
						/>
					</li>
				))}
			</ol>
		</div>
	);
}

function optionLabel(option: ComparisonOption, t: TranslateFn) {
	return option.kind === "original"
		? t("absences.comparison.original", "Original request")
		: t("absences.comparison.alternative", "Alternative {number}", {
				number: String(option.position),
			});
}

function ComparisonOptionCard({
	canDuplicate,
	comparison,
	onApply,
	onChange,
	option,
	query,
}: {
	canDuplicate: boolean;
	comparison: VacationComparison;
	onApply: VacationComparisonViewProps["onApply"];
	onChange: VacationComparisonViewProps["onChange"];
	option: ComparisonOption;
	query: OptionQuery | undefined;
}) {
	const { t } = useTranslate();
	const headingId = useId();
	const label = optionLabel(option, t);
	const issue = comparisonOptionIssue(option);
	const update = (patch: Partial<ComparisonDates>) =>
		onChange(updateComparisonAlternative(comparison, option.id, patch));

	return (
		<section
			aria-labelledby={headingId}
			className={
				option.kind === "original"
					? "space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:p-4"
					: "space-y-3 rounded-lg border p-3 sm:p-4"
			}
		>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 space-y-1">
					<h3 className="font-semibold leading-none" id={headingId}>
						{label}
					</h3>
					{option.kind === "original" && (
						<p className="text-muted-foreground text-xs">
							{t("absences.comparison.originalHint", "Your current draft, kept as the baseline.")}
						</p>
					)}
					{issue === null && <OptionDates option={option} />}
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onChange(duplicateComparisonOption(comparison, option.id))}
						disabled={!canDuplicate}
						aria-label={t("absences.comparison.duplicateOption", "Duplicate {option}", {
							option: label,
						})}
					>
						<IconCopy className="size-4" aria-hidden="true" />
						{t("absences.comparison.duplicate", "Duplicate")}
					</Button>
					{option.kind === "alternative" && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => onChange(removeComparisonAlternative(comparison, option.id))}
							aria-label={t("absences.comparison.removeOption", "Remove {option}", {
								option: label,
							})}
						>
							<IconTrash className="size-4" aria-hidden="true" />
							{t("absences.comparison.remove", "Remove")}
						</Button>
					)}
				</div>
			</div>

			{option.kind === "alternative" && <AlternativeEditor option={option} onUpdate={update} />}

			{issue === "start_date_required" ? (
				// A new alternative has no dates yet: a prompt, not an error.
				<p className="rounded-md border border-dashed px-3 py-2 text-muted-foreground text-sm">
					{durationIssueMessage(issue, t)}
				</p>
			) : issue !== null ? (
				// An alternative's editor shows the issue at the field it concerns.
				option.kind === "original" && (
					<p
						aria-live="polite"
						className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm"
					>
						{durationIssueMessage(issue, t)}
					</p>
				)
			) : (
				<OptionResult query={query} />
			)}

			<div className="flex flex-col sm:flex-row sm:justify-end">
				<Button
					type="button"
					variant={option.kind === "original" ? "outline" : "default"}
					onClick={() => onApply(option, label)}
					disabled={issue !== null}
					aria-label={t("absences.comparison.applyOption", "Apply {option} to request", {
						option: label,
					})}
				>
					{option.kind === "original"
						? t("absences.comparison.keepOriginal", "Keep original dates")
						: t("absences.comparison.useDates", "Use these dates")}
				</Button>
			</div>
		</section>
	);
}

/**
 * The option's exact dates and, for a partial day, its wall-clock times in the organization.
 * Rendered only for a valid option, whose dates parse.
 */
function OptionDates({ option }: { option: ComparisonOption }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const endDate = option.endDate || option.startDate;
	const dates = formatPlainDateRange(
		parsePlainDate(option.startDate),
		parsePlainDate(endDate),
		locale,
		"dateMedium",
	);
	if (option.durationKind !== "partial_day") {
		return (
			<p className="text-sm tabular-nums">
				{t("absences.comparison.fullDays", "{dates} · full days", { dates })}
			</p>
		);
	}
	const overnight = endDate !== option.startDate;
	return (
		<p className="text-sm tabular-nums">
			{overnight
				? t("absences.comparison.partialOvernight", "{dates} · {start}-{end} (ends next day)", {
						dates,
						start: option.startTime,
						end: option.endTime,
					})
				: t("absences.comparison.partialDay", "{dates} · {start}-{end}", {
						dates,
						start: option.startTime,
						end: option.endTime,
					})}
		</p>
	);
}

/** An alternative's dates, duration and times: the request form's fields in a form of its own. */
function AlternativeEditor({
	option,
	onUpdate,
}: {
	option: ComparisonOption;
	onUpdate: (patch: Partial<ComparisonDates>) => void;
}) {
	const { t } = useTranslate();
	const form = useAbsenceForm({
		defaultValues: comparisonDatesOf(option),
		listeners: {
			// The comparison holds the option; each edit re-evaluates only this option.
			onChange: ({ formApi }) => onUpdate(formApi.state.values),
		},
	});
	return (
		<AbsenceDurationFields
			form={form}
			fields={ABSENCE_DURATION_FIELDS}
			labels={{
				startDate: t("absences.comparison.startDate", "Start date"),
				endDate: t("absences.comparison.endDate", "End date"),
				duration: t("absences.comparison.duration", "Duration"),
				startTime: t("absences.comparison.startTime", "Start time"),
				endTime: t("absences.comparison.endTime", "End time"),
			}}
		/>
	);
}

function OptionResult({ query }: { query: OptionQuery | undefined }) {
	const { t } = useTranslate();
	if (!query || query.isLoading) {
		return (
			<output
				aria-live="polite"
				className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground text-sm"
			>
				<IconLoader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
				<span>{t("absences.comparison.checking", "Checking this option…")}</span>
			</output>
		);
	}
	if (query.isError && !query.data) {
		const refusal = query.error instanceof ComparisonPreviewError ? query.error.code : undefined;
		return (
			<div
				className="flex flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
				role="status"
			>
				<span className="flex items-start gap-2 text-muted-foreground">
					<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					{refusalMessage(refusal, t)}
				</span>
				{!refusal && (
					<Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>
						{t("absences.comparison.retry", "Try again")}
					</Button>
				)}
			</div>
		);
	}
	const preview = query.data;
	if (!preview) return null;
	return (
		<div className="space-y-3">
			{query.isFetching && (
				<output
					aria-live="polite"
					className="flex items-center gap-2 text-muted-foreground text-xs"
				>
					<IconLoader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
					{t("absences.comparison.refreshing", "Refreshing…")}
				</output>
			)}
			{query.isError && !query.isFetching && (
				<p className="flex items-start gap-2 text-muted-foreground text-xs" role="status">
					<IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
					{t(
						"absences.comparison.refreshFailed",
						"This option could not be refreshed. It shows the earlier check below.",
					)}
				</p>
			)}
			{preview.refusal === "no_working_days" && (
				<p className="flex items-start gap-2 text-destructive text-sm" role="alert">
					<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span>{noWorkingDaysMessage(t)}</span>
				</p>
			)}
			<div className="grid gap-3 sm:grid-cols-2">
				<AbsencePlanPreviewSections preview={preview} />
			</div>
		</div>
	);
}

/** Why an option was not evaluated: a refusal, which a retry would not change, or a failed read. */
function refusalMessage(refusal: AbsenceComparisonRefusal | undefined, t: TranslateFn) {
	switch (refusal) {
		case "comparison_ineligible":
			return t(
				"absences.comparison.ineligible",
				"Only vacation that uses your vacation balance can be compared.",
			);
		case "category_unavailable":
			return t(
				"absences.comparison.categoryUnavailable",
				"This absence type is no longer available. Go back and choose another type.",
			);
		case "invalid_option":
			return t("absences.comparison.invalidOption", "These dates can't be checked.");
		case undefined:
			return t(
				"absences.comparison.failed",
				"This option could not be checked. Your other options are not affected.",
			);
	}
}
