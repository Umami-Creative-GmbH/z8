"use client";

import {
	IconBeach,
	IconCake,
	IconCalendarEvent,
	IconCheck,
	IconCircleFilled,
	IconClock,
	IconShield,
	IconUsers,
	IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { NotificationType, NotificationWithMeta } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";

interface NotificationItemProps {
	notification: NotificationWithMeta;
	onMarkAsRead?: (id: string) => void;
	onDelete?: (id: string) => void;
	onClose?: () => void;
}

/**
 * Get icon and color based on notification type
 */
function getNotificationStyle(type: NotificationType): {
	icon: React.ReactNode;
	bgColor: string;
	iconColor: string;
} {
	switch (type) {
		// Approval notifications
		case "approval_request_submitted":
			return {
				icon: <IconClock className="size-4" />,
				bgColor: "bg-amber-100 dark:bg-amber-900/30",
				iconColor: "text-amber-600 dark:text-amber-400",
			};
		case "approval_request_approved":
			return {
				icon: <IconCheck className="size-4" />,
				bgColor: "bg-green-100 dark:bg-green-900/30",
				iconColor: "text-green-600 dark:text-green-400",
			};
		case "approval_request_rejected":
			return {
				icon: <IconX className="size-4" />,
				bgColor: "bg-red-100 dark:bg-red-900/30",
				iconColor: "text-red-600 dark:text-red-400",
			};

		// Time correction notifications
		case "time_correction_submitted":
			return {
				icon: <IconClock className="size-4" />,
				bgColor: "bg-blue-100 dark:bg-blue-900/30",
				iconColor: "text-blue-600 dark:text-blue-400",
			};
		case "time_correction_approved":
			return {
				icon: <IconCheck className="size-4" />,
				bgColor: "bg-green-100 dark:bg-green-900/30",
				iconColor: "text-green-600 dark:text-green-400",
			};
		case "time_correction_rejected":
			return {
				icon: <IconX className="size-4" />,
				bgColor: "bg-red-100 dark:bg-red-900/30",
				iconColor: "text-red-600 dark:text-red-400",
			};

		// Absence notifications
		case "absence_request_submitted":
			return {
				icon: <IconCalendarEvent className="size-4" />,
				bgColor: "bg-purple-100 dark:bg-purple-900/30",
				iconColor: "text-purple-600 dark:text-purple-400",
			};
		case "absence_request_approved":
			return {
				icon: <IconCheck className="size-4" />,
				bgColor: "bg-green-100 dark:bg-green-900/30",
				iconColor: "text-green-600 dark:text-green-400",
			};
		case "absence_request_rejected":
			return {
				icon: <IconX className="size-4" />,
				bgColor: "bg-red-100 dark:bg-red-900/30",
				iconColor: "text-red-600 dark:text-red-400",
			};

		// Team notifications
		case "team_member_added":
		case "team_member_removed":
			return {
				icon: <IconUsers className="size-4" />,
				bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
				iconColor: "text-indigo-600 dark:text-indigo-400",
			};

		// Security notifications
		case "password_changed":
		case "two_factor_enabled":
		case "two_factor_disabled":
			return {
				icon: <IconShield className="size-4" />,
				bgColor: "bg-slate-100 dark:bg-slate-900/30",
				iconColor: "text-slate-600 dark:text-slate-400",
			};

		// Reminder notifications
		case "birthday_reminder":
			return {
				icon: <IconCake className="size-4" />,
				bgColor: "bg-pink-100 dark:bg-pink-900/30",
				iconColor: "text-pink-600 dark:text-pink-400",
			};
		case "vacation_balance_alert":
			return {
				icon: <IconBeach className="size-4" />,
				bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
				iconColor: "text-cyan-600 dark:text-cyan-400",
			};

		default:
			return {
				icon: <IconCircleFilled className="size-4" />,
				bgColor: "bg-gray-100 dark:bg-gray-900/30",
				iconColor: "text-gray-600 dark:text-gray-400",
			};
	}
}

export function NotificationItem({
	notification,
	onMarkAsRead,
	onDelete,
	onClose,
}: NotificationItemProps) {
	const router = useRouter();
	const { icon, bgColor, iconColor } = getNotificationStyle(notification.type);

	const handleClick = () => {
		// Mark as read if not already
		if (!notification.isRead) {
			onMarkAsRead?.(notification.id);
		}

		// Navigate to action URL if provided
		if (notification.actionUrl) {
			onClose?.();
			router.push(notification.actionUrl);
		}
	};

	const handleMarkAsRead = (e: React.MouseEvent) => {
		e.stopPropagation();
		onMarkAsRead?.(notification.id);
	};

	const handleDelete = (e: React.MouseEvent) => {
		e.stopPropagation();
		onDelete?.(notification.id);
	};

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={handleClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleClick();
				}
			}}
			className={cn(
				"group flex items-start gap-3 p-3 transition-colors cursor-pointer",
				"hover:bg-muted/50",
				!notification.isRead && "bg-muted/30",
			)}
		>
			{/* Icon */}
			<div className={cn("flex shrink-0 items-center justify-center rounded-full p-2", bgColor)}>
				<span className={iconColor}>{icon}</span>
			</div>

			{/* Content */}
			<div className="min-w-0 flex-1">
				<div className="flex items-start justify-between gap-2">
					<p className={cn("text-sm line-clamp-1", !notification.isRead && "font-medium")}>
						{notification.title}
					</p>
					{!notification.isRead && (
						<span className="shrink-0 mt-1.5">
							<IconCircleFilled className="size-2 text-primary" />
						</span>
					)}
				</div>
				<p className="text-muted-foreground text-xs line-clamp-2 mt-0.5">{notification.message}</p>
				<p className="text-muted-foreground text-xs mt-1">{notification.timeAgo}</p>
			</div>

			{/* Actions (visible on hover) */}
			<div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
				{!notification.isRead && (
					<Button
						size="icon"
						variant="ghost"
						className="size-7"
						onClick={handleMarkAsRead}
						title="Mark as read"
					>
						<IconCheck className="size-3.5" />
					</Button>
				)}
				<Button
					size="icon"
					variant="ghost"
					className="size-7 text-muted-foreground hover:text-destructive"
					onClick={handleDelete}
					title="Delete"
				>
					<IconX className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}
