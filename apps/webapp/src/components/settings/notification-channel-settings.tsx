"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
	NotificationChannelConfig,
	NotificationChannelSettingsFormValues,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimeInput } from "@/components/ui/time-input";

interface NotificationChannelSettingsProps {
	channelName: string;
	description: string;
	config: NotificationChannelConfig | null;
	updateAction: (
		settings: NotificationChannelSettingsFormValues,
	) => Promise<{ success: true; data: undefined } | { success: false; error: string }>;
}

const fallbackSettings: NotificationChannelSettingsFormValues = {
	enableApprovals: false,
	enableCommands: false,
	enableDailyDigest: false,
	enableEscalations: false,
	digestTime: "09:00",
	digestTimezone: "Europe/Berlin",
	escalationTimeoutHours: 24,
};

export function NotificationChannelSettings({
	channelName,
	description,
	config,
	updateAction,
}: NotificationChannelSettingsProps) {
	const { t } = useTranslate();
	const isConfigured = Boolean(config);
	const isActive = config?.setupStatus === "active";
	const statusLabel = config
		? getSetupStatusLabel(config.setupStatus, t)
		: t("settings.notifications.status.notConfigured", "Not configured");
	const controlsDisabled = !isConfigured;
	const { refresh } = useRouter();

	const updateMutation = useMutation({
		mutationFn: updateAction,
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.notifications.saved", "{channelName} notification settings saved", {
						channelName,
					}),
				);
				refresh();
				return;
			}

			toast.error(result.error);
		},
		onError: () => {
			toast.error(
				t(
					"settings.notifications.saveFailed",
					"Failed to save {channelName} notification settings",
					{ channelName },
				),
			);
		},
	});

	const form = useForm({
		defaultValues: (config ?? fallbackSettings) satisfies NotificationChannelSettingsFormValues,
		onSubmit: async ({ value }) => {
			if (!config) {
				return;
			}

			await updateMutation.mutateAsync(value);
		},
	});

	const isDirty = useStore(form.store, (state) => state.isDirty);
	const isSubmitting = updateMutation.isPending;
	const disableForm = controlsDisabled || isSubmitting;

	return (
		<div className="min-w-0 space-y-6">
			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="min-w-0 space-y-1">
							<CardTitle>{channelName}</CardTitle>
							<CardDescription>{description}</CardDescription>
						</div>
						<Badge variant={isActive ? "default" : "secondary"}>{statusLabel}</Badge>
					</div>
				</CardHeader>
				<CardContent className="space-y-2">
					<p className="break-words text-sm font-medium">
						{config?.displayName ??
							t("settings.notifications.notConnected", "{channelName} is not connected", {
								channelName,
							})}
					</p>
					<p className="text-sm text-muted-foreground">
						{config
							? t(
									"settings.notifications.manageEnabledFeatures",
									"Manage which notification features are enabled for this integration.",
								)
							: t(
									"settings.notifications.connectBeforeChanging",
									"Connect or configure this integration before changing notification settings.",
								)}
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("settings.notifications.featureSettings", "Feature Settings")}</CardTitle>
					<CardDescription>
						{t(
							"settings.notifications.featureSettingsDescription",
							"Choose which organization notifications and commands are available through this channel.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="space-y-5"
						onSubmit={(event) => {
							event.preventDefault();
							form.handleSubmit();
						}}
					>
						<div className="flex min-w-0 items-center justify-between gap-4">
							<div className="min-w-0 space-y-1">
								<Label htmlFor="enableApprovals" className="text-sm font-medium">
									{t("settings.notifications.approvals", "Approval notifications")}
								</Label>
								<p
									id="enableApprovals-description"
									className="break-words text-sm text-muted-foreground"
								>
									{t(
										"settings.notifications.approvalsDescription",
										"Send approval requests and approval status updates.",
									)}
								</p>
							</div>
							<form.Field name="enableApprovals">
								{(field) => (
									<Switch
										id="enableApprovals"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
										disabled={disableForm}
										aria-describedby="enableApprovals-description"
										className="shrink-0"
									/>
								)}
							</form.Field>
						</div>

						<div className="h-px bg-border" />

						<div className="flex min-w-0 items-center justify-between gap-4">
							<div className="min-w-0 space-y-1">
								<Label htmlFor="enableCommands" className="text-sm font-medium">
									{t("settings.notifications.commands", "Commands")}
								</Label>
								<p
									id="enableCommands-description"
									className="break-words text-sm text-muted-foreground"
								>
									{t(
										"settings.notifications.commandsDescription",
										"Allow supported workplace commands from this channel.",
									)}
								</p>
							</div>
							<form.Field name="enableCommands">
								{(field) => (
									<Switch
										id="enableCommands"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
										disabled={disableForm}
										aria-describedby="enableCommands-description"
										className="shrink-0"
									/>
								)}
							</form.Field>
						</div>

						<div className="h-px bg-border" />

						<div className="space-y-3">
							<div className="flex min-w-0 items-center justify-between gap-4">
								<div className="min-w-0 space-y-1">
									<Label htmlFor="enableDailyDigest" className="text-sm font-medium">
										{t("settings.notifications.dailyDigest", "Daily digest")}
									</Label>
									<p
										id="enableDailyDigest-description"
										className="break-words text-sm text-muted-foreground"
									>
										{t(
											"settings.notifications.dailyDigestDescription",
											"Send a daily summary of absences, schedules, and pending work.",
										)}
									</p>
								</div>
								<form.Field name="enableDailyDigest">
									{(field) => (
										<Switch
											id="enableDailyDigest"
											checked={field.state.value}
											onCheckedChange={field.handleChange}
											disabled={disableForm}
											aria-describedby="enableDailyDigest-description"
											className="shrink-0"
										/>
									)}
								</form.Field>
							</div>

							<div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
								<form.Field name="digestTime">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor="digestTime">
												{t("settings.notifications.digestTime", "Digest time")}
											</Label>
											<TimeInput
												id="digestTime"
												name="digestTime"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												disabled={disableForm}
												autoComplete="off"
											/>
										</div>
									)}
								</form.Field>
								<form.Field name="digestTimezone">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor="digestTimezone">
												{t("settings.notifications.timezone", "Timezone")}
											</Label>
											<Input
												id="digestTimezone"
												name="digestTimezone"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												disabled={disableForm}
												placeholder={t(
													"settings.notifications.timezonePlaceholder",
													"Europe/Berlin…",
												)}
												autoComplete="off"
											/>
										</div>
									)}
								</form.Field>
							</div>
						</div>

						<div className="h-px bg-border" />

						<div className="space-y-3">
							<div className="flex min-w-0 items-center justify-between gap-4">
								<div className="min-w-0 space-y-1">
									<Label htmlFor="enableEscalations" className="text-sm font-medium">
										{t("settings.notifications.escalations", "Escalations")}
									</Label>
									<p
										id="enableEscalations-description"
										className="break-words text-sm text-muted-foreground"
									>
										{t(
											"settings.notifications.escalationsDescription",
											"Escalate unanswered approval requests after the configured timeout.",
										)}
									</p>
								</div>
								<form.Field name="enableEscalations">
									{(field) => (
										<Switch
											id="enableEscalations"
											checked={field.state.value}
											onCheckedChange={field.handleChange}
											disabled={disableForm}
											aria-describedby="enableEscalations-description"
											className="shrink-0"
										/>
									)}
								</form.Field>
							</div>

							<form.Field name="escalationTimeoutHours">
								{(field) => (
									<div className="flex max-w-xs items-center gap-3 rounded-lg border bg-muted/30 p-3">
										<Label htmlFor="escalationTimeoutHours" className="shrink-0">
											{t("settings.notifications.timeout", "Timeout")}
										</Label>
										<Input
											id="escalationTimeoutHours"
											name="escalationTimeoutHours"
											type="number"
											min={1}
											max={168}
											value={field.state.value}
											onChange={(event) => field.handleChange(Number(event.target.value))}
											disabled={disableForm}
											autoComplete="off"
											className="w-24"
										/>
										<span className="text-sm text-muted-foreground">
											{t("settings.notifications.hours", "hours")}
										</span>
									</div>
								)}
							</form.Field>
						</div>

						<div className="flex justify-end pt-2">
							<Button type="submit" disabled={disableForm || !isDirty}>
								{isSubmitting && (
									<IconLoader2
										className="mr-2 h-4 w-4 motion-safe:animate-spin"
										aria-hidden="true"
									/>
								)}
								{t("settings.notifications.saveSettings", "Save Settings")}
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}

function getSetupStatusLabel(setupStatus: string, t: ReturnType<typeof useTranslate>["t"]): string {
	switch (setupStatus) {
		case "active":
			return t("settings.notifications.status.active", "Active");
		case "pending":
			return t("settings.notifications.status.pending", "Pending");
		case "configured":
			return t("settings.notifications.status.configured", "Configured");
		case "error":
			return t("settings.notifications.status.error", "Error");
		case "disconnected":
			return t("settings.notifications.status.disconnected", "Disconnected");
		case "disabled":
			return t("settings.notifications.status.disabled", "Disabled");
		default:
			return t("settings.notifications.status.unknown", "Unknown status");
	}
}
