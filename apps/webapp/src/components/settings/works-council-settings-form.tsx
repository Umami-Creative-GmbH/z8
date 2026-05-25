"use client";

import { IconGavel, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { WorksCouncilAbsenceVisibility, WorksCouncilIdentityVisibility } from "@/db/schema";
import type { WorksCouncilSettingsFormValues } from "@/lib/works-council/settings";

function parseCommaSeparatedIds(value: string) {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

interface WorksCouncilSettingsFormProps {
	initialSettings: WorksCouncilSettingsFormValues & { organizationId?: string };
	onSave?: (
		values: WorksCouncilSettingsFormValues,
	) => Promise<{ success: boolean; error?: string }>;
}

export function WorksCouncilSettingsForm({
	initialSettings,
	onSave,
}: WorksCouncilSettingsFormProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		defaultValues: {
			enabled: initialSettings.enabled,
			identityVisibility: initialSettings.identityVisibility,
			absenceVisibility: initialSettings.absenceVisibility,
			exportEnabled: initialSettings.exportEnabled,
			minimumAggregationThreshold: initialSettings.minimumAggregationThreshold,
			visibleTeamIds: initialSettings.visibleTeamIds,
			visibleLocationIds: initialSettings.visibleLocationIds,
		} satisfies WorksCouncilSettingsFormValues,
		onSubmit: async ({ value }) => {
			if (!onSave) {
				return;
			}

			setLoading(true);
			const result = await onSave(value);
			setLoading(false);

			if (result.success) {
				toast.success(t("settings.worksCouncil.saved", "Works Council settings saved"));
			} else {
				toast.error(
					result.error ??
						t("settings.worksCouncil.saveError", "Failed to save Works Council settings"),
				);
			}
		},
	});
	const controlsDisabled = loading;

	return (
		<form
			className="space-y-6"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconGavel className="size-5" aria-hidden="true" />
						{t("settings.worksCouncil.title", "Works Council Mode")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.worksCouncil.formDescription",
							"Configure privacy-safe Betriebsrat access and review exports for this organization.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="grid gap-4 md:grid-cols-2">
						<form.Field name="identityVisibility">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="works-council-identity-visibility">
										{t("settings.worksCouncil.identityVisibility", "Identity visibility")}
									</Label>
									<select
										id="works-council-identity-visibility"
										name="identityVisibility"
										className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
										value={field.state.value}
										onChange={(event) =>
											field.handleChange(event.target.value as WorksCouncilIdentityVisibility)
										}
										disabled={controlsDisabled}
									>
										<option value="aggregated">
											{t("settings.worksCouncil.identity.aggregated", "Aggregated")}
										</option>
										<option value="pseudonymized">
											{t("settings.worksCouncil.identity.pseudonymized", "Pseudonymized")}
										</option>
										<option value="named">
											{t("settings.worksCouncil.identity.named", "Named")}
										</option>
									</select>
								</div>
							)}
						</form.Field>

						<form.Field name="absenceVisibility">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="works-council-absence-visibility">
										{t("settings.worksCouncil.absenceVisibility", "Absence visibility")}
									</Label>
									<select
										id="works-council-absence-visibility"
										name="absenceVisibility"
										className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
										value={field.state.value}
										onChange={(event) =>
											field.handleChange(event.target.value as WorksCouncilAbsenceVisibility)
										}
										disabled={controlsDisabled}
									>
										<option value="hidden">
											{t("settings.worksCouncil.absence.hidden", "Hidden")}
										</option>
										<option value="grouped">
											{t("settings.worksCouncil.absence.grouped", "Grouped")}
										</option>
										<option value="category">
											{t("settings.worksCouncil.absence.category", "Category names")}
										</option>
									</select>
								</div>
							)}
						</form.Field>
					</div>

					<SwitchField
						label={t("settings.worksCouncil.exportEnabled", "Enable review exports")}
						description={t(
							"settings.worksCouncil.exportEnabledDescription",
							"Allow authorized works council users to generate privacy-filtered review packs.",
						)}
					>
						<form.Field name="exportEnabled">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={controlsDisabled}
									aria-label={t("settings.worksCouncil.exportEnabled", "Enable review exports")}
								/>
							)}
						</form.Field>
					</SwitchField>

					<form.Field name="minimumAggregationThreshold">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="works-council-minimum-threshold">
									{t("settings.worksCouncil.minimumThreshold", "Minimum aggregation threshold")}
								</Label>
								<Input
									id="works-council-minimum-threshold"
									name="minimumAggregationThreshold"
									type="number"
									inputMode="numeric"
									autoComplete="off"
									min={5}
									value={field.state.value}
									onChange={(event) => field.handleChange(Number(event.target.value))}
									disabled={controlsDisabled}
								/>
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.worksCouncil.minimumThresholdDescription",
										"Groups below this size are suppressed to reduce re-identification risk.",
									)}
								</p>
							</div>
						)}
					</form.Field>

					<div className="grid gap-4 md:grid-cols-2">
						<form.Field name="visibleTeamIds">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="works-council-visible-team-ids">
										{t("settings.worksCouncil.visibleTeamIds", "Visible team IDs")}
									</Label>
									<Input
										id="works-council-visible-team-ids"
										name="visibleTeamIds"
										autoComplete="off"
										value={field.state.value.join(", ")}
										onChange={(event) =>
											field.handleChange(parseCommaSeparatedIds(event.target.value))
										}
										disabled={controlsDisabled}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.worksCouncil.visibleTeamIdsDescription",
											"Optional comma-separated team IDs. Leave empty to include all teams.",
										)}
									</p>
								</div>
							)}
						</form.Field>

						<form.Field name="visibleLocationIds">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="works-council-visible-location-ids">
										{t("settings.worksCouncil.visibleLocationIds", "Visible location IDs")}
									</Label>
									<Input
										id="works-council-visible-location-ids"
										name="visibleLocationIds"
										autoComplete="off"
										value={field.state.value.join(", ")}
										onChange={(event) =>
											field.handleChange(parseCommaSeparatedIds(event.target.value))
										}
										disabled={controlsDisabled}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.worksCouncil.visibleLocationIdsDescription",
											"Optional comma-separated location IDs. Leave empty to include all locations.",
										)}
									</p>
								</div>
							)}
						</form.Field>
					</div>

					<Button type="submit" disabled={loading}>
						{loading && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
						{t("settings.worksCouncil.save", "Save settings")}
					</Button>
				</CardContent>
			</Card>
		</form>
	);
}

function SwitchField({
	label,
	description,
	children,
}: {
	label: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
			<div className="min-w-0 space-y-1">
				<div className="font-medium">{label}</div>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			{children}
		</div>
	);
}
