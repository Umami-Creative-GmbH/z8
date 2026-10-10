"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { closeMonthAction } from "@/app/[locale]/(app)/settings/closed-months/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import { formatClosedMonthLabel } from "@/lib/time-tracking/closed-months/month-label";
import type { CloseMonthBlocker } from "@/lib/time-tracking/closed-months/store";
import { useRouter } from "@/navigation";

const ORGANIZATION = "__organization";

/**
 * Closes one month for the organization or a team (#762). A refused close
 * lists what blocks it; nothing is closed then.
 */
export function CloseMonthPanel({
	open,
	month,
	teams,
	onOpenChange,
	onClosed,
}: {
	open: boolean;
	month: string | null;
	teams: Array<{ id: string; name: string }>;
	onOpenChange: (open: boolean) => void;
	/** Called after a successful close, besides refreshing the page. */
	onClosed?: () => void;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const { refresh } = useRouter();
	const [blockers, setBlockers] = useState<CloseMonthBlocker[]>([]);
	const form = useForm({
		defaultValues: { scope: ORGANIZATION },
		onSubmit: async ({ value }) => {
			if (!month) return;
			const result = await closeMonthAction({
				month,
				scope:
					value.scope === ORGANIZATION
						? { kind: "organization" }
						: { kind: "team", teamId: value.scope },
			});
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			switch (result.data.kind) {
				case "closed":
					toast.success(
						t(
							"settings.closedMonths.closeSuccess",
							"{month} closed for {count, plural, one {# employee} other {# employees}}",
							{
								month: formatClosedMonthLabel(month, locale),
								count: result.data.employeeIds.length,
							},
						),
					);
					handleOpenChange(false);
					onClosed?.();
					refresh();
					return;
				case "blocked":
					setBlockers(result.data.blockers);
					return;
				case "nothing_to_close":
					toast.info(
						t(
							"settings.closedMonths.nothingToClose",
							"Everyone in this scope is already closed for this month.",
						),
					);
					handleOpenChange(false);
					return;
				case "team_not_found":
					toast.error(t("settings.closedMonths.teamNotFound", "This team no longer exists."));
					return;
			}
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			form.reset();
			setBlockers([]);
		}
		onOpenChange(nextOpen);
	}

	const monthLabel = month ? formatClosedMonthLabel(month, locale) : "";

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<form
					className="flex min-h-0 flex-1 flex-col"
					action={() => {
						void form.handleSubmit();
					}}
					onSubmit={(event) => event.stopPropagation()}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.closedMonths.closeTitle", "Close {month}", { month: monthLabel })}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.closedMonths.closeDescription",
								"Nobody can change work, attribution or absences in a closed month until it is reopened. Each employee's month is fixed in their own timezone.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-5">
						<form.Field name="scope">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("settings.closedMonths.scopeLabel", "Close for")}</TFormLabel>
									<Select
										name="scope"
										value={field.state.value}
										onValueChange={(value) => {
											field.handleChange(value ?? ORGANIZATION);
											setBlockers([]);
										}}
									>
										<TFormControl>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											<SelectItem value={ORGANIZATION}>
												{t("settings.closedMonths.scope.organization", "Organization")}
											</SelectItem>
											{teams.map((team) => (
												<SelectItem key={team.id} value={team.id}>
													{team.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
						{blockers.length > 0 ? <CloseBlockers blockers={blockers} /> : null}
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
							{(isSubmitting: boolean) => (
								<Button type="submit" disabled={isSubmitting || !month}>
									{isSubmitting ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : null}
									{t("settings.closedMonths.closeSubmit", "Close month")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function CloseBlockers({ blockers }: { blockers: CloseMonthBlocker[] }) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	// Each blocker's time in its employee's own zone, never the viewer's.
	const at = (instant: string, timeZone: string) =>
		new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
			new Date(instant),
		);
	return (
		<div
			role="alert"
			aria-live="polite"
			className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
		>
			<p className="font-medium text-destructive">
				{t(
					"settings.closedMonths.blockedTitle",
					"The month cannot be closed yet. Resolve these first:",
				)}
			</p>
			<ul className="list-disc space-y-1 ps-5">
				{blockers.map((blocker) => (
					<li key={blockerKey(blocker)} className="break-words">
						{blocker.employeeName}
						{": "}
						{blocker.kind === "month_not_ended"
							? t(
									"settings.closedMonths.blocker.notEnded",
									"the month has not ended in their timezone",
								)
							: blocker.kind === "absence_request"
								? t(
										"settings.closedMonths.blocker.absenceRequest",
										"undecided absence request {startDate} – {endDate}",
										{ startDate: blocker.startDate, endDate: blocker.endDate },
									)
								: blocker.kind === "time_request"
									? t(
											"settings.closedMonths.blocker.timeRequest",
											"undecided request about work from {start}",
											{ start: at(blocker.startTime, blocker.timezone) },
										)
									: t("settings.closedMonths.blocker.liveWork", "still clocked in since {start}", {
											start: at(blocker.startTime, blocker.timezone),
										})}
					</li>
				))}
			</ul>
		</div>
	);
}

function blockerKey(blocker: CloseMonthBlocker): string {
	switch (blocker.kind) {
		case "absence_request":
			return `absence:${blocker.absenceId}`;
		case "time_request":
		case "live_work":
			return `${blocker.kind}:${blocker.workPeriodId}`;
		default:
			return `${blocker.kind}:${blocker.employeeId}`;
	}
}
