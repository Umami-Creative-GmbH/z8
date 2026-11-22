"use client";

import { IconBell, IconLoader2, IconMail } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useRef, useState } from "react";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useSession } from "@/lib/auth-client";
import { getNextOnboardingStepPath, ONBOARDING_STEPS } from "@/lib/validations/onboarding-steps";
import { Link, useRouter } from "@/navigation";
import { configureNotificationsOnboarding, skipNotificationsSetup } from "./actions";

const defaultValues = {
	enablePush: false,
	enableEmail: true,
	notifyApprovals: true,
	notifyStatusUpdates: true,
	notifyTeamChanges: true,
};
const NOTIFICATIONS_NEXT_STEP_PATH =
	getNextOnboardingStepPath("notifications", false) ?? ONBOARDING_STEPS.complete.path;
type Pending = "save" | "skip" | "push" | null;

function PreferenceToggle({
	id,
	label,
	description,
	value,
	onChange,
	disabled,
}: {
	id: string;
	label: string;
	description: string;
	value: boolean;
	onChange: (value: boolean) => void;
	disabled: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-4 border-b py-4 last:border-0">
			<div className="min-w-0 space-y-1">
				<Label htmlFor={id} className="text-sm leading-snug">
					{label}
				</Label>
				<p id={`${id}-description`} className="text-sm text-muted-foreground">
					{description}
				</p>
			</div>
			<Switch
				id={id}
				checked={value}
				onCheckedChange={onChange}
				disabled={disabled}
				aria-describedby={`${id}-description`}
			/>
		</div>
	);
}

export default function NotificationsPage() {
	const { t } = useTranslate();
	const { data: session, isPending } = useSession();
	if (isPending)
		return (
			<div className="mx-auto max-w-2xl space-y-6">
				<PageHeader
					className="onboarding-heading-panel rounded-xl border bg-card p-6 sm:p-8"
					title={t("onboarding.notifications.title", "Set up notifications")}
				/>
				<LoadingRegion
					role="status"
					label={{
						labelKey: "onboarding.notifications.loading",
						labelDefault: "Loading your notification setup",
					}}
				/>
			</div>
		);
	if (!session?.user.id)
		return (
			<Card className="mx-auto max-w-2xl">
				<CardContent className="space-y-4 pt-6">
					<h1 className="text-2xl font-semibold">
						{t("onboarding.notifications.title", "Set up notifications")}
					</h1>
					<p role="alert">
						{t(
							"onboarding.notifications.sessionUnavailable",
							"Your session is unavailable. Sign in to continue notification setup.",
						)}
					</p>
					<Button asChild>
						<Link href="/sign-in">{t("common.signIn", "Sign in")}</Link>
					</Button>
				</CardContent>
			</Card>
		);
	return (
		<NotificationSetup
			key={session.user.id}
			organizationId={session.session.activeOrganizationId ?? null}
		/>
	);
}

function useNotificationActions(organizationId: string | null) {
	const [pending, setPending] = useState<Pending>(null);
	const [error, setError] = useState<string | null>(null);
	const [pushFeedback, setPushFeedback] = useState<{ error: boolean; message: string } | null>(
		null,
	);
	const arrival = useRef<symbol | null>(null);
	const running = useRef<symbol | null>(null);
	// Every connected arrival owns its completions, including cached Activity returns.
	// Preferences belong to the user; an organization change invalidates work, not their draft.
	// react-doctor-disable-next-line react-doctor/no-reset-all-state-on-prop-change -- Only transient action state resets; TanStack preference drafts survive organization changes and Activity reconnects.
	useLayoutEffect(() => {
		arrival.current = Symbol(organizationId ?? "notification setup arrival");
		running.current = null;
		// react-doctor-disable-next-line react-hooks-js/set-state-in-effect -- A reconnected Activity must render usable controls after invalidating the prior arrival.
		setPending(null);
		setError(null);
		setPushFeedback(null);
		return () => {
			arrival.current = null;
		};
	}, [organizationId]);

	function begin(kind: Exclude<Pending, null>) {
		if (running.current || !arrival.current) return null;
		const owner = arrival.current;
		running.current = owner;
		setPending(kind);
		return owner;
	}
	function isCurrent(owner: symbol) {
		return arrival.current === owner;
	}
	function finish(owner: symbol) {
		if (isCurrent(owner)) {
			running.current = null;
			setPending(null);
		}
	}
	return {
		isCurrent,
		finish,
		pending,
		error,
		setError,
		pushFeedback,
		setPushFeedback,
		begin,
	};
}

function browserPermissionLabel(
	browser: ReturnType<typeof usePushNotifications>,
	t: ReturnType<typeof useTranslate>["t"],
) {
	if (browser.isLoading)
		return t("onboarding.notifications.checkingBrowser", "Checking push availability…");
	if (!browser.isSupported)
		return t(
			"onboarding.notifications.pushNotSupported",
			"Push notifications are not supported in this browser",
		);
	if (browser.permission === "denied")
		return t("onboarding.notifications.permissionBlocked", "Permission blocked");
	if (browser.permission === "granted")
		return t("onboarding.notifications.permissionAllowed", "Permission allowed");
	return t("onboarding.notifications.permissionNotRequested", "Permission not granted");
}

