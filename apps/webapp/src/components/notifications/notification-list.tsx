"use client";

import { IconBellOff } from "@tabler/icons-react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { NotificationWithMeta } from "@/lib/notifications/types";
import { NotificationItem } from "./notification-item";

interface NotificationListProps {
	notifications: NotificationWithMeta[];
	isLoading?: boolean;
	onMarkAsRead?: (id: string) => void;
	onDelete?: (id: string) => void;
	onClose?: () => void;
}

function NotificationSkeleton() {
	return (
		<div className="flex items-start gap-3 p-3">
			<Skeleton className="size-9 rounded-full" />
			<div className="flex-1 space-y-2">
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-3 w-full" />
				<Skeleton className="h-3 w-1/4" />
			</div>
		</div>
	);
}

export function NotificationList({
	notifications,
	isLoading,
	onMarkAsRead,
	onDelete,
	onClose,
}: NotificationListProps) {
	if (isLoading) {
		return (
			<div className="divide-y">
				<NotificationSkeleton />
				<NotificationSkeleton />
				<NotificationSkeleton />
			</div>
		);
	}

	if (notifications.length === 0) {
		return (
			<Empty className="py-8 border-0">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<IconBellOff className="size-5" />
					</EmptyMedia>
					<EmptyTitle className="text-base">No notifications</EmptyTitle>
					<EmptyDescription>
						You&apos;re all caught up! New notifications will appear here.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<ScrollArea className="h-[400px]">
			<div className="divide-y">
				{notifications.map((notification) => (
					<NotificationItem
						key={notification.id}
						notification={notification}
						onMarkAsRead={onMarkAsRead}
						onDelete={onDelete}
						onClose={onClose}
					/>
				))}
			</div>
		</ScrollArea>
	);
}
