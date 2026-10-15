"use client";
import { IconCheck } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import type { HistoricalVacationReview } from "@/lib/absences/historical-vacation";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	TFormItem,
	TFormControl,
	TFormLabel,
	TFormDescription,
} from "@/components/ui/tanstack-form";
function useHistoryLabels() {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() || "en";
	return {
		dateLabel: (date: string) =>
			formatPlainDate(parsePlainDate(date), locale, "dateMedium"),
		periodLabel: (period: string) =>
			period === "am"
				? t("settings.vacation.historical.morning", "Morning")
				: period === "pm"
					? t("settings.vacation.historical.afternoon", "Afternoon")
					: t("settings.vacation.historical.fullDay", "Full day"),
	};
}
export function HistoricalDatedHistoryAcknowledgement({
	context,
	busy,
	checked,
	name,
	onBlur,
	onCheckedChange,
}: {
	context: HistoricalVacationReview;
	busy: boolean;
	checked: boolean;
	name: string;
	onBlur: () => void;
	onCheckedChange: (checked: boolean) => void;
}) {
	const { t } = useTranslate();
	const { dateLabel, periodLabel } = useHistoryLabels();
	return (
		<fieldset className="space-y-3 rounded-md border p-3 md:col-span-2">
			<legend className="px-1 text-sm font-medium">
				{t(
					"settings.vacation.historical.excludedHistory",
					"Dated history already counted separately",
				)}
			</legend>
			<ul className="list-disc pl-5 text-sm">
				{context.historicalRecords.map((record) => (
					<li key={record.id}>
						{dateLabel(record.startDate)} – {dateLabel(record.endDate)} (
						{periodLabel(record.startPeriod)} / {periodLabel(record.endPeriod)};{" "}
						{record.status})
					</li>
				))}
			</ul>
			<TFormItem>
				<div className="flex items-start gap-3">
					<TFormControl>
						<Checkbox
							checked={checked}
							onCheckedChange={(value) => onCheckedChange(value === true)}
							onBlur={onBlur}
							name={name}
							disabled={
								busy || context.unresolvedHistoricalImportIds.length > 0
							}
						/>
					</TFormControl>
					<TFormLabel>
						{t(
							"settings.vacation.historical.excludesListed",
							"I confirm the supplied remaining total excludes every listed dated absence.",
						)}
					</TFormLabel>
				</div>
				<TFormDescription>
					{context.unresolvedHistoricalImportIds.length
						? t(
								"settings.vacation.historical.unknownMapping",
								"Some imported categories are unresolved. Confirm their explicit mapping before acknowledging these exclusions.",
							)
						: t(
								"settings.vacation.historical.exclusionHelp",
								"The listed approved and pending absences remain counted separately. The total must cover other previously taken vacation only.",
							)}
				</TFormDescription>
			</TFormItem>
		</fieldset>
	);
}
export function HistoricalVacationReviewPanel({
	review,
	busy,
	onCommit,
}: {
	review: HistoricalVacationReview;
	busy: boolean;
	onCommit: () => void;
}) {
	const { t } = useTranslate();
	const { dateLabel, periodLabel } = useHistoryLabels();
	return (
		<section
			aria-label={t(
				"settings.vacation.historical.reviewTitle",
				"Historical vacation review",
			)}
			className="space-y-3 rounded-md border p-4"
		>
			<p>
				{t(
					"settings.vacation.historical.impact",
					"Allowance: {allowance} days. Vacation balance: {before} → {after} days. Proposed previously taken total: {days} days.",
					{
						allowance: review.after.allowanceDays,
						before: review.before.remainingDays,
						after: review.after.remainingDays,
						days: review.days,
					},
				)}
			</p>
			{review.historicalRecords.length > 0 && (
				<div>
					<p className="font-medium">
						{t(
							"settings.vacation.historical.existing",
							"Already recorded historical vacation",
						)}
					</p>
					<ul className="list-disc pl-5">
						{review.historicalRecords.map((record) => (
							<li key={record.id}>
								{dateLabel(record.startDate)} – {dateLabel(record.endDate)} (
								{periodLabel(record.startPeriod)} /{" "}
								{periodLabel(record.endPeriod)})
							</li>
						))}
					</ul>
				</div>
			)}
			{review.blockers.map((blocker) => (
				<p role="alert" key={blocker} className="text-sm text-destructive">
					{blocker}
				</p>
			))}
			<Button
				type="button"
				onClick={onCommit}
				disabled={busy || review.blockers.length > 0}
			>
				<IconCheck className="size-4" aria-hidden="true" />
				{t("settings.vacation.historical.confirm", "Save reviewed total")}
			</Button>
		</section>
	);
}
