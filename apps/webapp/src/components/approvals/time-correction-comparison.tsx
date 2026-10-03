"use client";

import { useTranslate } from "@tolgee/react";
import type {
	ApprovalInboxTimeComparison,
	ApprovalInboxTimeRange,
} from "@/lib/approvals/inbox/types";
import {
	comparisonElapsedMinutes,
	comparisonEndpointText,
	timeComparisonLayout,
} from "@/lib/approvals/presentation/time-comparison";

export function TimeCorrectionComparison({
	comparison,
}: {
	comparison: ApprovalInboxTimeComparison;
}) {
	const { t } = useTranslate();
	const layout = timeComparisonLayout(comparison);
	const labels = [
		t("approvals:approvals.original", "Original"),
		t("approvals:approvals.requested", "Requested"),
	];
	const rangeText = (range: ApprovalInboxTimeRange) => {
		const unavailable = t("approvals:approvals.evidence.unavailable", "Unavailable");
		return `${range.start ? comparisonEndpointText(range.start) : unavailable} – ${range.end ? comparisonEndpointText(range.end) : unavailable}`;
	};
	const minutes = [
		comparisonElapsedMinutes(comparison.original),
		comparisonElapsedMinutes(comparison.requested),
	];
	return (
		<section
			aria-label={t("approvals:approvals.timeComparison", "Time comparison")}
			className="rounded-xl border bg-card p-4"
		>
			<h4 className="mb-4 text-sm font-semibold">
				{t("approvals:approvals.timeComparison", "Time comparison")}
			</h4>
			<div className="grid grid-cols-2 gap-4">
				{[comparison.original, comparison.requested].map((range, index) => (
					<div key={labels[index]} className="min-w-0">
						<p className="mb-2 text-xs font-semibold text-muted-foreground">{labels[index]}</p>
						<p className="break-words text-sm font-medium tabular-nums">
							{index === 1 && comparison.action === "delete"
								? t("approvals:approvals.evidence.entryDeleted", "Deleted")
								: rangeText(range)}
						</p>
						{minutes[index] !== null && !(index === 1 && comparison.action === "delete") ? (
							<p className="mt-2 text-xs text-muted-foreground">
								{t("approvals:approvals.elapsedMinutes", "{minutes} min elapsed", {
									minutes: Math.round(minutes[index]!),
								})}
							</p>
						) : null}
					</div>
				))}
			</div>
			{layout ? (
				<div className="mt-5" aria-hidden="true">
					<p className="mb-3 text-xs text-muted-foreground">{layout.offsetLabel}</p>
					<div className="relative ml-14 h-64 border-x border-border">
						{layout.ticks.map((tick) => (
							<div
								key={tick.at}
								className="absolute inset-x-0 border-t border-border/50"
								style={{ top: `${tick.top}%` }}
							>
								<span className="absolute right-full -mt-2 mr-2 max-w-14 text-right text-[10px] tabular-nums text-muted-foreground">
									{tick.label}
								</span>
							</div>
						))}
						<div className="absolute inset-y-0 left-1/2 border-l border-border" />
						{layout.original ? (
							<div
								className="absolute left-[4%] w-[42%] rounded-sm border border-muted-foreground/40 bg-muted-foreground/20"
								style={{
									top: `${layout.original.top}%`,
									height: `${layout.original.height}%`,
								}}
							/>
						) : null}
						{layout.requested ? (
							<div
								className="absolute left-[54%] w-[42%] rounded-sm border border-primary/60 bg-primary/25"
								style={{
									top: `${layout.requested.top}%`,
									height: `${layout.requested.height}%`,
								}}
							/>
						) : null}
					</div>
				</div>
			) : null}
		</section>
	);
}
