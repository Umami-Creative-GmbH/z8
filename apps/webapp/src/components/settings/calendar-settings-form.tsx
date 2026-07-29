"use client";

import {
	IconBrandGoogle,
	IconBrandWindows,
	IconCalendarShare,
	IconInfoCircle,
	IconLoader2,
	IconLock,
	IconUsers,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type CalendarSettings,
	type CalendarSettingsFormValues,
	type ManagerCalendarReadView,
	updateCalendarSettings,
} from "@/app/[locale]/(app)/settings/calendar/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { runWithBusyState } from "./run-with-busy-state";

const READ_ONLY_CALENDAR_SETTINGS_DEFAULTS: CalendarSettingsFormValues = {
	googleEnabled: false,
	microsoft365Enabled: false,
	icsFeedsEnabled: false,
	teamIcsFeedsEnabled: false,
	autoSyncOnApproval: false,
	conflictDetectionRequired: false,
	eventTitleTemplate: "",
	eventDescriptionTemplate: null,
};

interface CalendarSettingsFormProps {
	initialSettings: CalendarSettings | ManagerCalendarReadView;
	canManage: boolean;
}

function useCalendarSettingsForm(manageableSettings: CalendarSettings | null) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);
	const form = useForm({
		defaultValues: manageableSettings
			? {
					googleEnabled: manageableSettings.googleEnabled,
					microsoft365Enabled: manageableSettings.microsoft365Enabled,
					icsFeedsEnabled: manageableSettings.icsFeedsEnabled,
					teamIcsFeedsEnabled: manageableSettings.teamIcsFeedsEnabled,
					autoSyncOnApproval: manageableSettings.autoSyncOnApproval,
					conflictDetectionRequired:
						manageableSettings.conflictDetectionRequired,
					eventTitleTemplate: manageableSettings.eventTitleTemplate,
					eventDescriptionTemplate: manageableSettings.eventDescriptionTemplate,
				}
			: READ_ONLY_CALENDAR_SETTINGS_DEFAULTS,
		onSubmit: async ({ value }) => {
			if (!manageableSettings) return;
			await runWithBusyState(setLoading, async () => {
				try {
					const result = await updateCalendarSettings(value);
					if (result.success) {
						toast.success(
							t("settings.calendar.saved", "Calendar settings saved"),
						);
					} else {
						toast.error(
							result.error ||
								t(
									"settings.calendar.saveError",
									"Failed to save calendar settings",
								),
						);
					}
				} catch {
					toast.error(
						t(
							"settings.calendar.saveError",
							"Failed to save calendar settings",
						),
					);
				}
			});
		},
	});
	return { form, loading };
}

type CalendarSettingsFormApi = ReturnType<
	typeof useCalendarSettingsForm
>["form"];

export function CalendarSettingsForm({
	initialSettings,
	canManage,
}: CalendarSettingsFormProps) {
	const { t } = useTranslate();
	const relevantConnections = initialSettings.relevantConnections;
	const manageableSettings = canManage
		? (initialSettings as CalendarSettings)
		: null;
	const { form, loading } = useCalendarSettingsForm(manageableSettings);
	const controlsDisabled = loading || !canManage;

	// Subscribe to form dirty state (rerender-defer-reads: only subscribe to derived boolean)
	const isDirty = useStore(form.store, (state) => state.isDirty);

	if (!manageableSettings) {
		return (
			<div className="space-y-6">
				<Alert>
					<IconLock className="size-4" aria-hidden="true" />
					<AlertDescription>
						{t(
							"settings.calendar.readOnlyManagerNotice",
							"Managers can review calendar sync coverage for their teams, areas, and projects, but only organization admins can change these settings.",
						)}
					</AlertDescription>
				</Alert>

				<CalendarConnectionsCard relevantConnections={relevantConnections} />
			</div>
		);
	}

	return (
		<form
			action={() => {
				void form.handleSubmit();
			}}
			className="space-y-6"
		>
			<CalendarConnectionsCard relevantConnections={relevantConnections} />
			<CalendarProvidersCard
				form={form}
				settings={manageableSettings}
				controlsDisabled={controlsDisabled}
			/>
			<IcsFeedsCard form={form} controlsDisabled={controlsDisabled} />
			<SyncBehaviorCard form={form} controlsDisabled={controlsDisabled} />
			<EventCustomizationCard form={form} controlsDisabled={controlsDisabled} />

			{/* Save Button */}
			<div className="flex justify-end">
				<Button type="submit" disabled={controlsDisabled || !isDirty}>
					{loading && (
						<IconLoader2
							className="mr-2 size-4 animate-spin"
							aria-hidden="true"
						/>
					)}
					{t("common.saveChanges", "Save Changes")}
				</Button>
			</div>
		</form>
	);
}

