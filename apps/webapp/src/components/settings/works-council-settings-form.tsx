"use client";

import { IconGavel, IconLoader2, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import type {
	WorksCouncilAbsenceVisibility,
	WorksCouncilIdentityVisibility,
} from "@/db/schema";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { WorksCouncilSettingsFormValues } from "@/lib/works-council/settings";
import { runWithBusyState } from "./run-with-busy-state";

const nativeSelectClassName =
	"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

const MINIMUM_AGGREGATION_THRESHOLD = 5;

/** A team or location the Works Council scope can be limited to. */
export interface WorksCouncilScopeOption {
	id: string;
	name: string;
}

/** The organization's teams and locations offered by the scope pickers. */
export interface WorksCouncilScopeOptions {
	teams: WorksCouncilScopeOption[];
	locations: WorksCouncilScopeOption[];
}

const EMPTY_SCOPE_OPTIONS: WorksCouncilScopeOptions = { teams: [], locations: [] };

interface WorksCouncilSettingsFormProps {
	initialSettings: WorksCouncilSettingsFormValues & { organizationId?: string };
	scopeOptions?: WorksCouncilScopeOptions;
	onSave?: (
		values: WorksCouncilSettingsFormValues,
	) => Promise<{ success: boolean; error?: string; code?: string; refusal?: string }>;
}

function useWorksCouncilForm({ initialSettings, onSave }: WorksCouncilSettingsFormProps) {
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

			await runWithBusyState(setLoading, async () => {
				try {
					const result = await onSave(value);

					if (result.success) {
						toast.success(
							t("settings.worksCouncil.saved", "Works Council settings saved"),
						);
					} else {
						toast.error(
							actionErrorMessage(t, result, {}, [
								"settings.worksCouncil.saveError",
								"Failed to save Works Council settings",
							]),
						);
					}
				} catch {
					toast.error(
						t(
							"settings.worksCouncil.saveError",
							"Failed to save Works Council settings",
						),
					);
				}
			});
		},
	});
	const controlsDisabled = loading;
	const thresholdInvalid = t(
		"settings.worksCouncil.minimumThresholdInvalid",
		"Enter a whole number of at least 5",
	);
	const removeLabel = (name: string) =>
		t("settings.worksCouncil.removeScopeItem", "Remove {name}", { name });
	return {
		t,
		loading,
		form,
		controlsDisabled,
		thresholdInvalid,
		removeLabel,
	};
}

