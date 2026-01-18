"use client";

import {
	IconBell,
	IconCalendar,
	IconCalendarEvent,
	IconCheck,
	IconClock,
	IconDeviceMobile,
	IconExclamationCircle,
	IconLoader2,
	IconMail,
	IconShield,
	IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import {
	NOTIFICATION_CHANNELS,
	type NotificationChannel,
	type NotificationType,
} from "@/lib/notifications/types";
import { PushPermissionModal } from "./push-permission-modal";

// Group notification types by category for better UX
const NOTIFICATION_CATEGORIES = [
	{
		id: "approvals",
		title: "Approvals",
		description: "Notifications about approval requests and their status",
		icon: IconCheck,
		types: [
			"approval_request_submitted",
			"approval_request_approved",
			"approval_request_rejected",
		] as NotificationType[],
	},
	{
		id: "time",
		title: "Time Corrections",
		description: "Notifications about time tracking corrections",
		icon: IconClock,
		types: [
			"time_correction_submitted",
			"time_correction_approved",
			"time_correction_rejected",
		] as NotificationType[],
	},
	{
		id: "absences",
		title: "Absences",
		description: "Notifications about absence requests",
		icon: IconCalendar,
		types: [
			"absence_request_submitted",
			"absence_request_approved",
			"absence_request_rejected",
		] as NotificationType[],
	},
	{
		id: "team",
		title: "Team",
		description: "Notifications about team membership changes",
		icon: IconUsers,
		types: ["team_member_added", "team_member_removed"] as NotificationType[],
	},
	{
		id: "security",
		title: "Security",
		description: "Important security notifications",
		icon: IconShield,
		types: ["password_changed", "two_factor_enabled", "two_factor_disabled"] as NotificationType[],
	},
	{
		id: "reminders",
		title: "Reminders",
		description: "Helpful reminders and alerts",
		icon: IconBell,
		types: ["birthday_reminder", "vacation_balance_alert"] as NotificationType[],
	},
	{
		id: "scheduling",
		title: "Shift Scheduling",
		description: "Notifications about shift assignments and swaps",
		icon: IconCalendarEvent,
		types: [
			"schedule_published",
			"shift_assigned",
			"shift_swap_requested",
			"shift_swap_approved",
			"shift_swap_rejected",
			"shift_pickup_available",
			"shift_pickup_approved",
		] as NotificationType[],
	},
];

// Human-readable labels for notification types
const TYPE_LABELS: Record<NotificationType, string> = {
	approval_request_submitted: "Request submitted",
	approval_request_approved: "Request approved",
	approval_request_rejected: "Request rejected",
	time_correction_submitted: "Correction submitted",
	time_correction_approved: "Correction approved",
	time_correction_rejected: "Correction rejected",
	absence_request_submitted: "Request submitted",
	absence_request_approved: "Request approved",
	absence_request_rejected: "Request rejected",
	team_member_added: "Member added",
	team_member_removed: "Member removed",
	password_changed: "Password changed",
	two_factor_enabled: "2FA enabled",
	two_factor_disabled: "2FA disabled",
	birthday_reminder: "Birthday reminders",
	vacation_balance_alert: "Balance alerts",
	// Shift scheduling notifications
	schedule_published: "Schedule published",
	shift_assigned: "Shift assigned",
	shift_swap_requested: "Swap requested",
	shift_swap_approved: "Swap approved",
	shift_swap_rejected: "Swap rejected",
	shift_pickup_available: "Open shift available",
	shift_pickup_approved: "Pickup approved",
	// Project notifications
	project_budget_warning_70: "Budget 70% used",
	project_budget_warning_90: "Budget 90% used",
	project_budget_warning_100: "Budget exceeded",
	project_deadline_warning_14d: "Deadline in 14 days",
	project_deadline_warning_7d: "Deadline in 7 days",
	project_deadline_warning_1d: "Deadline in 1 day",
	project_deadline_warning_0d: "Deadline today",
	project_deadline_overdue: "Project overdue",
	// Wellness notifications
	water_reminder: "Water reminders",
};

// Channel icons and labels
const CHANNEL_CONFIG: Record<
	NotificationChannel,
	{ icon: typeof IconBell; label: string; description: string }
> = {
	in_app: {
		icon: IconBell,
		label: "In-App",
		description: "Show in notification bell",
	},
	push: {
		icon: IconDeviceMobile,
		label: "Push",
		description: "Browser push notifications",
	},
	email: {
		icon: IconMail,
		label: "Email",
		description: "Send email notifications",
	},
};

export function NotificationSettings() {
	const { matrix, isLoading, updatePreference, isUpdating } = useNotificationPreferences();

	const {
		isSupported: isPushSupported,
		permission: pushPermission,
		isSubscribed: isPushSubscribed,
		subscribe: subscribeToPush,
		isLoading: isPushLoading,
	} = usePushNotifications({
		onSubscribe: () => {
			toast.success("Push notifications enabled", {
				description: "You will now receive browser push notifications",
			});
		},
		onError: (error) => {
			toast.error("Push notification error", {
				description: error.message,
			});
		},
	});

	const [pendingToggle, setPendingToggle] = useState<string | null>(null);
	const [showPermissionModal, setShowPermissionModal] = useState(false);

	const handleRequestPermission = async (): Promise<boolean> => {
		const success = await subscribeToPush();
		if (success) {
			setShowPermissionModal(false);
		}
		return success;
	};

	const _handleEnablePush = async () => {
		await subscribeToPush();
	};

	const handleToggle = async (
		type: NotificationType,
		channel: NotificationChannel,
		enabled: boolean,
	) => {
		const toggleId = `${type}-${channel}`;
		setPendingToggle(toggleId);

		// If enabling push and not subscribed, subscribe first
		if (channel === "push" && enabled && !isPushSubscribed && isPushSupported) {
			const subscribed = await subscribeToPush();
			if (!subscribed) {
				setPendingToggle(null);
				return;
			}
		}

		try {
			updatePreference(
				{ notificationType: type, channel, enabled },
				{
					onSuccess: () => {
						toast.success(enabled ? "Notification enabled" : "Notification disabled");
					},
					onError: () => {
						toast.error("Failed to update preference");
					},
					onSettled: () => {
						setPendingToggle(null);
					},
				},
			);
		} catch {
			setPendingToggle(null);
		}
	};

	if (isLoading) {
		return <NotificationSettingsSkeleton />;
	}

	if (!matrix) {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<p className="text-muted-foreground">Unable to load notification preferences</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			{/* Push notification setup card - show when supported but not subscribed */}
			{isPushSupported && !isPushSubscribed && pushPermission !== "denied" && (
				<Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
					<CardHeader className="pb-3">
						<div className="flex items-center gap-2">
							<IconDeviceMobile className="size-5 text-blue-600 dark:text-blue-400" />
							<CardTitle className="text-base">Enable Push Notifications</CardTitle>
						</div>
						<CardDescription>
							Get notified instantly even when you're not using the app
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button onClick={() => setShowPermissionModal(true)} disabled={isPushLoading} size="sm">
							{isPushLoading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							Enable Push Notifications
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Push blocked warning - show when permission is denied */}
			{isPushSupported && pushPermission === "denied" && (
				<Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
					<CardHeader className="pb-3">
						<div className="flex items-center gap-2">
							<IconExclamationCircle className="size-5 text-amber-600 dark:text-amber-400" />
							<CardTitle className="text-base">Push Notifications Blocked</CardTitle>
						</div>
						<CardDescription>
							Push notifications are blocked by your browser. To enable them, you need to update
							your browser settings.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-muted-foreground">
							Click the lock icon in your browser's address bar and allow notifications for this
							site, then refresh the page.
						</p>
					</CardContent>
				</Card>
			)}

			{/* Push enabled indicator */}
			{isPushSubscribed && (
				<div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50/50 p-3 dark:border-green-900 dark:bg-green-950/20">
					<IconDeviceMobile className="size-4 text-green-600 dark:text-green-400" />
					<span className="text-sm text-green-700 dark:text-green-300">
						Push notifications are enabled
					</span>
					<Badge variant="outline" className="ml-auto border-green-300 text-green-700">
						Active
					</Badge>
				</div>
			)}

			{/* Push permission modal */}
			<PushPermissionModal
				open={showPermissionModal}
				onOpenChange={setShowPermissionModal}
				onEnable={handleRequestPermission}
				onDismiss={() => setShowPermissionModal(false)}
				isLoading={isPushLoading}
			/>

			{/* Channel legend */}
			<div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
				{NOTIFICATION_CHANNELS.map((channel) => {
					const config = CHANNEL_CONFIG[channel];
					return (
						<div key={channel} className="flex items-center gap-1.5">
							<config.icon className="size-4" />
							<span>{config.label}</span>
						</div>
					);
				})}
			</div>

			{/* Notification categories */}
			{NOTIFICATION_CATEGORIES.map((category) => (
				<Card key={category.id}>
					<CardHeader className="pb-3">
						<div className="flex items-center gap-2">
							<category.icon className="size-5 text-muted-foreground" />
							<CardTitle className="text-base">{category.title}</CardTitle>
						</div>
						<CardDescription>{category.description}</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{category.types.map((type) => (
								<div
									key={type}
									className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
								>
									<span className="text-sm font-medium">{TYPE_LABELS[type]}</span>
									<div className="flex items-center gap-3">
										{NOTIFICATION_CHANNELS.map((channel) => {
											const isEnabled = matrix[type]?.[channel] ?? true;
											const toggleId = `${type}-${channel}`;
											const isPending = pendingToggle === toggleId;
											const config = CHANNEL_CONFIG[channel];

											// Disable push toggle if not subscribed
											const isDisabled =
												isPending ||
												isUpdating ||
												(channel === "push" && !isPushSubscribed && !isPushSupported);

											return (
												<div
													key={channel}
													className="flex items-center gap-1.5"
													title={config.description}
												>
													<config.icon className="size-3.5 text-muted-foreground" />
													<Switch
														checked={isEnabled}
														onCheckedChange={(checked) => handleToggle(type, channel, checked)}
														disabled={isDisabled}
														className="data-[state=checked]:bg-primary"
													/>
												</div>
											);
										})}
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function NotificationSettingsSkeleton() {
	return (
		<div className="space-y-6">
			{[1, 2, 3].map((i) => (
				<Card key={i}>
					<CardHeader className="pb-3">
						<Skeleton className="h-5 w-32" />
						<Skeleton className="h-4 w-48" />
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{[1, 2, 3].map((j) => (
								<div
									key={j}
									className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
								>
									<Skeleton className="h-4 w-24" />
									<div className="flex gap-3">
										<Skeleton className="h-5 w-10" />
										<Skeleton className="h-5 w-10" />
										<Skeleton className="h-5 w-10" />
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
