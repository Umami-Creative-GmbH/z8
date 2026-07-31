"use client";

import { IconBell, IconLoader2, IconMail } from "@tabler/icons-react";
import {
	type FormAsyncValidateOrFn,
	type FormValidateOrFn,
	type ReactFormExtendedApi,
	useForm,
} from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useRouter } from "@/navigation";
import { runOnboardingAction } from "../run-onboarding-action";
import {
	configureNotificationsOnboarding,
	skipNotificationsSetup,
} from "./actions";

const defaultValues = {
	enablePush: false,
	enableEmail: true,
	notifyApprovals: true,
	notifyStatusUpdates: true,
	notifyTeamChanges: true,
};

type NotificationsValues = typeof defaultValues;
type NotificationsForm = ReactFormExtendedApi<
	NotificationsValues,
	FormValidateOrFn<NotificationsValues> | undefined,
	FormValidateOrFn<NotificationsValues> | undefined,
	FormAsyncValidateOrFn<NotificationsValues> | undefined,
	FormValidateOrFn<NotificationsValues> | undefined,
	FormAsyncValidateOrFn<NotificationsValues> | undefined,
	FormValidateOrFn<NotificationsValues> | undefined,
	FormAsyncValidateOrFn<NotificationsValues> | undefined,
	FormValidateOrFn<NotificationsValues> | undefined,
	FormAsyncValidateOrFn<NotificationsValues> | undefined,
	FormAsyncValidateOrFn<NotificationsValues> | undefined,
	unknown
>;
type TranslationFunction = ReturnType<typeof useTranslate>["t"];

function NotificationsHeader({ t }: { t: TranslationFunction }) {
	return (
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
	);
}

