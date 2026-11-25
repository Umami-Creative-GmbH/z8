"use client";

import { IconCalendarEvent, IconExternalLink, IconLock } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useId } from "react";
import type { DateRange } from "@/app/[locale]/(app)/scheduling/types";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { Badge } from "@/components/ui/badge";
import type { StatutorySeverity } from "@/lib/statutory/finding";
import { statutoryReviewDomainOf } from "@/lib/statutory/review-domains";
import type {
	ScheduleStatutoryFindingItem,
	ScheduleStatutoryFindings,
} from "@/lib/statutory/scheduling/findings-list";
import { Link } from "@/navigation";
import { statutoryWarningText } from "../statutory-warning-text";
import {
	outsideScopeText,
	statutoryFindingFocusDate,
	statutoryFindingWhen,
} from "./statutory-findings-format";

type Translate = ReturnType<typeof useTranslate>["t"];

function severityLabel(severity: StatutorySeverity, t: Translate): string {
	switch (severity) {
		case "critical":
			return t("scheduling:scheduling.statutory.findings.severity.critical", "Critical");
		case "warning":
			return t("scheduling:scheduling.statutory.findings.severity.warning", "Warning");
		case "info":
			return t("scheduling:scheduling.statutory.findings.severity.info", "Note");
	}
}

const SEVERITY_BADGE: Record<StatutorySeverity, string> = {
	critical: "border-destructive/40 bg-destructive/10 text-destructive",
	warning:
		"border-amber-400/60 bg-amber-100/70 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/60 dark:text-amber-100",
	info: "",
};

interface StatutoryFindingsListProps {
	findings: ScheduleStatutoryFindings;
	/** The visible range: where a finding's calendar link opens. */
	dateRange: DateRange;
	/**
	 * Employees with shifts in the visible range: only they get a link to their shifts. Every
	 * listed employee gets one when omitted.
	 */
	shiftEmployeeIds?: ReadonlySet<string>;
	/** The list's accessible name. */
	label?: string;
	/** An `id` for the element that wraps the list, e.g. for `aria-controls`. */
	id?: string;
	/** Collapsed behind a disclosure: kept in the document, hidden. */
	hidden?: boolean;
	/**
	 * Called when a shift link is followed, e.g. to close the dialog around the list: the link may
	 * point at the page the viewer is already on, which would leave the dialog open.
	 */
	onShiftLinkClick?: () => void;
}

/**
 * Scheduling's statutory findings (#2026): who, which limit in plain words, which day or week, its
 * severity, whether publishing the drafts is refused for it, and the way to the employee's shifts. Wage-free: items
 * carry the restricted summary only. Org admins also get the matching Reviews & Conflicts domain.
 */
export function StatutoryFindingsList({
	findings,
	dateRange,
	shiftEmployeeIds,
	label,
	id,
	hidden,
	onShiftLinkClick,
}: StatutoryFindingsListProps) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() || "en";
	const generatedId = useId();
	const wrapperId = id ?? generatedId;

	return (
		<div id={wrapperId} hidden={hidden} className="space-y-2">
			{findings.items.length > 0 && (
				<ul
					// Safari drops the implicit list role of a list without list styles: keep it explicit.
					// oxlint-disable-next-line jsx-a11y/no-redundant-roles
					role="list"
					className="divide-y rounded-md border bg-background text-foreground"
					aria-label={
						label ?? t("scheduling:scheduling.statutory.findings.listLabel", "Statutory findings")
					}
				>
					{findings.items.map((item) => (
						<StatutoryFindingRow
							key={`${item.finding.findingId}|${item.finding.day ?? item.finding.releaseDay ?? ""}`}
							item={item}
							locale={locale}
							dateRange={dateRange}
							showShiftsLink={!shiftEmployeeIds || shiftEmployeeIds.has(item.finding.employeeId)}
							canOpenReviews={findings.canOpenReviews}
							onShiftLinkClick={onShiftLinkClick}
						/>
					))}
				</ul>
			)}
			{findings.outsideScopeCount > 0 && (
				<p className="text-sm text-muted-foreground">
					{outsideScopeText(findings.outsideScopeCount, findings.items.length > 0, t)}
				</p>
			)}
		</div>
	);
}

function StatutoryFindingRow({
	item,
	locale,
	dateRange,
	showShiftsLink,
	canOpenReviews,
	onShiftLinkClick,
}: {
	item: ScheduleStatutoryFindingItem;
	locale: string;
	dateRange: DateRange;
	showShiftsLink: boolean;
	canOpenReviews: boolean;
	onShiftLinkClick?: () => void;
}) {
	const { t } = useTranslate();
	const timeFormat = useTimeFormat();
	const { finding } = item;
	const employeeName =
		item.employeeName ||
		t("scheduling:scheduling.statutory.findings.unnamedEmployee", "Unnamed employee");
	const when = statutoryFindingWhen(item, locale, t);
	const shiftsHref = `/scheduling?${new URLSearchParams({
		employeeId: finding.employeeId,
		date: statutoryFindingFocusDate(item, dateRange),
	}).toString()}`;
	const reviewsHref = `/settings/contracts?tab=reviews&domain=${statutoryReviewDomainOf(finding.domain)}`;

	return (
		<li className="space-y-1.5 px-3 py-2.5 text-sm">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
				<span className="min-w-0 font-medium break-words">{employeeName}</span>
				{when && <span className="text-muted-foreground tabular-nums">{when}</span>}
			</div>
			<p className="break-words">
				{statutoryWarningText(finding, t, locale, timeFormat, { dayShownBeside: when !== null })}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="outline" className={SEVERITY_BADGE[finding.severity]}>
					{severityLabel(finding.severity, t)}
				</Badge>
				{/* Only where publishing the drafts is refused for it: a published shift's breach is not. */}
				{item.blocksThisPublication && (
					<Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
						<IconLock className="size-3" aria-hidden="true" />
						{t("scheduling:scheduling.statutory.findings.blocksPublishing", "Blocks publishing")}
					</Badge>
				)}
				{showShiftsLink && (
					<Link
						href={shiftsHref}
						onClick={onShiftLinkClick}
						className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline focus-visible:underline"
					>
						<IconCalendarEvent className="size-4" aria-hidden="true" />
						{t("scheduling:scheduling.statutory.findings.showShifts", "Show {name}'s shifts", {
							name: employeeName,
						})}
					</Link>
				)}
				{canOpenReviews && (
					<Link
						href={reviewsHref}
						className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline focus-visible:underline"
					>
						<IconExternalLink className="size-4" aria-hidden="true" />
						{t(
							"scheduling:scheduling.statutory.findings.openReviews",
							"Open in Reviews & Conflicts",
						)}
					</Link>
				)}
			</div>
		</li>
	);
}
