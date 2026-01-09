"use client";

import { IconBell } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useNotificationStream } from "@/hooks/use-notification-stream";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import { NotificationPopover } from "./notification-popover";

export function NotificationBell() {
	const { unreadCount } = useNotifications({ enabled: true });

	// Connect to SSE for real-time updates
	useNotificationStream({ enabled: true });

	return (
		<NotificationPopover>
			<Button
				size="icon"
				variant="ghost"
				className="relative size-9"
				aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
			>
				<IconBell className="size-5" />
				{unreadCount > 0 && (
					<span
						className={cn(
							"absolute -right-0.5 -top-0.5 flex items-center justify-center",
							"min-w-[18px] h-[18px] rounded-full",
							"bg-destructive text-destructive-foreground",
							"text-[10px] font-medium leading-none",
							"px-1",
						)}
					>
						{unreadCount > 99 ? "99+" : unreadCount}
					</span>
				)}
			</Button>
		</NotificationPopover>
	);
}
