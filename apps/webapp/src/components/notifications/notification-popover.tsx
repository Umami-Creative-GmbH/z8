"use client";

import { IconCheck, IconSettings } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useNotifications } from "@/hooks/use-notifications";
import { NotificationList } from "./notification-list";

interface NotificationPopoverProps {
	children: React.ReactNode;
}

export function NotificationPopover({ children }: NotificationPopoverProps) {
	const [open, setOpen] = useState(false);
	const {
		notifications,
		unreadCount,
		isLoading,
		markAsRead,
		markAllAsRead,
		deleteNotification,
		isMarkingAllRead,
	} = useNotifications({ enabled: open });

	const handleMarkAsRead = async (id: string) => {
		try {
			await markAsRead(id);
		} catch {
			// Error is handled by the hook
		}
	};

	const handleMarkAllAsRead = async () => {
		try {
			await markAllAsRead();
		} catch {
			// Error is handled by the hook
		}
	};

	const handleDelete = async (id: string) => {
		try {
			await deleteNotification(id);
		} catch {
			// Error is handled by the hook
		}
	};

	const handleClose = () => {
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent className="w-96 p-0" align="end" sideOffset={8}>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-2">
						<h3 className="font-semibold">Notifications</h3>
						{unreadCount > 0 && (
							<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
								{unreadCount > 99 ? "99+" : unreadCount}
							</span>
						)}
					</div>
					<div className="flex items-center gap-1">
						{unreadCount > 0 && (
							<Button
								size="sm"
								variant="ghost"
								className="h-8 text-xs"
								onClick={handleMarkAllAsRead}
								disabled={isMarkingAllRead}
							>
								<IconCheck className="mr-1 size-3.5" />
								Mark all read
							</Button>
						)}
						<Button size="icon" variant="ghost" className="size-8" asChild onClick={handleClose}>
							<Link href="/settings/notifications">
								<IconSettings className="size-4" />
								<span className="sr-only">Notification settings</span>
							</Link>
						</Button>
					</div>
				</div>

				<Separator />

				{/* Notification List */}
				<NotificationList
					notifications={notifications}
					isLoading={isLoading}
					onMarkAsRead={handleMarkAsRead}
					onDelete={handleDelete}
					onClose={handleClose}
				/>

				{/* Footer */}
				{notifications.length > 0 && (
					<>
						<Separator />
						<div className="p-2">
							<Button variant="ghost" className="w-full text-sm" asChild onClick={handleClose}>
								<Link href="/notifications">View all notifications</Link>
							</Button>
						</div>
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