function PushNotificationsCard({
	status,
	onEnable,
	t,
}: {
	status: {
		isSupported: boolean;
		loading: boolean;
		permission: ReturnType<typeof usePushNotifications>["permission"];
		pushLoading: boolean;
	};
	onEnable: () => void;
	t: TranslationFunction;
}) {
	return (
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
				{status.isSupported ? (
					<div className="flex items-center justify-between">
						<div className="space-y-1">
							<p className="text-sm font-medium">
								{status.permission === "granted"
									? t(
											"onboarding.notifications.pushGranted",
											"Push notifications enabled",
										)
									: t(
											"onboarding.notifications.pushPrompt",
											"Enable push notifications",
										)}
							</p>
							<p className="text-sm text-muted-foreground">
								{status.permission === "granted"
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
						{status.permission !== "granted" ? (
							<Button
								variant="outline"
								onClick={onEnable}
								disabled={status.pushLoading || status.loading}
							>
								{status.pushLoading && (
									<IconLoader2 className="mr-2 size-4 animate-spin" />
								)}
								{t("onboarding.notifications.enable", "Enable")}
							</Button>
						) : (
							<div className="flex items-center gap-2 text-green-600">
								<IconBell className="size-5" />
								<span className="text-sm font-medium">
									{t("common.enabled", "Enabled")}
								</span>
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
	);
}

function PreferenceToggle({
	field,
	id,
	label,
	description,
	loading,
	compact = false,
}: {
	field: {
		state: { value: boolean };
		handleChange: (value: boolean) => void;
	};
	id: string;
	label: string;
	description: string;
	loading: boolean;
	compact?: boolean;
}) {
	return (
		<div
			className={`flex flex-row items-center justify-between rounded-lg border ${compact ? "p-3" : "p-4"}`}
		>
			<div className="space-y-0.5">
				<Label htmlFor={id} className={compact ? undefined : "text-base"}>
					{label}
				</Label>
				<p
					className={`${compact ? "text-xs" : "text-sm"} text-muted-foreground`}
				>
					{description}
				</p>
			</div>
			<Switch
				id={id}
				checked={field.state.value}
				onCheckedChange={field.handleChange}
				disabled={loading}
			/>
		</div>
	);
}

function NotificationPreferencesForm({
	form,
	status,
	onSkip,
	t,
}: {
	form: NotificationsForm;
	status: { loading: boolean };
	onSkip: () => void;
	t: TranslationFunction;
}) {
	return (
		<form
			action={() => {
				void form.handleSubmit();
			}}
			className="space-y-6"
		>
			<form.Field name="enableEmail">
				{(field) => (
					<PreferenceToggle
						field={field}
						id="notification-enable-email"
						label={t(
							"onboarding.notifications.emailNotifications",
							"Email Notifications",
						)}
						description={t(
							"onboarding.notifications.emailNotificationsDesc",
							"Receive important updates via email.",
						)}
						loading={status.loading}
					/>
				)}
			</form.Field>
			<div className="space-y-4">
				<h4 className="text-sm font-medium">
					{t("onboarding.notifications.notifyAbout", "Notify me about:")}
				</h4>
				<form.Field name="notifyApprovals">
					{(field) => (
						<PreferenceToggle
							field={field}
							id="notification-approvals"
							label={t(
								"onboarding.notifications.approvals",
								"Approval requests",
							)}
							description={t(
								"onboarding.notifications.approvalsDesc",
								"When someone needs your approval.",
							)}
							loading={status.loading}
							compact
						/>
					)}
				</form.Field>
				<form.Field name="notifyStatusUpdates">
					{(field) => (
						<PreferenceToggle
							field={field}
							id="notification-status-updates"
							label={t(
								"onboarding.notifications.statusUpdates",
								"Status updates",
							)}
							description={t(
								"onboarding.notifications.statusUpdatesDesc",
								"When your requests are approved or rejected.",
							)}
							loading={status.loading}
							compact
						/>
					)}
				</form.Field>
				<form.Field name="notifyTeamChanges">
					{(field) => (
						<PreferenceToggle
							field={field}
							id="notification-team-changes"
							label={t("onboarding.notifications.teamChanges", "Team changes")}
							description={t(
								"onboarding.notifications.teamChangesDesc",
								"When team members are added or removed.",
							)}
							loading={status.loading}
							compact
						/>
					)}
				</form.Field>
			</div>
			<div className="flex gap-3 pt-4">
				<Button
					type="button"
					variant="outline"
					onClick={onSkip}
					disabled={status.loading}
					className="flex-1"
				>
					{t("onboarding.notifications.skip", "Skip for now")}
				</Button>
				<Button type="submit" disabled={status.loading} className="flex-1">
					{status.loading && (
						<IconLoader2 className="mr-2 size-4 animate-spin" />
					)}
					{t("onboarding.notifications.continue", "Continue")}
				</Button>
			</div>
		</form>
	);
}

export default function NotificationsPage() {
	const { t } = useTranslate();
	const { push } = useRouter();
	const [loading, setLoading] = useState(false);
	const {
		requestPermission,
		isSupported,
		permission,
		isLoading: pushLoading,
	} = usePushNotifications();

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			await runOnboardingAction({
				action: () => configureNotificationsOnboarding(value),
				onResult: (result) => {
					if (result.success) {
						toast.success(
							t(
								"onboarding.notifications.success",
								"Notification preferences saved!",
							),
						);
						push("/onboarding/complete");
						return true;
					} else {
						toast.error(
							result.error ||
								t(
									"onboarding.notifications.error",
									"Failed to save notification preferences",
								),
						);
					}
				},
				onRejected: () => {
					toast.error(
						t(
							"onboarding.notifications.error",
							"Failed to save notification preferences",
						),
					);
				},
				setLoading,
			});
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
			toast.success(
				t(
					"onboarding.notifications.pushEnabled",
					"Push notifications enabled!",
				),
			);
		} else {
			toast.error(
				t(
					"onboarding.notifications.pushDenied",
					"Push notification permission denied",
				),
			);
		}
	}

	async function handleSkip() {
		await runOnboardingAction({
			action: skipNotificationsSetup,
			onResult: (result) => {
				if (result.success) {
					push("/onboarding/complete");
					return true;
				} else {
					toast.error(
						result.error ||
							t(
								"onboarding.notifications.skipError",
								"Failed to skip notification setup",
							),
					);
				}
			},
			onRejected: () => {
				toast.error(
					t(
						"onboarding.notifications.skipError",
						"Failed to skip notification setup",
					),
				);
			},
			setLoading,
		});
	}

	return (
		<>
			<ProgressIndicator currentStep="notifications" />

			<div className="mx-auto max-w-2xl">
				<NotificationsHeader t={t} />
				<PushNotificationsCard
					status={{ isSupported, loading, permission, pushLoading }}
					onEnable={handleEnablePush}
					t={t}
				/>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconMail className="size-5" />
							{t(
								"onboarding.notifications.preferencesTitle",
								"Notification Preferences",
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"onboarding.notifications.preferencesDesc",
								"Choose which notifications you want to receive.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<NotificationPreferencesForm
							form={form}
							status={{ loading }}
							onSkip={handleSkip}
							t={t}
						/>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
