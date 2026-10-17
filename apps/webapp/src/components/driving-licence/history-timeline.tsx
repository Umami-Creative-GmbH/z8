"use client";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import type { DrivingLicenceHistory } from "@/lib/organization/driving-licence/history";
import { useDrivingHistoryLabels } from "./history-labels";
import { DrivingHistoryOriginal } from "./history-original";

function Timestamp({ value }: { value: string }) {
	return (
		<time dateTime={value}>
			{value.replace("T", " ").replace(/\.000Z$/, " UTC")}
		</time>
	);
}
export function DrivingLicenceHistoryTimeline({
	history,
	onSupplement,
	supplementForm,
}: {
	history: DrivingLicenceHistory;
	onSupplement: (checkId: string) => void;
	supplementForm?: { checkId: string; content: ReactNode } | null;
}) {
	const { t } = useTranslate();
	const { labels, fields, outcomes, reasons } = useDrivingHistoryLabels();
	const items = [
		...history.checks.map((value) => ({
			type: "check" as const,
			value,
			at: value.controlledAt,
		})),
		...history.supplements.map((value) => ({
			type: "supplement" as const,
			value,
			at: value.recordedAt,
		})),
		...history.events.map((value) => ({
			type: "event" as const,
			value,
			at: value.effectiveAt,
		})),
	].sort(
		(a, b) =>
			a.at.localeCompare(b.at) ||
			{ check: 0, supplement: 1, event: 2 }[a.type] -
				{ check: 0, supplement: 1, event: 2 }[b.type] ||
			a.value.id.localeCompare(b.value.id),
	);
	const checks = new Map(history.checks.map((check) => [check.id, check]));
	if (!items.length)
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.history.empty",
					"No checks or authorization decisions in this period.",
				)}
			</p>
		);
	return (
		<ol className="space-y-4 border-l-2 border-primary/25 pl-4">
			{items.map((item) => (
				<li
					key={`${item.type}:${item.value.id}`}
					className="space-y-2 break-words rounded-lg border bg-card p-4 [content-visibility:auto] [contain-intrinsic-size:auto_16rem]"
				>
					<p className="text-xs text-muted-foreground tabular-nums">
						<Timestamp value={item.at} />
						{!item.value.inPeriod && (
							<span className="ml-2">
								{t(
									"drivingLicence.history.context",
									"Context outside selected period",
								)}
							</span>
						)}
					</p>
					{item.type === "check" ? (
						<DrivingHistoryOriginal
							check={item.value}
							canSupplement={history.canSupplement}
							onSupplement={onSupplement}
							supplementForm={supplementForm}
						/>
					) : item.type === "supplement" ? (
						<>
							<h3 className="font-semibold">
								{t(
									"drivingLicence.history.supplementBy",
									"Supplement by {name}",
									{ name: item.value.authorName },
								)}
							</h3>
							<p className="text-sm">
								{t(
									"drivingLicence.history.linkedOriginal",
									"Linked original check: {date}",
									{
										date:
											checks.get(item.value.checkId)?.controlledAt ??
											item.value.checkId,
									},
								)}
							</p>
							<p className="text-sm">
								{fields[item.value.correction.field]}
								{"classCode" in item.value.correction
									? ` · ${item.value.correction.classCode}`
									: ""}
							</p>
							<p className="font-medium">
								{item.value.correction.field === "classResult"
									? outcomes[item.value.correction.value]
									: item.value.correction.value ||
										t("drivingLicence.history.none", "None recorded")}
							</p>
							<p className="text-sm text-muted-foreground">
								{item.value.reason === "recording_error"
									? t(
											"drivingLicence.history.recordingError",
											"Recording error",
										)
									: t("drivingLicence.history.missingDetail", "Missing detail")}
							</p>
						</>
					) : (
						<>
							<h3 className="font-semibold">
								{labels[item.value.kind] ??
									t(
										"drivingLicence.history.decision",
										"Authorization decision",
									)}
							</h3>
							<p className="text-sm">
								{item.value.classCode ??
									t("drivingLicence.history.allClasses", "All classes")}
							</p>
							{item.value.reason?.startsWith("policy_version:") && (
								<p className="text-sm">
									{t(
										"drivingLicence.history.policyContext",
										"Policy version {version}; interval {months} months",
										{
											version: item.value.reason.slice(
												"policy_version:".length,
											),
											months:
												history.policies.find(
													(policy) =>
														String(policy.version) ===
														item.value.reason?.slice("policy_version:".length),
												)?.intervalMonths ?? "—",
										},
									)}
								</p>
							)}
							{item.value.reason && reasons[item.value.reason] && (
								<p className="text-sm">{reasons[item.value.reason]}</p>
							)}
							{item.value.checkId && checks.has(item.value.checkId) && (
								<p className="text-sm">
									{t(
										"drivingLicence.history.linkedOriginal",
										"Linked original check: {date}",
										{
											date: checks.get(item.value.checkId)?.controlledAt ?? "",
										},
									)}
								</p>
							)}
							<p className="text-xs text-muted-foreground tabular-nums">
								{t("drivingLicence.history.recorded", "Recorded at {date}", {
									date: item.value.recordedAt,
								})}
							</p>
						</>
					)}
				</li>
			))}
		</ol>
	);
}
