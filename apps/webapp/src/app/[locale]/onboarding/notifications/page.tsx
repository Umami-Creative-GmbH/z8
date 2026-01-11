"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconBell, IconLoader2, IconMail } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import {
	type OnboardingNotificationsFormValues,
	onboardingNotificationsSchema,
} from "@/lib/validations/onboarding";
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

	const form = useForm<OnboardingNotificationsFormValues>({
		resolver: zodResolver(onboardingNotificationsSchema),
		defaultValues: {
			enablePush: false,
			enableEmail: true,
			notifyApprovals: true,
			notifyStatusUpdates: true,
			notifyTeamChanges: true,
		},
	});

	const _enablePush = form.watch("enablePush");

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
			form.setValue("enablePush", true);
			toast.success(t("onboarding.notifications.pushEnabled", "Push notifications enabled!"));
		} else {
			toast.error(t("onboarding.notifications.pushDenied", "Push notification permission denied"));
		}
	}

	async function onSubmit(values: OnboardingNotificationsFormValues) {
		setLoading(true);

		const result = await configureNotificationsOnboarding(values);

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
						<Form {...form}>
							<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
								{/* Email Notifications */}
								<FormField
									control={form.control}
									name="enableEmail"
									render={({ field }) => (
										<FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
											<div className="space-y-0.5">
												<FormLabel className="text-base">
													{t("onboarding.notifications.emailNotifications", "Email Notifications")}
												</FormLabel>
												<FormDescription>
													{t(
														"onboarding.notifications.emailNotificationsDesc",
														"Receive important updates via email.",
													)}
												</FormDescription>
											</div>
											<FormControl>
												<Switch
													checked={field.value}
													onCheckedChange={field.onChange}
													disabled={loading}
												/>
											</FormControl>
										</FormItem>
									)}
								/>

								<div className="space-y-4">
									<h4 className="text-sm font-medium">
										{t("onboarding.notifications.notifyAbout", "Notify me about:")}
									</h4>

									{/* Approval Requests */}
									<FormField
										control={form.control}
										name="notifyApprovals"
										render={({ field }) => (
											<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
												<div className="space-y-0.5">
													<FormLabel>
														{t("onboarding.notifications.approvals", "Approval requests")}
													</FormLabel>
													<FormDescription className="text-xs">
														{t(
															"onboarding.notifications.approvalsDesc",
															"When someone needs your approval.",
														)}
													</FormDescription>
												</div>
												<FormControl>
													<Switch
														checked={field.value}
														onCheckedChange={field.onChange}
														disabled={loading}
													/>
												</FormControl>
											</FormItem>
										)}
									/>

									{/* Status Updates */}
									<FormField
										control={form.control}
										name="notifyStatusUpdates"
										render={({ field }) => (
											<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
												<div className="space-y-0.5">
													<FormLabel>
														{t("onboarding.notifications.statusUpdates", "Status updates")}
													</FormLabel>
													<FormDescription className="text-xs">
														{t(
															"onboarding.notifications.statusUpdatesDesc",
															"When your requests are approved or rejected.",
														)}
													</FormDescription>
												</div>
												<FormControl>
													<Switch
														checked={field.value}
														onCheckedChange={field.onChange}
														disabled={loading}
													/>
												</FormControl>
											</FormItem>
										)}
									/>

									{/* Team Changes */}
									<FormField
										control={form.control}
										name="notifyTeamChanges"
										render={({ field }) => (
											<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
												<div className="space-y-0.5">
													<FormLabel>
														{t("onboarding.notifications.teamChanges", "Team changes")}
													</FormLabel>
													<FormDescription className="text-xs">
														{t(
															"onboarding.notifications.teamChangesDesc",
															"When team members are added or removed.",
														)}
													</FormDescription>
												</div>
												<FormControl>
													<Switch
														checked={field.value}
														onCheckedChange={field.onChange}
														disabled={loading}
													/>
												</FormControl>
											</FormItem>
										)}
									/>
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
						</Form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