function BrowserPermissionCard({
	browser,
	pending,
	pushFeedback,
	onRequest,
}: {
	browser: ReturnType<typeof usePushNotifications>;
	pending: Pending;
	pushFeedback: { error: boolean; message: string } | null;
	onRequest: () => Promise<void>;
}) {
	const { t } = useTranslate();
	const busy = pending !== null;
	return (
		<Card>
			<CardHeader>
				<h2 className="flex items-center gap-2 text-lg font-semibold">
					<IconBell aria-hidden="true" className="size-5 text-primary" />
					{t("onboarding.notifications.browserTitle", "Browser push permission")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t(
						"onboarding.notifications.browserDesc",
						"Permission applies to this browser. Notification preferences and device enrollment are separate.",
					)}
				</p>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-sm font-medium" role="status">
					{browserPermissionLabel(browser, t)}
				</p>
				{browser.permission === "denied" && browser.isSupported && (
					<p className="text-sm text-muted-foreground">
						{t(
							"onboarding.notifications.blockedHelp",
							"Allow notifications in this site's browser settings to change this permission. You can still save your preferences or skip.",
						)}
					</p>
				)}
				{browser.isSupported && !browser.isLoading && (
					<Button
						type="button"
						variant="outline"
						onClick={() => void onRequest()}
						disabled={busy || browser.permission === "denied" || browser.permission === "granted"}
					>
						{pending === "push" && (
							<IconLoader2
								aria-hidden="true"
								className="size-4 animate-spin motion-reduce:animate-none"
							/>
						)}
						{browser.permission === "granted"
							? t("onboarding.notifications.permissionAllowed", "Permission allowed")
							: t("onboarding.notifications.requestPermission", "Request permission")}
					</Button>
				)}
				{browser.error && (
					<p role="alert" className="text-sm text-destructive">
						{t(
							"onboarding.notifications.availabilityError",
							"Push availability could not be checked. You can still save your preferences and try browser setup later.",
						)}
					</p>
				)}
				{pending === "push" && (
					<p role="status" className="text-sm">
						{t("onboarding.notifications.requestingPermission", "Waiting for browser permission…")}
					</p>
				)}
				{pushFeedback && (
					<p
						role={pushFeedback.error ? "alert" : "status"}
						className={
							pushFeedback.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
						}
					>
						{pushFeedback.message}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function NotificationSetup({ organizationId }: { organizationId: string | null }) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const browser = usePushNotifications();
	const { pending, error, setError, pushFeedback, setPushFeedback, isCurrent, finish, begin } =
		useNotificationActions(organizationId);

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			await saveOrSkip("save", () => configureNotificationsOnboarding(value));
		},
	});

	async function saveOrSkip(kind: "save" | "skip", action: typeof skipNotificationsSetup) {
		const owner = begin(kind);
		if (!owner) return;
		setError(null);
		const fallback =
			kind === "save"
				? t("onboarding.notifications.error", "Failed to save notification preferences")
				: t("onboarding.notifications.skipError", "Failed to skip notification setup");
		try {
			const result = await action();
			if (!isCurrent(owner)) return;
			if (result.success) {
				push(NOTIFICATIONS_NEXT_STEP_PATH);
				return;
			}
			setError(result.error || fallback);
		} catch {
			if (!isCurrent(owner)) return;
			setError(fallback);
		}
		finish(owner);
	}
	async function requestPush() {
		if (
			!browser.isSupported ||
			browser.isLoading ||
			browser.permission === "denied" ||
			browser.permission === "granted"
		)
			return;
		const owner = begin("push");
		if (!owner) return;
		setPushFeedback(null);
		try {
			const permission = await browser.requestPermission();
			if (!isCurrent(owner)) return;
			if (permission === "granted") {
				form.setFieldValue("enablePush", true);
				setPushFeedback({
					error: false,
					message: t(
						"onboarding.notifications.permissionAllowedFeedback",
						"Browser permission allowed. Save your preferences to continue. Permission alone does not enroll this device for delivery.",
					),
				});
			} else if (permission === "denied") {
				setPushFeedback({
					error: true,
					message: t(
						"onboarding.notifications.permissionDeniedFeedback",
						"Permission was not allowed. Check this site's notification permission in browser settings. Your preferences are unchanged.",
					),
				});
			} else {
				setPushFeedback({
					error: false,
					message: t(
						"onboarding.notifications.permissionDefaultFeedback",
						"No permission was granted. You can request again or continue with your preferences.",
					),
				});
			}
		} catch {
			if (!isCurrent(owner)) return;
			setPushFeedback({
				error: true,
				message: t(
					"onboarding.notifications.permissionError",
					"Could not request browser permission. Your preferences are unchanged. Try again.",
				),
			});
		}
		finish(owner);
	}
	const busy = pending !== null;
	return (
		<>
			<div className="mx-auto mb-6 max-w-2xl rounded-xl border bg-card px-4 pt-6 [&>div]:mb-6">
				<ProgressIndicator currentStep="notifications" />
			</div>
			<div className="mx-auto max-w-2xl space-y-6 [&_[data-slot=card]]:!border-border [&_[data-slot=card]]:!bg-card [&_[data-slot=card-header]]:!border-border [&_[data-slot=card-header]]:!bg-card">
				<PageHeader
					className="onboarding-heading-panel rounded-xl border bg-card p-6 sm:p-8"
					title={t("onboarding.notifications.title", "Set up notifications")}
					description={t(
						"onboarding.notifications.subtitle",
						"Choose how you want to receive updates about approvals, status changes, and team activities.",
					)}
				/>
				<BrowserPermissionCard
					browser={browser}
					pending={pending}
					pushFeedback={pushFeedback}
					onRequest={requestPush}
				/>
				<Card>
					<CardHeader>
						<h2 className="flex items-center gap-2 text-lg font-semibold">
							<IconMail aria-hidden="true" className="size-5 text-primary" />
							{t("onboarding.notifications.preferencesTitle", "Notification Preferences")}
						</h2>
						<p className="text-sm text-muted-foreground">
							{t(
								"onboarding.notifications.preferenceScope",
								"These choices apply to your account. Saving or skipping does not change browser permission or organization access.",
							)}
						</p>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void form.handleSubmit();
							}}
							className="space-y-5"
							aria-busy={busy}
						>
							<fieldset disabled={busy}>
								<legend className="text-sm font-semibold">
									{t("onboarding.notifications.channels", "Notification channels")}
								</legend>
								<form.Field name="enablePush">
									{(field) => (
										<PreferenceToggle
											id="notification-enable-push"
											label={t("onboarding.notifications.pushPreference", "Push notifications")}
											description={t(
												"onboarding.notifications.pushPreferenceDesc",
												"Choose push updates for your account. Delivery also requires permission and a registered device.",
											)}
											value={field.state.value}
											onChange={field.handleChange}
											disabled={busy}
										/>
									)}
								</form.Field>
								<form.Field name="enableEmail">
									{(field) => (
										<PreferenceToggle
											id="notification-enable-email"
											label={t(
												"onboarding.notifications.emailNotifications",
												"Email Notifications",
											)}
											description={t(
												"onboarding.notifications.emailNotificationsDesc",
												"Receive important updates via email.",
											)}
											value={field.state.value}
											onChange={field.handleChange}
											disabled={busy}
										/>
									)}
								</form.Field>
							</fieldset>
							<fieldset disabled={busy}>
								<legend className="text-sm font-semibold">
									{t("onboarding.notifications.notifyAbout", "Notify me about:")}
								</legend>
								<form.Field name="notifyApprovals">
									{(field) => (
										<PreferenceToggle
											id="notification-approvals"
											label={t("onboarding.notifications.approvals", "Approval requests")}
											description={t(
												"onboarding.notifications.approvalsDesc",
												"When someone needs your approval.",
											)}
											value={field.state.value}
											onChange={field.handleChange}
											disabled={busy}
										/>
									)}
								</form.Field>
								<form.Field name="notifyStatusUpdates">
									{(field) => (
										<PreferenceToggle
											id="notification-status-updates"
											label={t("onboarding.notifications.statusUpdates", "Status updates")}
											description={t(
												"onboarding.notifications.statusUpdatesDesc",
												"When your requests are approved or rejected.",
											)}
											value={field.state.value}
											onChange={field.handleChange}
											disabled={busy}
										/>
									)}
								</form.Field>
								<form.Field name="notifyTeamChanges">
									{(field) => (
										<PreferenceToggle
											id="notification-team-changes"
											label={t("onboarding.notifications.teamChanges", "Team changes")}
											description={t(
												"onboarding.notifications.teamChangesDesc",
												"When team members are added or removed.",
											)}
											value={field.state.value}
											onChange={field.handleChange}
											disabled={busy}
										/>
									)}
								</form.Field>
							</fieldset>
							{error && (
								<p role="alert" className="text-sm text-destructive">
									{error}
								</p>
							)}
							{pending && pending !== "push" && (
								<p role="status" className="text-sm">
									{pending === "save"
										? t("onboarding.notifications.saving", "Saving notification preferences…")
										: t("onboarding.notifications.skipping", "Skipping notification setup…")}
								</p>
							)}
							<div className="flex flex-col gap-3 border-t pt-5 sm:flex-row-reverse">
								<Button type="submit" disabled={busy} className="h-auto min-h-11 whitespace-normal">
									{pending === "save" && (
										<IconLoader2
											aria-hidden="true"
											className="size-4 animate-spin motion-reduce:animate-none"
										/>
									)}
									{t("onboarding.notifications.saveContinue", "Save preferences and continue")}
								</Button>
								<Button
									type="button"
									variant="outline"
									disabled={busy}
									onClick={() => void saveOrSkip("skip", skipNotificationsSetup)}
									className="h-auto min-h-11 whitespace-normal"
								>
									{t("onboarding.notifications.skip", "Skip for now")}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
