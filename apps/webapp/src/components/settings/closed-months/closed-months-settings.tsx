"use client";

import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type ClosedMonthsOverview,
	saveClosedMonthSettingsAction,
} from "@/app/[locale]/(app)/settings/closed-months/actions";
import { ClosureStatusBadge } from "@/components/closed-months/closure-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { formatClosedMonthLabel } from "@/lib/time-tracking/closed-months/month-label";
import type { MonthClosureStatus } from "@/lib/time-tracking/closed-months/store";
import { useRouter } from "@/navigation";
import { CloseMonthPanel } from "./close-month-panel";
import { ReopenMonthPanel } from "./reopen-month-panel";

type PanelState = { kind: "close" | "reopen"; month: MonthClosureStatus } | null;

/** The "Closed months" settings page (#762): statuses, close and reopen, automatic close, history. */
export function ClosedMonthsSettings({ overview }: { overview: ClosedMonthsOverview }) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const [panel, setPanel] = useState<PanelState>(null);

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.closedMonths.monthsTitle", "Months")}</CardTitle>
					<CardDescription>
						{t(
							"settings.closedMonths.monthsDescription",
							"Closing a month freezes its work, attribution and absences for payroll. Notes stay editable.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ul className="divide-y">
						{overview.months.map((month) => (
							<li
								key={month.month}
								className="flex flex-wrap items-center justify-between gap-3 py-3"
							>
								<div className="flex min-w-0 items-center gap-3">
									<span className="font-medium tabular-nums">
										{formatClosedMonthLabel(month.month, locale)}
									</span>
									<ClosureStatusBadge status={month} />
								</div>
								<div className="flex gap-2">
									{overview.canClose && month.state !== "closed" ? (
										<Button
											size="sm"
											variant="outline"
											onClick={() => setPanel({ kind: "close", month })}
										>
											<IconLock className="size-4" aria-hidden="true" />
											{t("settings.closedMonths.close", "Close")}
										</Button>
									) : null}
									{overview.canReopen && month.state !== "open" ? (
										<Button
											size="sm"
											variant="outline"
											onClick={() => setPanel({ kind: "reopen", month })}
										>
											<IconLockOpen className="size-4" aria-hidden="true" />
											{t("settings.closedMonths.reopen", "Reopen")}
										</Button>
									) : null}
								</div>
							</li>
						))}
					</ul>
				</CardContent>
			</Card>

			{overview.canClose ? <AutomaticCloseCard settings={overview.settings} /> : null}

			<HistoryCard overview={overview} />

			<CloseMonthPanel
				open={panel?.kind === "close"}
				month={panel?.kind === "close" ? panel.month.month : null}
				teams={overview.teams}
				onOpenChange={(open) => !open && setPanel(null)}
			/>
			<ReopenMonthPanel
				open={panel?.kind === "reopen"}
				month={panel?.kind === "reopen" ? panel.month.month : null}
				teams={overview.teams}
				employees={overview.employees}
				onOpenChange={(open) => !open && setPanel(null)}
			/>
		</div>
	);
}

function AutomaticCloseCard({ settings }: { settings: ClosedMonthsOverview["settings"] }) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const form = useForm({
		defaultValues: {
			autoCloseEnabled: settings.autoCloseEnabled,
			autoCloseAfterDays: String(settings.autoCloseAfterDays),
		},
		onSubmit: async ({ value }) => {
			const result = await saveClosedMonthSettingsAction({
				autoCloseEnabled: value.autoCloseEnabled,
				autoCloseAfterDays: Number(value.autoCloseAfterDays),
			});
			if (result.success) {
				toast.success(t("settings.closedMonths.automatic.saved", "Automatic close saved"));
				refresh();
				return;
			}
			toast.error(result.error);
		},
	});
	const daysInvalid = t(
		"settings.closedMonths.automatic.daysInvalid",
		"Enter a whole number of days from 1 to 60",
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.closedMonths.automatic.title", "Automatic close")}</CardTitle>
				<CardDescription>
					{t(
						"settings.closedMonths.automatic.description",
						"Close the month before for the whole organization a number of days after it ends. A month that was reopened is never closed automatically again.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-4"
					action={() => {
						void form.handleSubmit();
					}}
					onSubmit={(event) => event.stopPropagation()}
				>
					<form.Field name="autoCloseEnabled">
						{(field) => (
							<div className="flex items-center gap-3">
								<Switch
									id="closed-months-auto-close"
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked)}
								/>
								<label htmlFor="closed-months-auto-close" className="text-sm">
									{t("settings.closedMonths.automatic.enabled", "Close months automatically")}
								</label>
							</div>
						)}
					</form.Field>
					<form.Field
						name="autoCloseAfterDays"
						validators={{
							onChange: ({ value }) => {
								const days = Number(value);
								return Number.isInteger(days) && days >= 1 && days <= 60 ? undefined : daysInvalid;
							},
						}}
					>
						{(field) => (
							<TFormItem className="max-w-xs">
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.closedMonths.automatic.days", "Days after month-end")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										name="autoCloseAfterDays"
										type="number"
										inputMode="numeric"
										min={1}
										max={60}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.closedMonths.automatic.daysHelp",
										"If something blocks the close, everyone allowed to close is told and it is tried again the next day.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
						{(isSubmitting: boolean) => (
							<Button type="submit" disabled={isSubmitting}>
								{t("settings.closedMonths.automatic.save", "Save")}
							</Button>
						)}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}

function HistoryCard({ overview }: { overview: ClosedMonthsOverview }) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const timestamp = new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: overview.timezone,
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.closedMonths.historyTitle", "History")}</CardTitle>
			</CardHeader>
			<CardContent>
				{overview.history.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("settings.closedMonths.historyEmpty", "No month has been closed yet.")}
					</p>
				) : (
					<ul className="divide-y">
						{overview.history.map((entry) => (
							<li key={`${entry.kind}:${entry.id}`} className="space-y-1 py-3 text-sm">
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant={entry.kind === "close" ? "secondary" : "outline"}>
										{entry.kind === "close"
											? t("settings.closedMonths.history.closed", "Closed")
											: t("settings.closedMonths.history.reopened", "Reopened")}
									</Badge>
									<span className="font-medium">{formatClosedMonthLabel(entry.month, locale)}</span>
									<span className="text-muted-foreground">
										{historyScope(t, entry)} ·{" "}
										{t(
											"settings.closedMonths.history.employees",
											"{count, plural, one {# employee} other {# employees}}",
											{ count: entry.employeeCount },
										)}
									</span>
								</div>
								<p className="text-muted-foreground">
									{entry.automatic
										? t("settings.closedMonths.history.automatic", "Automatically")
										: (entry.actorName ??
											t("settings.closedMonths.history.unknownActor", "Unknown"))}
									{" · "}
									<time dateTime={entry.at}>{timestamp.format(new Date(entry.at))}</time>
								</p>
								{entry.reason ? <p className="break-words">{entry.reason}</p> : null}
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function historyScope(
	t: ReturnType<typeof useTranslate>["t"],
	entry: ClosedMonthsOverview["history"][number],
): string {
	switch (entry.scope) {
		case "organization":
			return t("settings.closedMonths.scope.organization", "Organization");
		case "all":
			return t("settings.closedMonths.scope.all", "Everything");
		case "employees":
			return t("settings.closedMonths.scope.employees", "Selected employees");
		default:
			return entry.teamName ?? t("settings.closedMonths.scope.deletedTeam", "Deleted team");
	}
}
