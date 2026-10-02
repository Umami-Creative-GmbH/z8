"use client";

import { IconBell } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { useOrganization } from "@/hooks/use-organization";
import { cn } from "@/lib/utils";
import { NotificationPopover } from "./notification-popover";

export function NotificationBell() {
	const { t } = useTranslate();
	const { organizationId } = useOrganization();
	const hasOrganization = Boolean(organizationId);

	const { unreadCount } = useNotifications({
		enabled: hasOrganization,
		organizationId,
	});

	return (
		<NotificationPopover>
			<Button
				size="icon"
				variant="ghost"
				className="relative size-9"
				aria-label={t(
					"common.notifications.bellLabel",
					"{count, plural, =0 {Notifications} other {Notifications (# unread)}}",
					{ count: unreadCount },
				)}
			>
				<IconBell className="size-5" />
				{unreadCount > 0 && (
					<span
						className={cn(
							"absolute -right-0.5 -top-0.5 flex items-center justify-center",
							"min-w-[18px] h-[18px] rounded-full",
							"bg-destructive text-white",
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
