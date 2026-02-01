"use client";

import {
	IconBrandGoogle,
	IconBrandWindows,
	IconCalendarShare,
	IconInfoCircle,
	IconLoader2,
	IconUsers,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	updateCalendarSettings,
	type CalendarSettings,
	type CalendarSettingsFormValues,
} from "@/app/[locale]/(app)/settings/calendar/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface CalendarSettingsFormProps {
	initialSettings: CalendarSettings;
}

export function CalendarSettingsForm({ initialSettings }: CalendarSettingsFormProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		defaultValues: {
			googleEnabled: initialSettings.googleEnabled,
			microsoft365Enabled: initialSettings.microsoft365Enabled,
			icsFeedsEnabled: initialSettings.icsFeedsEnabled,
			teamIcsFeedsEnabled: initialSettings.teamIcsFeedsEnabled,
			autoSyncOnApproval: initialSettings.autoSyncOnApproval,
			conflictDetectionRequired: initialSettings.conflictDetectionRequired,
			eventTitleTemplate: initialSettings.eventTitleTemplate,
			eventDescriptionTemplate: initialSettings.eventDescriptionTemplate,
		},
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await updateCalendarSettings(value);

			setLoading(false);

			if (result.success) {
				toast.success(t("settings.calendar.saved", "Calendar settings saved"));
			} else {
				toast.error(
					result.error || t("settings.calendar.saveError", "Failed to save calendar settings"),
				);
			}
		},
	});

	// Subscribe to form dirty state (rerender-defer-reads: only subscribe to derived boolean)
	const isDirty = useStore(form.store, (state) => state.isDirty);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className="space-y-6"
		>
			{/* Calendar Providers */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconCalendarShare className="h-5 w-5" aria-hidden="true" />
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
					{/* Google Calendar */}
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
								<IconBrandGoogle className="h-5 w-5 text-red-500" aria-hidden="true" />
							</div>
							<div>
								<div className="flex items-center gap-2">
									<span id="google-calendar-label" className="font-medium">
										{t("settings.calendar.providers.google", "Google Calendar")}
									</span>
									{!initialSettings.googleAvailable && (
										<Badge variant="secondary" className="text-xs">
											{t("settings.calendar.notConfigured", "Not Configured")}
										</Badge>
									)}
								</div>
								<p id="google-calendar-desc" className="text-sm text-muted-foreground">
									{t(
										"settings.calendar.providers.googleDesc",
										"Sync absences with Google Calendar",
									)}
								</p>
							</div>
						</div>
						<form.Field name="googleEnabled">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading || !initialSettings.googleAvailable}
									aria-labelledby="google-calendar-label"
									aria-describedby="google-calendar-desc"
								/>
							)}
						</form.Field>
					</div>

					{/* Microsoft 365 */}
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
								<IconBrandWindows className="h-5 w-5 text-blue-500" aria-hidden="true" />
							</div>
							<div>
								<div className="flex items-center gap-2">
									<span id="microsoft-calendar-label" className="font-medium">
										{t("settings.calendar.providers.microsoft", "Microsoft 365")}
									</span>
									{!initialSettings.microsoft365Available && (
										<Badge variant="secondary" className="text-xs">
											{t("settings.calendar.notConfigured", "Not Configured")}
										</Badge>
									)}
								</div>
								<p id="microsoft-calendar-desc" className="text-sm text-muted-foreground">
									{t(
										"settings.calendar.providers.microsoftDesc",
										"Sync absences with Outlook Calendar",
									)}
								</p>
							</div>
						</div>
						<form.Field name="microsoft365Enabled">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading || !initialSettings.microsoft365Available}
									aria-labelledby="microsoft-calendar-label"
									aria-describedby="microsoft-calendar-desc"
								/>
							)}
						</form.Field>
					</div>

					{!initialSettings.googleAvailable && !initialSettings.microsoft365Available && (
						<Alert>
							<IconInfoCircle className="h-4 w-4" aria-hidden="true" />
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

			{/* ICS Feeds */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconCalendarShare className="h-5 w-5" aria-hidden="true" />
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
					{/* User ICS Feeds */}
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
								<IconCalendarShare className="h-5 w-5 text-purple-500" aria-hidden="true" />
							</div>
							<div>
								<span id="personal-ics-label" className="font-medium">
									{t("settings.calendar.icsFeeds.personal", "Personal ICS Feeds")}
								</span>
								<p id="personal-ics-desc" className="text-sm text-muted-foreground">
									{t(
										"settings.calendar.icsFeeds.personalDesc",
										"Employees can create read-only calendar subscriptions for their absences",
									)}
								</p>
							</div>
						</div>
						<form.Field name="icsFeedsEnabled">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
									aria-labelledby="personal-ics-label"
									aria-describedby="personal-ics-desc"
								/>
							)}
						</form.Field>
					</div>

					{/* Team ICS Feeds */}
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
								<IconUsers className="h-5 w-5 text-green-500" aria-hidden="true" />
							</div>
							<div>
								<span id="team-ics-label" className="font-medium">
									{t("settings.calendar.icsFeeds.team", "Team ICS Feeds")}
								</span>
								<p id="team-ics-desc" className="text-sm text-muted-foreground">
									{t(
										"settings.calendar.icsFeeds.teamDesc",
										"Team leads can create shared feeds showing all team absences",
									)}
								</p>
							</div>
						</div>
						<form.Field name="teamIcsFeedsEnabled">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
									aria-labelledby="team-ics-label"
									aria-describedby="team-ics-desc"
								/>
							)}
						</form.Field>
					</div>
				</CardContent>
			</Card>

			{/* Sync Behavior */}
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.calendar.syncBehavior.title", "Sync Behavior")}</CardTitle>
					<CardDescription>
						{t(
							"settings.calendar.syncBehavior.description",
							"Configure how calendar sync works for your organization.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Auto-sync on approval */}
					<div className="flex items-center justify-between">
						<div>
							<Label id="auto-sync-label" className="text-sm font-medium">
								{t("settings.calendar.syncBehavior.autoSync", "Auto-sync on approval")}
							</Label>
							<p id="auto-sync-desc" className="text-sm text-muted-foreground">
								{t(
									"settings.calendar.syncBehavior.autoSyncDesc",
									"Automatically sync absences to connected calendars when approved",
								)}
							</p>
						</div>
						<form.Field name="autoSyncOnApproval">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
									aria-labelledby="auto-sync-label"
									aria-describedby="auto-sync-desc"
								/>
							)}
						</form.Field>
					</div>

					<div className="h-px bg-border" />

					{/* Conflict detection required */}
					<div className="flex items-center justify-between">
						<div>
							<Label id="conflict-check-label" className="text-sm font-medium">
								{t("settings.calendar.syncBehavior.conflictRequired", "Require conflict check")}
							</Label>
							<p id="conflict-check-desc" className="text-sm text-muted-foreground">
								{t(
									"settings.calendar.syncBehavior.conflictRequiredDesc",
									"Require employees to check for calendar conflicts before submitting absences",
								)}
							</p>
						</div>
						<form.Field name="conflictDetectionRequired">
							{(field) => (
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={loading}
									aria-labelledby="conflict-check-label"
									aria-describedby="conflict-check-desc"
								/>
							)}
						</form.Field>
					</div>
				</CardContent>
			</Card>

			{/* Event Customization */}
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
					{/* Title Template */}
					<form.Field name="eventTitleTemplate">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="eventTitleTemplate">
									{t("settings.calendar.customization.titleTemplate", "Event Title Template")}
								</Label>
								<Input
									id="eventTitleTemplate"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									placeholder="Out of Office - {categoryName}"
									disabled={loading}
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

					{/* Description Template */}
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
									onChange={(e) => field.handleChange(e.target.value || null)}
									placeholder={t(
										"settings.calendar.customization.descriptionPlaceholder",
										"Absence recorded in Z8",
									)}
									disabled={loading}
									rows={3}
								/>
							</div>
						)}
					</form.Field>
				</CardContent>
			</Card>

			{/* Save Button */}
			<div className="flex justify-end">
				<Button type="submit" disabled={loading || !isDirty}>
					{loading && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
					{t("common.saveChanges", "Save Changes")}
				</Button>
			</div>
		</form>
	);
}
