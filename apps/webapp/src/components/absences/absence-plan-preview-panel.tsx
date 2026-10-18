"use client";

import { IconAlertTriangle, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { Temporal } from "temporal-polyfill";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type {
	AbsencePlanNote,
	AbsencePlanPreview,
	CoverageEvidenceGap,
} from "@/lib/absences/absence-plan-preview";
import { formatDays } from "@/lib/absences/date-utils";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate, formatPlainDateRange } from "@/lib/datetime/temporal-format";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import { VacationYearBalances } from "./vacation-year-balances";

interface AbsencePlanPreviewPanelProps {
	preview?: AbsencePlanPreview;
	isLoading?: boolean;
	error?: string | null;
}

type TranslateFn = Parameters<typeof formatDays>[1];

export function AbsencePlanPreviewPanel({
	preview,
	isLoading = false,
	error = null,
}: AbsencePlanPreviewPanelProps) {
	const { t } = useTranslate();

	if (isLoading) {
		return (
			<output
				aria-live="polite"
				className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground text-sm"
			>
				<IconLoader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
				<span>
					{t("absences.planPreview.loading", "Checking balance, holidays, and coverage…")}
				</span>
			</output>
		);
	}

	if (error) {
		return (
			<output className="rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground text-sm">
				{t(
					"absences.planPreview.unavailable",
					"Planning preview unavailable. You can still submit your request.",
				)}
			</output>
		);
	}

	if (!preview) {
		return null;
	}

	return (
		<Card className="gap-4 border-primary/15 bg-primary/5 shadow-none">
			<CardHeader className="gap-3">
				<div className="space-y-1">
					<h3 className="text-pretty font-semibold leading-none">
						{t("absences.planPreview.title", "Smart planner")}
					</h3>
					<CardDescription>
						{t(
							"absences.planPreview.descriptionEvidence",
							"A non-blocking check of balance, holidays, and published-schedule coverage before you submit. It does not predict approval.",
						)}
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="grid gap-3 sm:grid-cols-2">
				<AbsencePlanPreviewSections preview={preview} />
			</CardContent>
		</Card>
	);
}

/**
 * The preview's evidence sections (balance, work balance, holidays, coverage, approval), shared by
 * the ordinary panel and each compared option (#1342) so both show one result the same way.
 * The caller provides the grid.
 */
