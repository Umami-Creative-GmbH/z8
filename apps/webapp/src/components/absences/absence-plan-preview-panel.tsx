"use client";

import { IconAlertTriangle, IconCheck, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { AbsencePlanPreview, ApprovalSignal } from "@/lib/absences/absence-plan-preview";
import { formatDays } from "@/lib/absences/date-utils";
import { cn } from "@/lib/utils";

interface AbsencePlanPreviewPanelProps {
	preview?: AbsencePlanPreview;
	isLoading?: boolean;
	error?: string | null;
}

const APPROVAL_SIGNAL_LABELS: Record<ApprovalSignal, string> = {
	likely: "Likely",
	needs_review: "Needs review",
	risky: "Risky",
};

const APPROVAL_SIGNAL_CLASSES: Record<ApprovalSignal, string> = {
	likely:
		"border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
	needs_review:
		"border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
	risky:
		"border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/40 dark:bg-destructive/15",
};

type TranslateFn = Parameters<typeof formatDays>[1];

export function AbsencePlanPreviewPanel({
	preview,
	isLoading = false,
	error = null,
}: AbsencePlanPreviewPanelProps) {
	const { t } = useTranslate();

	if (isLoading) {
		return (
			<div
				aria-live="polite"
				className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground text-sm"
				role="status"
			>
				<IconLoader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
				<span>
					{t("absences.planPreview.loading", "Checking balance, holidays, and coverage…")}
				</span>
			</div>
		);
	}

	if (error) {
		return (
			<div
				className="rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground text-sm"
				role="status"
			>
				{t(
					"absences.planPreview.unavailable",
					"Planning preview unavailable. You can still submit your request.",
				)}
			</div>
		);
	}

	if (!preview) {
		return null;
	}

	const approvalReasons =
		preview.reasons.length > 0
			? preview.reasons
			: ["Planner checked the available request signals."];
	const coverageRiskCount = preview.coverage.risks.length;
	const hasAffectedShifts = preview.affectedShifts.length > 0;
	const hasMissingCoverageRules =
		hasAffectedShifts && !preview.coverage.hasConfiguredRulesForAffectedShifts;

	return (
		<Card className="gap-4 border-primary/15 bg-primary/5 shadow-none">
			<CardHeader className="gap-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1">
						<h3 className="text-pretty font-semibold leading-none">
							{t("absences.planPreview.title", "Smart planner")}
						</h3>
						<CardDescription>
							{t(
								"absences.planPreview.description",
								"A non-blocking check of balance, holidays, coverage, and approval signals before you submit.",
							)}
						</CardDescription>
					</div>
					<Badge
						className={cn("border", APPROVAL_SIGNAL_CLASSES[preview.approvalSignal])}
						variant="outline"
					>
						{APPROVAL_SIGNAL_LABELS[preview.approvalSignal]}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="grid gap-3 sm:grid-cols-2">
				<PreviewSection title={t("absences.planPreview.balance", "Balance")}>
					{preview.balance ? (
						<div className="space-y-2">
							<p className="text-muted-foreground text-sm">
								{getVacationImpact(preview.balance, t)}
							</p>
							<MetricRow
								label={t("absences.planPreview.requested", "Requested")}
								value={formatDays(preview.requestedDays, t)}
							/>
							<MetricRow
								label={t("absences.planPreview.remainingAfter", "Remaining after request")}
								value={formatDays(preview.balance.remainingAfterRequest, t)}
							/>
						</div>
					) : (
						<p className="text-muted-foreground text-sm">
							{t("absences.planPreview.balanceUnavailable", "Balance unavailable")}
						</p>
					)}
				</PreviewSection>

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
										coverageRiskCount === 1 ? "1 coverage warning" : "{count} coverage warnings",
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
												{risk.date} · {risk.subareaName}
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
						) : hasMissingCoverageRules ? (
							<p className="text-muted-foreground text-sm">
								{t(
									"absences.planPreview.noCoverageRulesConfigured",
									"No coverage rules configured for affected shifts",
								)}
							</p>
						) : (
							<p className="text-muted-foreground text-sm">
								{t("absences.planPreview.noCoverageRisk", "No published coverage risk")}
							</p>
						)}
						{hasAffectedShifts && (
							<ul className="space-y-1 text-sm">
								{preview.affectedShifts.map((shift) => (
									<li
										className="rounded-md border bg-muted/30 px-2 py-1"
										key={getAffectedShiftKey(shift)}
									>
										<div className="min-w-0 break-words font-medium">
											{shift.date} · {shift.subareaId}
										</div>
										<div className="text-muted-foreground text-xs tabular-nums">
											{shift.startTime}-{shift.endTime}{" "}
											{t("absences.planPreview.affectedShift", "affected shift")}
										</div>
									</li>
								))}
							</ul>
						)}
					</div>
				</PreviewSection>

				<PreviewSection title={t("absences.planPreview.approval", "Approval")}>
					<div className="space-y-2">
						<ul className="space-y-1 text-sm">
							{approvalReasons.map((reason) => (
								<li className="break-words" key={reason}>
									{reason}
								</li>
							))}
						</ul>
						{preview.warnings.length > 0 ? (
							<ul className="space-y-1 text-sm">
								{preview.warnings.map((warning) => (
									<li className="flex items-start gap-2 text-destructive" key={warning}>
										<IconAlertTriangle className="mt-0.5 size-4" aria-hidden="true" />
										<span className="min-w-0 break-words">{warning}</span>
									</li>
								))}
							</ul>
						) : (
							<p className="flex items-center gap-2 text-muted-foreground text-sm">
								<IconCheck className="size-4" aria-hidden="true" />
								{t("absences.planPreview.noApprovalWarnings", "No approval warnings")}
							</p>
						)}
					</div>
				</PreviewSection>
			</CardContent>
		</Card>
	);
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

function getVacationImpact(balance: NonNullable<AbsencePlanPreview["balance"]>, t: TranslateFn) {
	return balance.countsAgainstVacation
		? t("absences.planPreview.countsAgainstVacationBalance", "Counts against vacation balance")
		: t("absences.planPreview.doesNotReduceVacationBalance", "Does not reduce vacation balance");
}

function getCoverageRiskKey(risk: AbsencePlanPreview["coverage"]["risks"][number]) {
	return `${risk.date}-${risk.subareaId}-${risk.startTime}-${risk.endTime}`;
}

function getAffectedShiftKey(shift: AbsencePlanPreview["affectedShifts"][number]) {
	return `${shift.id}-${shift.date}-${shift.startTime}-${shift.endTime}`;
}
