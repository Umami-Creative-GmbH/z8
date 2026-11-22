"use client";

import { IconArrowRight, IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { previewEmployeeTeamChangeContractImpact } from "@/app/[locale]/(app)/settings/employees/employee-mutations.actions";
import { Badge } from "@/components/ui/badge";
import type {
	PrimaryTeamMoveOperationalChange,
	PrimaryTeamMoveScheduleDaySummary,
} from "@/lib/contracts/primary-team-move-preview";
import { useContractLabels } from "./contract-formatters";

export interface TeamMoveContractPreviewProps {
	employeeId: string;
	targetTeamId: string | null;
	enabled: boolean;
}

/**
 * Strictly read-only operational rule preview shown when an org admin changes
 * an employee's primary team. Never mutates employee-owned legal, pay, or
 * personal divergence terms.
 */
export function TeamMoveContractPreview({
	employeeId,
	targetTeamId,
	enabled,
}: TeamMoveContractPreviewProps) {
	const { t } = useTranslate();
	const labels = useContractLabels();

	const query = useQuery({
		queryKey: ["contracts", "team-move-preview", employeeId, targetTeamId],
		queryFn: async () => {
			const result = await previewEmployeeTeamChangeContractImpact({
				employeeId,
				teamId: targetTeamId,
			});
			if (!result.success) return null;
			return result.data;
		},
		enabled,
		staleTime: 10 * 1000,
		retry: false,
	});

	if (!enabled) return null;

	if (query.isFetching && !query.data) {
		return (
			<p className="mt-2 flex items-center gap-1.5 text-muted-foreground text-xs">
				<IconLoader2 className="size-3.5 animate-spin" aria-hidden="true" />
				{t(
					"settings.contracts.teamMove.loadingPreview",
					"Checking operational contract rule impact…",
				)}
			</p>
		);
	}

	const data = query.data;
	if (!data) return null;

	const weekdayShortLabel = (day: PrimaryTeamMoveScheduleDaySummary["dayOfWeek"]): string => {
		switch (day) {
			case "monday":
				return t("settings.contracts.teamMove.weekdaysShort.monday", "Mon");
			case "tuesday":
				return t("settings.contracts.teamMove.weekdaysShort.tuesday", "Tue");
			case "wednesday":
				return t("settings.contracts.teamMove.weekdaysShort.wednesday", "Wed");
			case "thursday":
				return t("settings.contracts.teamMove.weekdaysShort.thursday", "Thu");
			case "friday":
				return t("settings.contracts.teamMove.weekdaysShort.friday", "Fri");
			case "saturday":
				return t("settings.contracts.teamMove.weekdaysShort.saturday", "Sat");
			case "sunday":
				return t("settings.contracts.teamMove.weekdaysShort.sunday", "Sun");
		}
	};

	const formatLocalizedScheduleDays = (
		days: readonly PrimaryTeamMoveScheduleDaySummary[] | null | undefined,
		fallbackLabel: string | null,
	): string => {
		if (!days) {
			return fallbackLabel ?? t("settings.contracts.values.none", "None");
		}
		if (days.length === 0) {
			return t("settings.contracts.values.none", "None");
		}
		return days
			.map((row) => {
				const hours = Math.floor(row.minutesPerDay / 60);
				const minutes = row.minutesPerDay % 60;
				const dur =
					minutes === 0
						? t("settings.contracts.teamMove.durationHours", "{hours}h", { hours })
						: t("settings.contracts.teamMove.durationHoursMinutes", "{hours}h {minutes}m", {
								hours,
								minutes,
							});
				const clockIn = row.latestClockIn ? ` (${row.latestClockIn})` : "";
				return `${weekdayShortLabel(row.dayOfWeek)} ${dur}${clockIn}`;
			})
			.join(", ");
	};

	const renderChangeValue = (
		change: PrimaryTeamMoveOperationalChange,
		side: "before" | "after",
	): string => {
		if (change.field === "weeklyScheduleDays") {
			return formatLocalizedScheduleDays(
				side === "before" ? change.beforeScheduleDays : change.afterScheduleDays,
				side === "before" ? change.beforeLabel : change.afterLabel,
			);
		}
		const label = side === "before" ? change.beforeLabel : change.afterLabel;
		return label ?? t("settings.contracts.values.none", "None");
	};

	return (
		<div
			className="mt-2 space-y-2 rounded-md border bg-background p-2.5 text-xs"
			data-testid="team-move-contract-preview"
		>
			<p className="font-medium">
				{data.hasOperationalChanges
					? t(
							"settings.contracts.teamMove.changesHeading",
							"Operational contract rules affected by moving primary team:",
						)
					: t(
							"settings.contracts.teamMove.noChangesHeading",
							"No inherited operational contract rules change from this primary team move.",
						)}
			</p>

			{data.changes.length > 0 && (
				<ul className="space-y-1">
					{data.changes.map((change) => (
						<li key={change.field} className="flex flex-wrap items-center gap-1.5">
							<span className="font-medium">{labels.operationalFieldName(change.field)}:</span>
							<span>{renderChangeValue(change, "before")}</span>
							<IconArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
							<span className="font-medium">{renderChangeValue(change, "after")}</span>
							<Badge variant="outline" className="text-[10px]">
								{labels.fieldSource(change.afterSource)}
							</Badge>
						</li>
					))}
				</ul>
			)}

			{data.preservedPersonalDivergences.length > 0 && (
				<p className="text-muted-foreground">
					{t(
						"settings.contracts.teamMove.preservedDivergences",
						"Personal overrides kept unchanged: {fields}",
						{
							fields: data.preservedPersonalDivergences
								.map((f) => labels.operationalFieldName(f))
								.join(", "),
						},
					)}
				</p>
			)}

			<p className="text-muted-foreground">
				{t(
					"settings.contracts.teamMove.employeeTermsUnchanged",
					"Employee-owned terms (contract type, hourly wage, employment profile, ArbZG scope, on-call agreement) are never changed by a team move.",
				)}
			</p>
		</div>
	);
}