export function AbsencePlanPreviewSections({ preview }: { preview: AbsencePlanPreview }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const formatDate = (date: string) => formatPlainDate(parsePlainDate(date), locale, "dateMedium");
	const approvalNotes =
		preview.notes.length > 0
			? preview.notes.map((note) => planNoteMessage(note, t))
			: [
					t(
						"absences.planPreview.checkedSignals",
						"Planner checked the available request signals.",
					),
				];
	const workBalanceNegative = preview.workBalance?.wouldBeNegative === true;
	const hasApprovalWarnings =
		preview.refusal !== null || preview.overlaps.length > 0 || workBalanceNegative;
	const coverageRiskCount = preview.coverage.risks.length;
	const hasAffectedShifts = preview.affectedShifts.length > 0;
	const isCoverageIncomplete = preview.coverage.status === "incomplete";

	return (
		<>
			<PreviewSection title={t("absences.planPreview.balance", "Balance")}>
				<div className="space-y-2">
					<p className="text-muted-foreground text-sm">
						{getVacationImpact(preview.countsAgainstVacation, t)}
					</p>
					<MetricRow
						label={t("absences.planPreview.requested", "Requested")}
						value={formatDays(preview.requestedAbsenceDays, t)}
					/>
					{preview.countsAgainstVacation ? (
						<VacationYearBalances balances={preview.balances} evaluatedAt={preview.evaluatedAt} />
					) : null}
				</div>
			</PreviewSection>

			{preview.workBalance ? (
				<PreviewSection title={t("absences.planPreview.workBalance", "Work balance")}>
					<div className="space-y-2">
						<MetricRow
							label={t("absences.planPreview.workBalanceCurrent", "Current")}
							value={formatSignedWorkBalance(preview.workBalance.currentBalanceMinutes)}
						/>
						<MetricRow
							label={t("absences.planPreview.workBalanceDrawn", "Drawn by request")}
							value={formatSignedWorkBalance(-preview.workBalance.drawnMinutes)}
						/>
						<MetricRow
							label={t("absences.planPreview.workBalanceAfter", "After request")}
							value={formatSignedWorkBalance(preview.workBalance.projectedBalanceMinutes)}
						/>
						{preview.workBalance.wouldBeNegative ? (
							<p className="flex items-start gap-2 text-destructive text-sm">
								<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
								<span>
									{t(
										"absences.planPreview.workBalanceNegative",
										"Your work balance would be negative after this request. You can still submit it.",
									)}
								</span>
							</p>
						) : null}
					</div>
				</PreviewSection>
			) : null}

			<PreviewSection title={t("absences.planPreview.holidays", "Holidays")}>
				{preview.holidays.length > 0 ? (
					<ul className="space-y-1 text-sm">
						{preview.holidays.map((holiday) => (
							<li className="flex items-start gap-2" key={holiday.id}>
								<IconInfoCircle
									className="mt-0.5 size-4 text-muted-foreground"
									aria-hidden="true"
								/>
								<span className="min-w-0 break-words">{holiday.name}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-muted-foreground text-sm">
						{t("absences.planPreview.noHolidays", "No assigned holidays in range")}
					</p>
				)}
			</PreviewSection>

			<PreviewSection title={t("absences.planPreview.coverage", "Coverage")}>
				<div className="space-y-2">
					{coverageRiskCount > 0 ? (
						<>
							<p className="text-sm">
								{t(
									"absences.planPreview.coverageWarnings",
									"{count, plural, one {# coverage warning} other {# coverage warnings}}",
									{ count: coverageRiskCount },
								)}
							</p>
							<ul className="space-y-1 text-sm">
								{preview.coverage.risks.map((risk) => (
									<li
										className="rounded-md border bg-muted/30 px-2 py-1"
										key={getCoverageRiskKey(risk)}
									>
										<div className="min-w-0 break-words font-medium">
											{formatDate(risk.date)} · {risk.subareaName ?? unknownSubarea(t)}
										</div>
										<div className="text-muted-foreground text-xs tabular-nums">
											{risk.startTime}-{risk.endTime} ·{" "}
											{t(
												"absences.planPreview.coverageStaffAfterRequest",
												"{after}/{minimum} staff after request",
												{
													after: risk.staffCountAfterAbsence,
													minimum: risk.minimumStaffCount,
												},
											)}
										</div>
									</li>
								))}
							</ul>
						</>
					) : isCoverageIncomplete ? null : hasAffectedShifts ? (
						<p className="text-muted-foreground text-sm">
							{t(
								"absences.planPreview.coverageNoWarnings",
								"No coverage warnings in the published schedule.",
							)}
						</p>
					) : (
						<p className="text-muted-foreground text-sm">
							{t(
								"absences.planPreview.noAffectedShifts",
								"None of your published shifts overlap this absence.",
							)}
						</p>
					)}
					{isCoverageIncomplete && (
						<div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 text-sm dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
							<p className="flex items-start gap-2 font-medium">
								<IconInfoCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
								<span className="min-w-0 break-words">
									{t(
										"absences.planPreview.coverageIncomplete",
										"Coverage evidence is incomplete, so missing warnings don't mean staffing is adequate.",
									)}
								</span>
							</p>
							<ul className="space-y-0.5 ps-6">
								{preview.coverage.gaps.map((gap) => (
									<li className="break-words" key={gap}>
										{coverageGapMessage(gap, t)}
									</li>
								))}
							</ul>
						</div>
					)}
					{hasAffectedShifts && (
						<ul className="space-y-1 text-sm">
							{preview.affectedShifts.map((shift) => (
								<li
									className="rounded-md border bg-muted/30 px-2 py-1"
									key={getAffectedShiftKey(shift)}
								>
									<div className="min-w-0 break-words font-medium">
										{formatDate(shift.date)} · {shift.subareaName ?? unknownSubarea(t)}
									</div>
									<div className="text-muted-foreground text-xs tabular-nums">
										{affectedShiftDescription(shift, t)}
									</div>
								</li>
							))}
						</ul>
					)}
					<p className="text-muted-foreground text-xs">
						{t(
							"absences.planPreview.coverageLimits",
							"Based on published shifts and configured coverage rules. Colleagues' absences and unpublished schedule changes are not considered, so no warning does not guarantee staffing or approval.",
						)}
					</p>
				</div>
			</PreviewSection>
			<PreviewSection title={t("absences.planPreview.approval", "Approval")}>
				<div className="space-y-2">
					{/* Process information only: never an approval prediction. */}
					<ul className="space-y-1 text-sm">
						{approvalNotes.map((note) => (
							<li className="break-words" key={note}>
								{note}
							</li>
						))}
					</ul>
					{hasApprovalWarnings ? (
						<ul className="space-y-1 text-sm">
							{preview.refusal === "no_working_days" && (
								<li className="flex items-start gap-2 text-destructive" role="alert">
									<IconAlertTriangle className="mt-0.5 size-4" aria-hidden="true" />
									<span className="min-w-0 break-words">{noWorkingDaysMessage(t)}</span>
								</li>
							)}
							{preview.overlaps.map((overlap) => (
								<li className="flex items-start gap-2 text-destructive" key={overlap.id}>
									<IconAlertTriangle className="mt-0.5 size-4" aria-hidden="true" />
									<span className="min-w-0 break-words">{overlapMessage(overlap, locale, t)}</span>
								</li>
							))}
							{workBalanceNegative && (
								<li className="flex items-start gap-2 text-destructive">
									<IconAlertTriangle className="mt-0.5 size-4" aria-hidden="true" />
									<span className="min-w-0 break-words">
										{t(
											"absences.planPreview.workBalanceNegativeWarning",
											"Work balance would be negative after this request.",
										)}
									</span>
								</li>
							)}
						</ul>
					) : (
						<p className="flex items-start gap-2 text-muted-foreground text-sm">
							<IconInfoCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
							<span>
								{t(
									"absences.planPreview.noWarningsInEvidence",
									"No warnings found in the available evidence.",
								)}
							</span>
						</p>
					)}
				</div>
			</PreviewSection>
		</>
	);
}

/** The refusal of vacation that covers no working day, in the viewer's language (#979). */
export function noWorkingDaysMessage(t: TranslateFn) {
	return t("absences.planPreview.noWorkingDays", "This range contains no working days.");
}

function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="rounded-lg border bg-card/80 p-3" aria-label={title}>
			<h4 className="mb-2 font-medium text-sm">{title}</h4>
			{children}
		</section>
	);
}

function MetricRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-3 text-sm">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-medium tabular-nums">{value}</span>
		</div>
	);
}

