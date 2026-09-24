"use client";

import { IconCalendar, IconUserMinus } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmployeeOffboardingView } from "@/lib/employee-lifecycle/view-types";
import { Link } from "@/navigation";
import { formatDepartureCutoff } from "./format";
import { useOffboardingLabels } from "./labels";

export type DepartureCardProps = {
	view: EmployeeOffboardingView;
	onSchedule: () => void;
	onOffboardNow: () => void;
	onCancelDeparture: () => void;
	onRehire: () => void;
	isMutating: boolean;
	/** Follow-up list, rendered independently of the departure state. */
	followUpList: ReactNode;
};

/**
 * Lifecycle status and the actions the server offers the viewer. The
 * departure's state is shown on its own; follow-up progress never changes
 * whether the departure is effective.
 */
export function DepartureCard(props: DepartureCardProps) {
	const { t } = useTranslate();
	const labels = useOffboardingLabels();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const { view } = props;
	const { departure, capabilities, followUp } = view;
	const cutoff = departure
		? {
				cutoff: formatDepartureCutoff(departure.cutoff, departure.timezone, locale),
				timezone: departure.timezone,
			}
		: null;

	return (
		<Card id="offboarding">
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle className="flex items-center gap-2">
						<IconUserMinus className="size-5" aria-hidden="true" />
						{t("settings.employees.offboarding.title", "Employment and departure")}
					</CardTitle>
					<Badge
						variant={view.state === "active" ? "secondary" : "outline"}
						data-testid="departure-state"
					>
						{labels.state(view.state)}
					</Badge>
				</div>
				<CardDescription>
					{view.state === "scheduled" && cutoff && (
						<>
							{departure?.lastWorkingDay &&
								t(
									"settings.employees.offboarding.lastWorkingDayValue",
									"Last working day: {date}.",
									{
										date: departure.lastWorkingDay,
									},
								)}{" "}
							{t(
								"settings.employees.offboarding.scheduledDescription",
								"Access and paid-seat usage end at {cutoff} ({timezone}).",
								cutoff,
							)}
						</>
					)}
					{view.state === "offboarded" &&
						cutoff &&
						t(
							"settings.employees.offboarding.effectiveDescription",
							"Access ended at {cutoff} ({timezone}).",
							cutoff,
						)}
					{view.state === "blocked" && labels.blocked(departure?.blockedReason ?? null)}
					{view.state === "legacy_inactive" &&
						t(
							"settings.employees.offboarding.legacyInactive",
							"This employee is inactive. The departure date was not recorded.",
						)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{view.state === "legacy_inactive" && (
					<p className="text-sm text-muted-foreground">
						{t("settings.employees.offboarding.unknownLegacyDate", "Date not recorded")}
					</p>
				)}

				{(followUp.pending > 0 || followUp.failed > 0 || followUp.openReviews > 0) && (
					<p className="text-sm" role="status">
						{followUp.pending > 0 &&
							t("settings.employees.offboarding.followUpPending", "Follow-up work pending")}
						{followUp.pending > 0 && (followUp.failed > 0 || followUp.openReviews > 0) && " · "}
						{followUp.failed > 0 &&
							t("settings.employees.offboarding.followUpFailed", "{count} failed", {
								count: followUp.failed,
							})}
						{followUp.failed > 0 && followUp.openReviews > 0 && " · "}
						{followUp.openReviews > 0 &&
							t("settings.employees.offboarding.followUpReviews", "{count} to review", {
								count: followUp.openReviews,
							})}
					</p>
				)}

				<div className="flex flex-wrap gap-2">
					{capabilities.schedule && (
						<Button
							type="button"
							variant="outline"
							disabled={props.isMutating}
							onClick={props.onSchedule}
						>
							{view.state === "scheduled"
								? t("settings.employees.offboarding.editDeparture", "Edit departure")
								: t("settings.employees.offboarding.schedule", "Schedule departure")}
						</Button>
					)}
					{capabilities.cancel && (
						<Button
							type="button"
							variant="outline"
							disabled={props.isMutating}
							onClick={props.onCancelDeparture}
						>
							{t("settings.employees.offboarding.cancelDeparture", "Cancel departure")}
						</Button>
					)}
					{capabilities.offboardNow && (
						<Button
							type="button"
							variant="destructive"
							disabled={props.isMutating}
							onClick={props.onOffboardNow}
						>
							{t("settings.employees.offboarding.offboardNow", "Offboard now")}
						</Button>
					)}
					{capabilities.rehire && (
						<Button type="button" disabled={props.isMutating} onClick={props.onRehire}>
							{t("settings.employees.offboarding.rehire", "Rehire employee")}
						</Button>
					)}
					{view.state === "offboarded" && (
						<Button asChild variant="ghost">
							<Link href={`/calendar/${view.employeeId}`}>
								<IconCalendar className="mr-1 size-4" aria-hidden="true" />
								{t("settings.employees.offboarding.historicalCalendar", "View historical calendar")}
							</Link>
						</Button>
					)}
				</div>

				{props.followUpList}
			</CardContent>
		</Card>
	);
}