function CalendarProvidersCard({
	form,
	settings,
	controlsDisabled,
}: {
	form: CalendarSettingsFormApi;
	settings: CalendarSettings;
	controlsDisabled: boolean;
}) {
	const { t } = useTranslate();
	const providers = [
		{
			name: "googleEnabled" as const,
			available: settings.googleAvailable,
			labelId: "google-calendar-label",
			descriptionId: "google-calendar-desc",
			label: t("settings.calendar.providers.google", "Google Calendar"),
			description: t(
				"settings.calendar.providers.googleDesc",
				"Sync absences with Google Calendar",
			),
			icon: (
				<IconBrandGoogle className="size-5 text-red-500" aria-hidden="true" />
			),
			iconClassName: "bg-red-100 dark:bg-red-900/30",
		},
		{
			name: "microsoft365Enabled" as const,
			available: settings.microsoft365Available,
			labelId: "microsoft-calendar-label",
			descriptionId: "microsoft-calendar-desc",
			label: t("settings.calendar.providers.microsoft", "Microsoft 365"),
			description: t(
				"settings.calendar.providers.microsoftDesc",
				"Sync absences with Outlook Calendar",
			),
			icon: (
				<IconBrandWindows className="size-5 text-blue-500" aria-hidden="true" />
			),
			iconClassName: "bg-blue-100 dark:bg-blue-900/30",
		},
	];

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCalendarShare className="size-5" aria-hidden="true" />
					{t("settings.calendar.providers.title", "Calendar Providers")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.calendar.providers.description",
						"Enable or disable calendar sync for specific providers. Employees can connect their accounts when enabled.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{providers.map((provider) => (
					<div
						key={provider.name}
						className="flex items-center justify-between rounded-lg border p-4"
					>
						<div className="flex items-center gap-3">
							<div
								className={`flex size-10 items-center justify-center rounded-full ${provider.iconClassName}`}
							>
								{provider.icon}
							</div>
							<div>
								<div className="flex items-center gap-2">
									<span id={provider.labelId} className="font-medium">
										{provider.label}
									</span>
									{!provider.available && (
										<Badge variant="secondary" className="text-xs">
											{t("settings.calendar.notConfigured", "Not Configured")}
										</Badge>
									)}
								</div>
								<p
									id={provider.descriptionId}
									className="text-sm text-muted-foreground"
								>
									{provider.description}
								</p>
							</div>
						</div>
						<form.Field name={provider.name}>
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={controlsDisabled || !provider.available}
									aria-labelledby={provider.labelId}
									aria-describedby={provider.descriptionId}
								/>
							)}
						</form.Field>
					</div>
				))}
				{!settings.googleAvailable && !settings.microsoft365Available && (
					<Alert>
						<IconInfoCircle className="size-4" aria-hidden="true" />
						<AlertDescription>
							{t(
								"settings.calendar.noProvidersConfigured",
								"No calendar providers are configured. Contact your system administrator to set up OAuth credentials.",
							)}
						</AlertDescription>
					</Alert>
				)}
			</CardContent>
		</Card>
	);
}

function IcsFeedsCard({
	form,
	controlsDisabled,
}: {
	form: CalendarSettingsFormApi;
	controlsDisabled: boolean;
}) {
	const { t } = useTranslate();
	const feeds = [
		{
			name: "icsFeedsEnabled" as const,
			labelId: "personal-ics-label",
			descriptionId: "personal-ics-desc",
			label: t("settings.calendar.icsFeeds.personal", "Personal ICS Feeds"),
			description: t(
				"settings.calendar.icsFeeds.personalDesc",
				"Employees can create read-only calendar subscriptions for their absences",
			),
			icon: (
				<IconCalendarShare
					className="size-5 text-purple-500"
					aria-hidden="true"
				/>
			),
			iconClassName: "bg-purple-100 dark:bg-purple-900/30",
		},
		{
			name: "teamIcsFeedsEnabled" as const,
			labelId: "team-ics-label",
			descriptionId: "team-ics-desc",
			label: t("settings.calendar.icsFeeds.team", "Team ICS Feeds"),
			description: t(
				"settings.calendar.icsFeeds.teamDesc",
				"Team leads can create shared feeds showing all team absences",
			),
			icon: <IconUsers className="size-5 text-green-500" aria-hidden="true" />,
			iconClassName: "bg-green-100 dark:bg-green-900/30",
		},
	];

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCalendarShare className="size-5" aria-hidden="true" />
					{t("settings.calendar.icsFeeds.title", "ICS Feeds")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.calendar.icsFeeds.description",
						"Allow users to subscribe to absence calendars via ICS/iCal format.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{feeds.map((feed) => (
					<div
						key={feed.name}
						className="flex items-center justify-between rounded-lg border p-4"
					>
						<div className="flex items-center gap-3">
							<div
								className={`flex size-10 items-center justify-center rounded-full ${feed.iconClassName}`}
							>
								{feed.icon}
							</div>
							<div>
								<span id={feed.labelId} className="font-medium">
									{feed.label}
								</span>
								<p
									id={feed.descriptionId}
									className="text-sm text-muted-foreground"
								>
									{feed.description}
								</p>
							</div>
						</div>
						<form.Field name={feed.name}>
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={controlsDisabled}
									aria-labelledby={feed.labelId}
									aria-describedby={feed.descriptionId}
								/>
							)}
						</form.Field>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

