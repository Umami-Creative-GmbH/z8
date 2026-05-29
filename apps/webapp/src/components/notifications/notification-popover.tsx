"use client";

import { IconChecks, IconSettings, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useNotifications } from "@/hooks/use-notifications";
import { useOrganization } from "@/hooks/use-organization";
import { Link } from "@/navigation";
import { NotificationList } from "./notification-list";

interface NotificationPopoverProps {
	children: React.ReactNode;
}

export function NotificationPopover({ children }: NotificationPopoverProps) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const { organizationId } = useOrganization();
	const hasOrganization = Boolean(organizationId);

	const {
		notifications,
		unreadCount,
		isLoading,
		markAsRead,
		markAllAsRead,
		deleteNotification,
		deleteAllNotifications,
		isMarkingAllRead,
		isDeletingAll,
	} = useNotifications({ enabled: open && hasOrganization, organizationId });

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

	const handleDeleteAll = async () => {
		try {
			await deleteAllNotifications();
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
						<h3 className="font-semibold">{t("common:notifications.title", "Notifications")}</h3>
						{unreadCount > 0 && (
							<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
								{unreadCount > 99
									? t("common:notifications.unreadCountOverflow", "99+")
									: unreadCount}
							</span>
						)}
					</div>
					<div className="flex items-center gap-1">
						{unreadCount > 0 && (
							<Button
								size="icon"
								variant="ghost"
								className="size-8"
								onClick={handleMarkAllAsRead}
								disabled={isMarkingAllRead}
								aria-label={t("common:notifications.actions.markAllRead", "Mark all read")}
								title={t("common:notifications.actions.markAllRead", "Mark all read")}
							>
								<IconChecks className="size-4" />
							</Button>
						)}
						{notifications.length > 0 && (
							<Button
								size="icon"
								variant="ghost"
								className="size-8 text-muted-foreground hover:text-destructive"
								onClick={handleDeleteAll}
								disabled={isDeletingAll}
								aria-label={t("common:notifications.actions.deleteAll", "Delete all")}
								title={t("common:notifications.actions.deleteAll", "Delete all")}
							>
								<IconTrash className="size-4" />
							</Button>
						)}
						<Button size="icon" variant="ghost" className="size-8" asChild onClick={handleClose}>
							<Link
								href="/settings/notifications"
								aria-label={t("common:notifications.actions.settings", "Notification settings")}
								title={t("common:notifications.actions.settings", "Notification settings")}
							>
								<IconSettings className="size-4" />
								<span className="sr-only">
									{t("common:notifications.actions.settings", "Notification settings")}
								</span>
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
								<Link href="/notifications">
									{t("common:notifications.actions.viewAll", "View all notifications")}
								</Link>
							</Button>
						</div>
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
