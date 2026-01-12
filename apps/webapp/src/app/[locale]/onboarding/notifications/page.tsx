"use client";

import { useForm } from "@tanstack/react-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { IconBell, IconLoader2, IconMail } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useRouter } from "@/navigation";
import { configureNotificationsOnboarding, skipNotificationsSetup } from "./actions";

export default function NotificationsPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const {
		requestPermission,
		isSupported,
		permission,
		isLoading: pushLoading,
	} = usePushNotifications();

	const form = useForm({
		defaultValues: {
			enablePush: false,
			enableEmail: true,
			notifyApprovals: true,
			notifyStatusUpdates: true,
			notifyTeamChanges: true,
		},
		validatorAdapter: zodValidator(),
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await configureNotificationsOnboarding(value);

			setLoading(false);

			if (result.success) {
				toast.success(t("onboarding.notifications.success", "Notification preferences saved!"));
				router.push("/onboarding/complete");
			} else {
				toast.error(
					result.error ||
						t("onboarding.notifications.error", "Failed to save notification preferences"),
				);
			}
		},
	});

	async function handleEnablePush() {
		if (!isSupported) {
			toast.error(
				t(
					"onboarding.notifications.pushNotSupported",
					"Push notifications are not supported in this browser",
				),
			);
			return;
		}

		const success = await requestPermission();
		if (success) {
			form.setFieldValue("enablePush", true);
			toast.success(t("onboarding.notifications.pushEnabled", "Push notifications enabled!"));
		} else {
			toast.error(t("onboarding.notifications.pushDenied", "Push notification permission denied"));
		}
	}

	async function handleSkip() {
		setLoading(true);

		const result = await skipNotificationsSetup();

		setLoading(false);

		if (result.success) {
			router.push("/onboarding/complete");
		} else {
			toast.error(result.error || "Failed to skip notification setup");
		}
	}

	return (
		<>
			<ProgressIndicator currentStep="notifications" />

			<div className="mx-auto max-w-2xl">
				<div className="mb-8 text-center">
					<div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
						<IconBell className="size-8 text-primary" />
					</div>
					<h1 className="mb-4 text-3xl font-bold tracking-tight">
						{t("onboarding.notifications.title", "Set up notifications")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"onboarding.notifications.subtitle",
							"Choose how you want to receive updates about approvals, status changes, and team activities.",
						)}
					</p>
				</div>

				<Card className="mb-6">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconBell className="size-5" />
							{t("onboarding.notifications.pushTitle", "Push Notifications")}
						</CardTitle>
						<CardDescription>
							{t(
								"onboarding.notifications.pushDesc",
								"Receive instant updates even when you're not using the app.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{isSupported ? (
							<div className="flex items-center justify-between">
								<div className="space-y-1">
									<p className="text-sm font-medium">
										{permission === "granted"
											? t("onboarding.notifications.pushGranted", "Push notifications enabled")
											: t("onboarding.notifications.pushPrompt", "Enable push notifications")}
									</p>
									<p className="text-sm text-muted-foreground">
										{permission === "granted"
											? t(
													"onboarding.notifications.pushGrantedDesc",
													"You will receive push notifications",
												)
											: t(
													"onboarding.notifications.pushPromptDesc",
													"Click to enable push notifications",
												)}
									</p>
								</div>
								{permission !== "granted" ? (
									<Button
										variant="outline"
										onClick={handleEnablePush}
										disabled={pushLoading || loading}
									>
										{pushLoading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
										{t("onboarding.notifications.enable", "Enable")}
									</Button>
								) : (
									<div className="flex items-center gap-2 text-green-600">
										<IconBell className="size-5" />
										<span className="text-sm font-medium">{t("common.enabled", "Enabled")}</span>
									</div>
								)}
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								{t(
									"onboarding.notifications.pushNotSupported",
									"Push notifications are not supported in this browser",
								)}
							</p>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconMail className="size-5" />
							{t("onboarding.notifications.preferencesTitle", "Notification Preferences")}
						</CardTitle>
						<CardDescription>
							{t(
								"onboarding.notifications.preferencesDesc",
								"Choose which notifications you want to receive.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								form.handleSubmit();
							}}
							className="space-y-6"
						>
							{/* Email Notifications */}
							<form.Field name="enableEmail">
								{(field) => (
									<div className="flex flex-row items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label className="text-base">
												{t("onboarding.notifications.emailNotifications", "Email Notifications")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"onboarding.notifications.emailNotificationsDesc",
													"Receive important updates via email.",
												)}
											</p>
										</div>
										<Switch
											checked={field.state.value}
											onCheckedChange={field.handleChange}
											disabled={loading}
										/>
									</div>
								)}
							</form.Field>

							<div className="space-y-4">
								<h4 className="text-sm font-medium">
									{t("onboarding.notifications.notifyAbout", "Notify me about:")}
								</h4>

								{/* Approval Requests */}
								<form.Field name="notifyApprovals">
									{(field) => (
										<div className="flex flex-row items-center justify-between rounded-lg border p-3">
											<div className="space-y-0.5">
												<Label>
													{t("onboarding.notifications.approvals", "Approval requests")}
												</Label>
												<p className="text-xs text-muted-foreground">
													{t(
														"onboarding.notifications.approvalsDesc",
														"When someone needs your approval.",
													)}
												</p>
											</div>
											<Switch
												checked={field.state.value}
												onCheckedChange={field.handleChange}
												disabled={loading}
											/>
										</div>
									)}
								</form.Field>

								{/* Status Updates */}
								<form.Field name="notifyStatusUpdates">
									{(field) => (
										<div className="flex flex-row items-center justify-between rounded-lg border p-3">
											<div className="space-y-0.5">
												<Label>
													{t("onboarding.notifications.statusUpdates", "Status updates")}
												</Label>
												<p className="text-xs text-muted-foreground">
													{t(
														"onboarding.notifications.statusUpdatesDesc",
														"When your requests are approved or rejected.",
													)}
												</p>
											</div>
											<Switch
												checked={field.state.value}
												onCheckedChange={field.handleChange}
												disabled={loading}
											/>
										</div>
									)}
								</form.Field>

								{/* Team Changes */}
								<form.Field name="notifyTeamChanges">
									{(field) => (
										<div className="flex flex-row items-center justify-between rounded-lg border p-3">
											<div className="space-y-0.5">
												<Label>
													{t("onboarding.notifications.teamChanges", "Team changes")}
												</Label>
												<p className="text-xs text-muted-foreground">
													{t(
														"onboarding.notifications.teamChangesDesc",
														"When team members are added or removed.",
													)}
												</p>
											</div>
											<Switch
												checked={field.state.value}
												onCheckedChange={field.handleChange}
												disabled={loading}
											/>
										</div>
									)}
								</form.Field>
							</div>

							{/* Action Buttons */}
							<div className="flex gap-3 pt-4">
								<Button
									type="button"
									variant="outline"
									onClick={handleSkip}
									disabled={loading}
									className="flex-1"
								>
									{t("onboarding.notifications.skip", "Skip for now")}
								</Button>
								<Button type="submit" disabled={loading} className="flex-1">
									{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
									{t("onboarding.notifications.continue", "Continue")}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