function SyncBehaviorCard({
	form,
	controlsDisabled,
}: {
	form: CalendarSettingsFormApi;
	controlsDisabled: boolean;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.calendar.syncBehavior.title", "Sync Behavior")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.calendar.syncBehavior.description",
						"Configure how calendar sync works for your organization.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<CalendarSwitchField
					form={form}
					name="autoSyncOnApproval"
					labelId="auto-sync-label"
					descriptionId="auto-sync-desc"
					label={t(
						"settings.calendar.syncBehavior.autoSync",
						"Auto-sync on approval",
					)}
					description={t(
						"settings.calendar.syncBehavior.autoSyncDesc",
						"Automatically sync absences to connected calendars when approved",
					)}
					disabled={controlsDisabled}
				/>
				<div className="h-px bg-border" />
				<CalendarSwitchField
					form={form}
					name="conflictDetectionRequired"
					labelId="conflict-check-label"
					descriptionId="conflict-check-desc"
					label={t(
						"settings.calendar.syncBehavior.conflictRequired",
						"Require conflict check",
					)}
					description={t(
						"settings.calendar.syncBehavior.conflictRequiredDesc",
						"Require employees to check for calendar conflicts before submitting absences",
					)}
					disabled={controlsDisabled}
				/>
			</CardContent>
		</Card>
	);
}

function CalendarSwitchField({
	form,
	name,
	labelId,
	descriptionId,
	label,
	description,
	disabled,
}: {
	form: CalendarSettingsFormApi;
	name: "autoSyncOnApproval" | "conflictDetectionRequired";
	labelId: string;
	descriptionId: string;
	label: string;
	description: string;
	disabled: boolean;
}) {
	return (
		<div className="flex items-center justify-between">
			<div>
				<Label id={labelId} className="text-sm font-medium">
					{label}
				</Label>
				<p id={descriptionId} className="text-sm text-muted-foreground">
					{description}
				</p>
			</div>
			<form.Field name={name}>
				{(field) => (
					<Switch
						checked={field.state.value}
						onCheckedChange={field.handleChange}
						disabled={disabled}
						aria-labelledby={labelId}
						aria-describedby={descriptionId}
					/>
				)}
			</form.Field>
		</div>
	);
}

function EventCustomizationCard({
	form,
	controlsDisabled,
}: {
	form: CalendarSettingsFormApi;
	controlsDisabled: boolean;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.calendar.customization.title", "Event Customization")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.calendar.customization.description",
						"Customize how absence events appear in external calendars.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form.Field name="eventTitleTemplate">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor="eventTitleTemplate">
								{t(
									"settings.calendar.customization.titleTemplate",
									"Event Title Template",
								)}
							</Label>
							<Input
								id="eventTitleTemplate"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								placeholder="Out of Office - {categoryName}"
								disabled={controlsDisabled}
							/>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.calendar.customization.titleHelp",
									"Available variables: {categoryName}, {employeeName}, {status}",
								)}
							</p>
						</div>
					)}
				</form.Field>
				<form.Field name="eventDescriptionTemplate">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor="eventDescriptionTemplate">
								{t(
									"settings.calendar.customization.descriptionTemplate",
									"Event Description (optional)",
								)}
							</Label>
							<Textarea
								id="eventDescriptionTemplate"
								value={field.state.value ?? ""}
								onChange={(event) =>
									field.handleChange(event.target.value || null)
								}
								placeholder={t(
									"settings.calendar.customization.descriptionPlaceholder",
									"Absence recorded in Z8",
								)}
								disabled={controlsDisabled}
								rows={3}
							/>
						</div>
					)}
				</form.Field>
			</CardContent>
		</Card>
	);
}

function CalendarConnectionsCard({
	relevantConnections,
}: {
	relevantConnections: ManagerCalendarReadView["relevantConnections"];
}) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.calendar.integrations.title", "Relevant Integrations")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.calendar.integrations.description",
						"Connected employee calendars that fall inside your current settings scope.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{relevantConnections.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.calendar.integrations.empty",
							"No calendar integrations are available in your current scope yet.",
						)}
					</p>
				) : (
					relevantConnections.map((connection) => (
						<div
							key={connection.id}
							className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="space-y-1">
								<p className="font-medium">{connection.employeeName}</p>
								<p className="text-sm text-muted-foreground">
									{connection.providerAccountId}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
								<Badge variant="outline">{connection.providerLabel}</Badge>
								<Badge
									variant={connection.pushEnabled ? "default" : "secondary"}
								>
									{connection.pushEnabled
										? t("settings.calendar.integrations.pushOn", "Push on")
										: t("settings.calendar.integrations.pushOff", "Push off")}
								</Badge>
								{connection.lastSyncError && (
									<Badge variant="destructive">
										{t(
											"settings.calendar.integrations.needsAttention",
											"Needs attention",
										)}
									</Badge>
								)}
							</div>
						</div>
					))
				)}
			</CardContent>
		</Card>
	);
}
