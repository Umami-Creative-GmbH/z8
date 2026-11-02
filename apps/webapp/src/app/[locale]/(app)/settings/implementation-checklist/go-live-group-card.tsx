"use client";

import { IconLoader2, IconUserOff } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useTransition } from "react";
import { toast } from "sonner";
import { EmployeeSingleSelect } from "@/components/employee-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import {
	GO_LIVE_EXCLUSION_REASON_MAX_LENGTH,
	type GoLiveExclusionView,
	type GoLiveGroupRefusal,
	type GoLiveGroupSettings,
} from "@/lib/implementation-checklist/go-live/group-types";
import {
	chooseGoLiveGroupTeamsAction,
	createGoLiveExclusionAction,
	type GoLiveGroupActionResult,
	liftGoLiveExclusionAction,
} from "./go-live-group-actions";

type Translate = ReturnType<typeof useTranslate>["t"];

function refusalMessage(
	t: Translate,
	result: Extract<GoLiveGroupActionResult, { success: false }>,
) {
	const messages: Record<GoLiveGroupRefusal, string> = {
		team_not_found: t(
			"settings.implementationChecklist.goLive.group.errors.teamNotFound",
			"One of the chosen teams no longer exists.",
		),
		employee_not_found: t(
			"settings.implementationChecklist.goLive.group.errors.employeeNotFound",
			"This employee is not on the current roster.",
		),
		reason_required: t(
			"settings.implementationChecklist.goLive.group.errors.reasonRequired",
			"Give a reason for the exclusion.",
		),
		reason_too_long: t(
			"settings.implementationChecklist.goLive.group.errors.reasonTooLong",
			"The reason is too long.",
		),
		already_excluded: t(
			"settings.implementationChecklist.goLive.group.errors.alreadyExcluded",
			"This employee is already excluded.",
		),
		exclusion_not_found: t(
			"settings.implementationChecklist.goLive.group.errors.exclusionNotFound",
			"This exclusion has already ended.",
		),
	};
	return result.refusal
		? messages[result.refusal]
		: t(
				"settings.implementationChecklist.goLive.group.errors.updateFailed",
				"Failed to update the go-live group.",
			);
}

/**
 * Who is going live: team narrowing and go-live exclusions. Changes take effect
 * on the next check, which the action's revalidation runs at once.
 */
export function GoLiveGroupCard({
	group,
	memberCount,
}: {
	group: GoLiveGroupSettings | null;
	memberCount: number | null;
}) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2 className="font-semibold text-base">
						{t("settings.implementationChecklist.goLive.group.title", "Go-live group")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"settings.implementationChecklist.goLive.group.description",
						"Go-live checks run for everyone on the current roster and everyone invited but not yet joined, less any exclusions. For a phased go-live, choose the teams going live.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{memberCount !== null ? (
					<p className="font-medium text-sm tabular-nums">
						{t(
							"settings.implementationChecklist.goLive.group.memberCount",
							"{count, plural, one {# person is} other {# people are}} checked",
							{ count: memberCount },
						)}
					</p>
				) : null}
				{group ? (
					<>
						<GoLiveTeamsForm group={group} />
						<GoLiveExclusions exclusions={group.exclusions} />
					</>
				) : (
					<p className="text-muted-foreground text-sm">
						{t(
							"settings.implementationChecklist.goLive.group.unavailable",
							"The go-live group's teams and exclusions couldn't be loaded. Retry the checks.",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function GoLiveTeamsForm({ group }: { group: GoLiveGroupSettings }) {
	const { t } = useTranslate();
	const headingId = useId();
	const form = useForm({
		defaultValues: { teamIds: group.chosenTeamIds },
		onSubmit: async ({ value }) => {
			const result = await chooseGoLiveGroupTeamsAction(value.teamIds);
			if (!result.success) toast.error(refusalMessage(t, result));
		},
	});

	return (
		<section aria-labelledby={headingId} className="space-y-3">
			<div className="space-y-1">
				<h3 className="font-medium text-sm" id={headingId}>
					{t("settings.implementationChecklist.goLive.group.teams.title", "Teams going live")}
				</h3>
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.implementationChecklist.goLive.group.teams.help",
						"With no team chosen, everyone is checked. Otherwise only people whose primary team is chosen, and invited people whose invitation names a chosen team. Other team memberships don't count.",
					)}
				</p>
			</div>
			{group.teams.length ? (
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field name="teamIds">
						{(field) => (
							<ul className="grid gap-2 sm:grid-cols-2">
								{group.teams.map((team) => {
									const labelId = `${headingId}-${team.id}`;
									const checked = field.state.value.includes(team.id);
									return (
										<li key={team.id}>
											<label className="flex items-center gap-2 text-sm">
												<Checkbox
													aria-labelledby={labelId}
													checked={checked}
													onCheckedChange={(next) =>
														field.handleChange(
															next
																? [...field.state.value, team.id]
																: field.state.value.filter((id) => id !== team.id),
														)
													}
												/>
												<span id={labelId}>{team.name}</span>
											</label>
										</li>
									);
								})}
							</ul>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => [state.isSubmitting, state.isDefaultValue] as const}>
						{([isSubmitting, isDefaultValue]) => (
							<Button disabled={isSubmitting || isDefaultValue} size="sm" type="submit">
								{isSubmitting ? (
									<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
								) : null}
								{t("settings.implementationChecklist.goLive.group.teams.save", "Save teams")}
							</Button>
						)}
					</form.Subscribe>
				</form>
			) : (
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.implementationChecklist.goLive.group.teams.none",
						"Your organization has no teams yet, so everyone goes live together.",
					)}
				</p>
			)}
		</section>
	);
}

function GoLiveExclusions({ exclusions }: { exclusions: GoLiveExclusionView[] }) {
	const { t } = useTranslate();
	const headingId = useId();
	const displayContext = useDisplayContext();
	const [isLifting, startLift] = useTransition();

	function lift(exclusion: GoLiveExclusionView) {
		startLift(async () => {
			const result = await liftGoLiveExclusionAction(exclusion.id);
			if (!result.success) toast.error(refusalMessage(t, result));
		});
	}

	return (
		<section aria-labelledby={headingId} className="space-y-3">
			<div className="space-y-1">
				<h3 className="font-medium text-sm" id={headingId}>
					{t("settings.implementationChecklist.goLive.group.excluded.title", "Excluded")}
				</h3>
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.implementationChecklist.goLive.group.excluded.help",
						"Excluded employees aren't checked, for example a director who doesn't track time. An exclusion lasts until you lift it, or until the employee leaves.",
					)}
				</p>
			</div>
			{exclusions.length ? (
				<ul className="divide-y rounded-md border">
					{exclusions.map((exclusion) => (
						<li className="flex flex-wrap items-start justify-between gap-3 p-3" key={exclusion.id}>
							<div className="min-w-0 space-y-1 text-sm">
								<p className="font-medium">{exclusion.displayName}</p>
								<p className="break-words">{exclusion.reason}</p>
								<p className="text-muted-foreground text-xs">
									{exclusion.createdByName
										? t(
												"settings.implementationChecklist.goLive.group.excluded.byOn",
												"Excluded by {name} on {date}",
												{
													name: exclusion.createdByName,
													date: formatInstant(
														parseInstant(exclusion.createdAt),
														displayContext,
														"dateMedium",
													),
												},
											)
										: t(
												"settings.implementationChecklist.goLive.group.excluded.on",
												"Excluded on {date}",
												{
													date: formatInstant(
														parseInstant(exclusion.createdAt),
														displayContext,
														"dateMedium",
													),
												},
											)}
								</p>
							</div>
							<Button
								aria-label={t(
									"settings.implementationChecklist.goLive.group.excluded.liftFor",
									"Lift exclusion for {name}",
									{ name: exclusion.displayName },
								)}
								disabled={isLifting}
								onClick={() => lift(exclusion)}
								size="sm"
								type="button"
								variant="outline"
							>
								{t("settings.implementationChecklist.goLive.group.excluded.lift", "Lift")}
							</Button>
						</li>
					))}
				</ul>
			) : (
				<p className="text-muted-foreground text-sm">
					{t("settings.implementationChecklist.goLive.group.excluded.none", "Nobody is excluded.")}
				</p>
			)}
			<GoLiveExclusionForm excludedIds={exclusions.map((exclusion) => exclusion.employeeId)} />
		</section>
	);
}