function getVacationImpact(countsAgainstVacation: boolean, t: TranslateFn) {
	return countsAgainstVacation
		? t("absences.planPreview.countsAgainstVacationBalance", "Counts against vacation balance")
		: t("absences.planPreview.doesNotReduceVacationBalance", "Does not reduce vacation balance");
}

function unknownSubarea(t: TranslateFn) {
	return t("absences.planPreview.unknownSubarea", "Unknown subarea");
}

function coverageGapMessage(gap: CoverageEvidenceGap, t: TranslateFn) {
	switch (gap) {
		case "rules_missing":
			return t(
				"absences.planPreview.coverageGap.rulesMissing",
				"No coverage rules apply to some of your affected work.",
			);
		case "rules_partial":
			return t(
				"absences.planPreview.coverageGap.rulesPartial",
				"Coverage rules apply to only part of your affected work.",
			);
		case "read_failed":
			return t(
				"absences.planPreview.coverageGap.readFailed",
				"Published shifts or coverage rules could not be read.",
			);
		case "unsupported":
			return t(
				"absences.planPreview.coverageGap.unsupported",
				"Some request or schedule times could not be evaluated.",
			);
	}
}

/** The shift's times and the part the absence takes, e.g. "22:00-06:00 (ends next day) · away 00:00-02:00". */
function affectedShiftDescription(
	shift: AbsencePlanPreview["affectedShifts"][number],
	t: TranslateFn,
) {
	// A shift that ends at or before its start ends the next day.
	const endsNextDay =
		Temporal.PlainTime.compare(
			Temporal.PlainTime.from(shift.endTime),
			Temporal.PlainTime.from(shift.startTime),
		) <= 0;
	const isWholeShift =
		shift.affectedStartTime === shift.startTime && shift.affectedEndTime === shift.endTime;
	const times = { start: shift.startTime, end: shift.endTime };
	if (isWholeShift) {
		return endsNextDay
			? t(
					"absences.planPreview.affectedShiftWholeOvernight",
					"{start}-{end} (ends next day) · whole shift affected",
					times,
				)
			: t("absences.planPreview.affectedShiftWhole", "{start}-{end} · whole shift affected", times);
	}
	const away = { ...times, awayStart: shift.affectedStartTime, awayEnd: shift.affectedEndTime };
	return endsNextDay
		? t(
				"absences.planPreview.affectedShiftPartOvernight",
				"{start}-{end} (ends next day) · away {awayStart}-{awayEnd}",
				away,
			)
		: t(
				"absences.planPreview.affectedShiftPart",
				"{start}-{end} · away {awayStart}-{awayEnd}",
				away,
			);
}

