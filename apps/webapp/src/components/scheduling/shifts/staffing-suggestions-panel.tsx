"use client";

import { IconAlertTriangle, IconLoader2, IconUserSearch } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { ComplianceFinding } from "@/lib/scheduling/compliance/types";
import type {
	StaffingNote,
	StaffingReason,
	StaffingSuggestion,
	StaffingWarning,
} from "@/lib/scheduling/staffing/types";

/** Suggestions shown before "Show all". */
export const STAFFING_SUGGESTIONS_PREVIEW = 5;

interface StaffingSuggestionsPanelProps {
	suggestions: StaffingSuggestion[] | undefined;
	isLoading: boolean;
	isError: boolean;
	organizationTimezone: string;
	onPick: (employeeId: string) => void;
}

type Translate = ReturnType<typeof useTranslate>["t"];

function formatHours(minutes: number, locale: string): string {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes / 60);
}

function reasonText(reason: StaffingReason, t: Translate, locale: string): string {
	switch (reason.type) {
		case "skillsHeld":
			return t("scheduling:scheduling.staffingSuggestions.reason.skillsHeld", "Has {skills}", {
				skills: reason.skillNames.join(", "),
			});
		case "plannedHours":
			return t(
				"scheduling:scheduling.staffingSuggestions.reason.plannedHours",
				"{planned} of {target} h planned this week",
				{
					planned: formatHours(reason.plannedMinutes, locale),
					target: formatHours(reason.targetMinutes, locale),
				},
			);
		case "noContractedTarget":
			return t(
				"scheduling:scheduling.staffingSuggestions.reason.noContractedTarget",
				"No contracted target",
			);
		case "restPeriodOk":
			return t("scheduling:scheduling.staffingSuggestions.reason.restPeriodOk", "Rest period OK");
		case "requestedThisShift":
			return t(
				"scheduling:scheduling.staffingSuggestions.reason.requestedThisShift",
				"Requested this shift",
			);
	}
}

function complianceText(finding: ComplianceFinding, t: Translate, locale: string): string {
	switch (finding.type) {
		case "restTime":
			return t(
				"scheduling:scheduling.staffingSuggestions.warning.restTime",
				"Rest period too short ({rest} of {required} h)",
				{
					rest: formatHours(finding.restMinutes, locale),
					required: formatHours(finding.minRestPeriodMinutes, locale),
				},
			);
		case "maxHours":
			return t(
				"scheduling:scheduling.staffingSuggestions.warning.maxHours",
				"Over the daily maximum ({total} of {max} h)",
				{
					total: formatHours(finding.totalMinutes, locale),
					max: formatHours(finding.maxDailyMinutes, locale),
				},
			);
		case "overtime":
			return t(
				"scheduling:scheduling.staffingSuggestions.warning.overtime",
				"{period, select, daily {Daily} weekly {Weekly} other {Monthly}} overtime ({total} of {threshold} h)",
				{
					period: finding.period,
					total: formatHours(finding.totalMinutes, locale),
					threshold: formatHours(finding.thresholdMinutes, locale),
				},
			);
	}
}

function warningText(
	warning: StaffingWarning,
	t: Translate,
	locale: string,
	timezone: string,
): string {
	switch (warning.type) {
		case "missingRequiredSkill":
			return t(
				"scheduling:scheduling.staffingSuggestions.warning.missingRequiredSkill",
				"Missing required skill: {skill}",
				{ skill: warning.skillName },
			);
		case "expiredRequiredSkill":
			return t(
				"scheduling:scheduling.staffingSuggestions.warning.expiredRequiredSkill",
				"{skill} expired on {date}",
				{
					skill: warning.skillName,
					date: formatPlainDate(
						Temporal.Instant.from(warning.expiresAt).toZonedDateTimeISO(timezone).toPlainDate(),
						locale,
						"dateMedium",
					),
				},
			);
		case "compliance":
			return complianceText(warning.finding, t, locale);
		case "pendingAbsence":
			return t(
				"scheduling:scheduling.staffingSuggestions.warning.pendingAbsence",
				"Pending absence: {category}",
				{ category: warning.categoryName },
			);
	}
}