export function WorksCouncilSettingsForm(props: WorksCouncilSettingsFormProps) {
	const { scopeOptions = EMPTY_SCOPE_OPTIONS } = props;
	const {
		t,
		loading,
		form,
		controlsDisabled,
		thresholdInvalid,
		removeLabel,
	} =
		useWorksCouncilForm(props);

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
						{t("settings.worksCouncil.accessSectionTitle", "Access and review exports")}
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
										{t(
											"settings.worksCouncil.identityVisibility",
											"Identity visibility",
										)}
									</Label>
									<select
										id="works-council-identity-visibility"
										aria-label={t(
											"settings.worksCouncil.identityVisibility",
											"Identity visibility",
										)}
										name="identityVisibility"
										className={nativeSelectClassName}
										value={field.state.value}
										onChange={(event) =>
											field.handleChange(
												event.target.value as WorksCouncilIdentityVisibility,
											)
										}
										disabled={controlsDisabled}
									>
										<option value="aggregated">
											{t(
												"settings.worksCouncil.identity.aggregated",
												"Aggregated",
											)}
										</option>
										<option value="pseudonymized">
											{t(
												"settings.worksCouncil.identity.pseudonymized",
												"Pseudonymized",
											)}
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
										{t(
											"settings.worksCouncil.absenceVisibility",
											"Absence visibility",
										)}
									</Label>
									<select
										id="works-council-absence-visibility"
										aria-label={t(
											"settings.worksCouncil.absenceVisibility",
											"Absence visibility",
										)}
										name="absenceVisibility"
										className={nativeSelectClassName}
										value={field.state.value}
										onChange={(event) =>
											field.handleChange(
												event.target.value as WorksCouncilAbsenceVisibility,
											)
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
											{t(
												"settings.worksCouncil.absence.category",
												"Category names",
											)}
										</option>
									</select>
								</div>
							)}
						</form.Field>
					</div>

					<SwitchField
						label={t(
							"settings.worksCouncil.exportEnabled",
							"Enable review exports",
						)}
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
									aria-label={t(
										"settings.worksCouncil.exportEnabled",
										"Enable review exports",
									)}
								/>
							)}
						</form.Field>
					</SwitchField>

					<form.Field
						name="minimumAggregationThreshold"
						validators={{
							onChange: ({ value }) =>
								Number.isInteger(value) && value >= MINIMUM_AGGREGATION_THRESHOLD
									? undefined
									: thresholdInvalid,
						}}
					>
						{(field) => {
							const error = field.state.meta.errors[0];
							return (
								<div className="space-y-2">
									<Label htmlFor="works-council-minimum-threshold">
										{t(
											"settings.worksCouncil.minimumThreshold",
											"Minimum aggregation threshold",
										)}
									</Label>
									<Input
										id="works-council-minimum-threshold"
										name="minimumAggregationThreshold"
										type="number"
										inputMode="numeric"
										autoComplete="off"
										min={MINIMUM_AGGREGATION_THRESHOLD}
										step={1}
										className="max-w-40 tabular-nums"
										value={field.state.value}
										onChange={(event) =>
											field.handleChange(Number(event.target.value))
										}
										onBlur={field.handleBlur}
										aria-invalid={error ? true : undefined}
										aria-describedby={
											error
												? "works-council-minimum-threshold-description works-council-minimum-threshold-error"
												: "works-council-minimum-threshold-description"
										}
										disabled={controlsDisabled}
									/>
									<p
										id="works-council-minimum-threshold-description"
										className="text-sm text-muted-foreground"
									>
										{t(
											"settings.worksCouncil.minimumThresholdDescription",
											"Groups below this size are suppressed to reduce re-identification risk.",
										)}
									</p>
									{error ? (
										<p
											id="works-council-minimum-threshold-error"
											role="alert"
											className="text-sm text-destructive"
										>
											{String(error)}
										</p>
									) : null}
								</div>
							);
						}}
					</form.Field>

					<WorksCouncilScopeFields
						form={form}
						scopeOptions={scopeOptions}
						controlsDisabled={controlsDisabled}
						removeLabel={removeLabel}
					/>

					<Button type="submit" disabled={loading}>
						{loading && (
							<IconLoader2
								className="mr-2 size-4 animate-spin"
								aria-hidden="true"
							/>
						)}
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

/** The first characters of an id, enough to tell a stale saved id apart. */
function shortScopeId(id: string) {
	return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * Picks teams or locations by name while keeping the stored value an id array.
 * Ids saved earlier that no longer match an option stay listed as unknown, so a save never
 * silently drops them; the admin removes them explicitly.
 */
function ScopePicker({
	id,
	label,
	description,
	selectedListLabel,
	addPlaceholder,
	searchPlaceholder,
	emptyText,
	noOptionsText,
	unknownLabel,
	removeLabel,
	options,
	selectedIds,
	onChange,
	disabled,
}: {
	id: string;
	label: string;
	description: string;
	selectedListLabel: string;
	addPlaceholder: string;
	searchPlaceholder: string;
	emptyText: string;
	noOptionsText: string;
	unknownLabel: (shortId: string) => string;
	removeLabel: (name: string) => string;
	options: WorksCouncilScopeOption[];
	selectedIds: string[];
	onChange: (ids: string[]) => void;
	disabled: boolean;
}) {
	const descriptionId = `${id}-description`;
	// Team names need not be unique; a shared name gets its short id so the
	// options and chips can be told apart.
	const nameCounts = new Map<string, number>();
	for (const option of options) {
		nameCounts.set(option.name, (nameCounts.get(option.name) ?? 0) + 1);
	}
	const namesById = new Map(
		options.map((option) => [
			option.id,
			(nameCounts.get(option.name) ?? 0) > 1
				? `${option.name} (${shortScopeId(option.id)})`
				: option.name,
		]),
	);
	const selectedIdSet = new Set(selectedIds);
	const addableOptions = options
		.filter((option) => !selectedIdSet.has(option.id))
		.map((option) => ({ code: option.id, name: namesById.get(option.id) ?? option.name }));
	const nothingToAdd = addableOptions.length === 0;

	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<SearchableSelect
				id={id}
				options={addableOptions}
				value=""
				onValueChange={(addedId) => {
					if (addedId && !selectedIdSet.has(addedId)) {
						onChange([...selectedIds, addedId]);
					}
				}}
				placeholder={nothingToAdd ? noOptionsText : addPlaceholder}
				searchPlaceholder={searchPlaceholder}
				emptyText={emptyText}
				disabled={disabled || nothingToAdd}
				aria-describedby={descriptionId}
			/>
			<p id={descriptionId} className="text-sm text-muted-foreground">
				{description}
			</p>
			{selectedIds.length > 0 ? (
				<ul aria-label={selectedListLabel} className="flex flex-wrap gap-2">
					{selectedIds.map((selectedId) => {
						const name = namesById.get(selectedId);
						const displayName = name ?? unknownLabel(shortScopeId(selectedId));
						return (
							<li
								key={selectedId}
								className={
									name
										? "flex max-w-full items-center gap-1 rounded-md border bg-muted/50 py-0.5 pr-0.5 pl-2 text-sm"
										: "flex max-w-full items-center gap-1 rounded-md border border-warning/40 bg-warning/10 py-0.5 pr-0.5 pl-2 text-sm"
								}
								title={name ? undefined : selectedId}
							>
								<span className="truncate">{displayName}</span>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-7 shrink-0"
									onClick={() => onChange(selectedIds.filter((value) => value !== selectedId))}
									disabled={disabled}
									aria-label={removeLabel(displayName)}
								>
									<IconX className="size-4" aria-hidden="true" />
								</Button>
							</li>
						);
					})}
				</ul>
			) : null}
		</div>
	);
}