function planNoteMessage(note: AbsencePlanNote, t: TranslateFn) {
	switch (note) {
		case "does_not_reduce_vacation":
			return t(
				"absences.planPreview.note.doesNotReduceVacation",
				"This absence type does not reduce vacation balance.",
			);
		case "draws_on_work_balance":
			return t(
				"absences.planPreview.note.drawsOnWorkBalance",
				"This absence draws on the work balance.",
			);
		case "work_balance_unavailable":
			return t(
				"absences.planPreview.note.workBalanceUnavailable",
				"Work balance is unavailable right now.",
			);
		case "no_approval_required":
			return t(
				"absences.planPreview.note.noApprovalRequired",
				"This absence type does not require approval.",
			);
		case "no_manager_auto_approval":
			return t(
				"absences.planPreview.note.noManagerAutoApproval",
				"No manager is assigned, so this request follows the current auto-approval behavior.",
			);
		case "normal_approval_path":
			return t(
				"absences.planPreview.note.normalApprovalPath",
				"Request follows the normal approval path.",
			);
	}
}

/** One of the employee's own absences the request overlaps, with its dates and status. */
function overlapMessage(
	overlap: AbsencePlanPreview["overlaps"][number],
	locale: string,
	t: TranslateFn,
) {
	const dates = formatPlainDateRange(
		parsePlainDate(overlap.startDate),
		parsePlainDate(overlap.endDate),
		locale,
		"dateMedium",
	);
	return overlap.status === "approved"
		? t("absences.planPreview.overlapApproved", "Overlaps your approved absence ({dates}).", {
				dates,
			})
		: t("absences.planPreview.overlapPending", "Overlaps your pending absence ({dates}).", {
				dates,
			});
}

function getCoverageRiskKey(risk: AbsencePlanPreview["coverage"]["risks"][number]) {
	return `${risk.date}-${risk.subareaId}-${risk.startTime}-${risk.endTime}`;
}

function getAffectedShiftKey(shift: AbsencePlanPreview["affectedShifts"][number]) {
	return `${shift.id}-${shift.date}-${shift.startTime}-${shift.endTime}`;
}