function noteText(note: StaffingNote, t: Translate): string {
	return t(
		"scheduling:scheduling.staffingSuggestions.note.missingPreferredSkill",
		"Lacks preferred skill: {skill}",
		{ skill: note.skillName },
	);
}

/**
 * Ranked employees who could take the open shift. Picking one only fills "Assign To"; the
 * dialog's save assigns them.
 */
export function StaffingSuggestionsPanel({
	suggestions,
	isLoading,
	isError,
	organizationTimezone,
	onPick,
}: StaffingSuggestionsPanelProps) {
	const { t } = useTranslate();
	const locale = useTolgee().getLanguage() || "en";
	const [showAll, setShowAll] = useState(false);

	const visible = showAll ? suggestions : suggestions?.slice(0, STAFFING_SUGGESTIONS_PREVIEW);
	const hiddenCount = (suggestions?.length ?? 0) - STAFFING_SUGGESTIONS_PREVIEW;

	return (
		<section
			aria-labelledby="staffing-suggestions-title"
			className="flex flex-col gap-y-2 rounded-md border p-3"
		>
			<h3 id="staffing-suggestions-title" className="flex items-center gap-2 text-sm font-medium">
				<IconUserSearch className="size-4" aria-hidden="true" />
				{t("scheduling:scheduling.staffingSuggestions.title", "Suggested employees")}
				{isLoading && (
					<IconLoader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
				)}
			</h3>

			{isError ? (
				<p className="text-sm text-destructive">
					{t("scheduling:scheduling.staffingSuggestions.error", "Suggestions could not be loaded")}
				</p>
			) : !suggestions ? (
				<p className="text-sm text-muted-foreground" aria-live="polite">
					{t("scheduling:scheduling.staffingSuggestions.loading", "Finding available employees…")}
				</p>
			) : suggestions.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"scheduling:scheduling.staffingSuggestions.empty",
						"No available employees for this shift",
					)}
				</p>
			) : (
				<ol className="divide-y">
					{visible?.map((suggestion) => (
						<li key={suggestion.employeeId} className="flex items-start justify-between gap-3 py-2">
							<div className="flex min-w-0 flex-col gap-y-1">
								<p className="flex flex-wrap items-center gap-2 text-sm font-medium">
									<span className="truncate">{suggestion.displayName}</span>
									{suggestion.requestedThisShift && (
										<Badge variant="secondary">
											{t(
												"scheduling:scheduling.staffingSuggestions.requested",
												"Requested this shift",
											)}
										</Badge>
									)}
								</p>
								<p className="text-xs text-muted-foreground">
									{suggestion.reasons
										.filter((reason) => reason.type !== "requestedThisShift")
										.map((reason) => reasonText(reason, t, locale))
										.join(" · ")}
								</p>
								{suggestion.warnings.length > 0 && (
									<ul className="flex flex-col gap-y-0.5 text-xs text-amber-700 dark:text-amber-400">
										{suggestion.warnings.map((warning) => {
											const text = warningText(warning, t, locale, organizationTimezone);
											return (
												<li key={text} className="flex items-center gap-1">
													<IconAlertTriangle className="size-3 shrink-0" aria-hidden="true" />
													{text}
												</li>
											);
										})}
									</ul>
								)}
								{suggestion.notes.length > 0 && (
									<p className="text-xs text-muted-foreground">
										{suggestion.notes.map((note) => noteText(note, t)).join(" · ")}
									</p>
								)}
							</div>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => onPick(suggestion.employeeId)}
								aria-label={t(
									"scheduling:scheduling.staffingSuggestions.pickLabel",
									"Assign {name}",
									{ name: suggestion.displayName },
								)}
							>
								{t("scheduling:scheduling.staffingSuggestions.pick", "Pick")}
							</Button>
						</li>
					))}
				</ol>
			)}

			{hiddenCount > 0 && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="self-start"
					onClick={() => setShowAll((current) => !current)}
				>
					{showAll
						? t("scheduling:scheduling.staffingSuggestions.showFewer", "Show fewer")
						: t("scheduling:scheduling.staffingSuggestions.showAll", "Show all ({count})", {
								count: suggestions?.length ?? 0,
							})}
				</Button>
			)}
		</section>
	);
}