function WorksCouncilScopeFields({
	form,
	scopeOptions,
	controlsDisabled,
	removeLabel,
}: {
	form: ReturnType<typeof useWorksCouncilForm>["form"];
	scopeOptions: WorksCouncilScopeOptions;
	controlsDisabled: boolean;
	removeLabel: ReturnType<typeof useWorksCouncilForm>["removeLabel"];
}) {
	const { t } = useTranslate();
	return (
		<div className="grid gap-4 md:grid-cols-2">
			<form.Field name="visibleTeamIds">
				{(field) => (
					<ScopePicker
						id="works-council-visible-teams"
						label={t("settings.worksCouncil.visibleTeams", "Visible teams")}
						description={t(
							"settings.worksCouncil.visibleTeamsDescription",
							"Leave empty to include all teams.",
						)}
						selectedListLabel={t("settings.worksCouncil.selectedTeams", "Selected teams")}
						addPlaceholder={t("settings.worksCouncil.addTeam", "Add a team")}
						searchPlaceholder={t("settings.worksCouncil.searchTeams", "Search teams")}
						emptyText={t("settings.worksCouncil.noTeamFound", "No team found")}
						noOptionsText={t("settings.worksCouncil.noTeamsAvailable", "No more teams to add")}
						unknownLabel={(shortId) =>
							t("settings.worksCouncil.unknownTeam", "Unknown team ({shortId})", {
								shortId,
							})
						}
						removeLabel={removeLabel}
						options={scopeOptions.teams}
						selectedIds={field.state.value}
						onChange={field.handleChange}
						disabled={controlsDisabled}
					/>
				)}
			</form.Field>

			<form.Field name="visibleLocationIds">
				{(field) => (
					<ScopePicker
						id="works-council-visible-locations"
						label={t("settings.worksCouncil.visibleLocations", "Visible locations")}
						description={t(
							"settings.worksCouncil.visibleLocationsDescription",
							"Leave empty to include all locations.",
						)}
						selectedListLabel={t("settings.worksCouncil.selectedLocations", "Selected locations")}
						addPlaceholder={t("settings.worksCouncil.addLocation", "Add a location")}
						searchPlaceholder={t("settings.worksCouncil.searchLocations", "Search locations")}
						emptyText={t("settings.worksCouncil.noLocationFound", "No location found")}
						noOptionsText={t(
							"settings.worksCouncil.noLocationsAvailable",
							"No more locations to add",
						)}
						unknownLabel={(shortId) =>
							t("settings.worksCouncil.unknownLocation", "Unknown location ({shortId})", {
								shortId,
							})
						}
						removeLabel={removeLabel}
						options={scopeOptions.locations}
						selectedIds={field.state.value}
						onChange={field.handleChange}
						disabled={controlsDisabled}
					/>
				)}
			</form.Field>
		</div>
	);
}