function GoLiveExclusionForm({ excludedIds }: { excludedIds: string[] }) {
	const { t } = useTranslate();
	const reasonId = useId();
	const form = useForm({
		defaultValues: { employeeId: null as string | null, reason: "" },
		onSubmit: async ({ value, formApi }) => {
			if (!value.employeeId) return;
			const result = await createGoLiveExclusionAction({
				employeeId: value.employeeId,
				reason: value.reason,
			});
			if (!result.success) {
				toast.error(refusalMessage(t, result));
				return;
			}
			formApi.reset();
		},
	});

	return (
		<form
			className="space-y-3 rounded-md border border-dashed p-3"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="employeeId"
				validators={{
					onSubmit: ({ value }) =>
						value
							? undefined
							: t(
									"settings.implementationChecklist.goLive.group.exclude.employeeRequired",
									"Choose an employee.",
								),
				}}
			>
				{(field) => (
					<TFormItem>
						<EmployeeSingleSelect
							error={fieldHasError(field) ? String(field.state.meta.errors[0]) : undefined}
							excludeIds={excludedIds}
							label={t(
								"settings.implementationChecklist.goLive.group.exclude.employee",
								"Employee",
							)}
							onChange={field.handleChange}
							value={field.state.value}
						/>
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="reason"
				validators={{
					onSubmit: ({ value }) => {
						const reason = value.trim();
						if (!reason) {
							return t(
								"settings.implementationChecklist.goLive.group.errors.reasonRequired",
								"Give a reason for the exclusion.",
							);
						}
						return reason.length > GO_LIVE_EXCLUSION_REASON_MAX_LENGTH
							? t(
									"settings.implementationChecklist.goLive.group.errors.reasonTooLong",
									"The reason is too long.",
								)
							: undefined;
					},
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} htmlFor={reasonId} required>
							{t("settings.implementationChecklist.goLive.group.exclude.reason", "Reason")}
						</TFormLabel>
						<Textarea
							aria-invalid={fieldHasError(field)}
							id={reasonId}
							maxLength={GO_LIVE_EXCLUSION_REASON_MAX_LENGTH}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
							placeholder={t(
								"settings.implementationChecklist.goLive.group.exclude.reasonPlaceholder",
								"For example: director, doesn't track time",
							)}
							rows={2}
							value={field.state.value}
						/>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button disabled={isSubmitting} size="sm" type="submit" variant="outline">
						{isSubmitting ? (
							<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
						) : (
							<IconUserOff aria-hidden="true" className="size-4" />
						)}
						{t("settings.implementationChecklist.goLive.group.exclude.submit", "Exclude")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}
