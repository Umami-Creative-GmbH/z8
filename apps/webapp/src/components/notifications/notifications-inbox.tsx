"use client";

import {
	IconBell,
	IconBellOff,
	IconCheck,
	IconRefresh,
	IconSearch,
	IconSettings,
	IconTrash,
} from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications } from "@/hooks/use-notifications";
import { useOrganization } from "@/hooks/use-organization";
import { getLocalizedNotificationContent } from "@/lib/notifications/localized-notification";
import type { NotificationWithMeta } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { NotificationItem } from "./notification-item";

type ReadFilter = "all" | "unread" | "read";
type TimelineGroup = "Today" | "Yesterday" | "Earlier";

const timelineGroups: TimelineGroup[] = ["Today", "Yesterday", "Earlier"];

function getGroupLabel(notification: NotificationWithMeta): TimelineGroup {
	const createdAt = DateTime.fromJSDate(new Date(notification.createdAt));
	const today = DateTime.now().startOf("day");
	const notificationDay = createdAt.startOf("day");

	if (notificationDay.equals(today)) {
		return "Today";
	}

	if (notificationDay.equals(today.minus({ days: 1 }))) {
		return "Yesterday";
	}

	return "Earlier";
}

function NotificationsInboxSkeleton() {
	return (
		<div className="space-y-3">
			{Array.from({ length: 5 }).map((_, index) => (
				<div className="flex items-start gap-3 rounded-lg border p-3" key={index.toString()}>
					<Skeleton className="mt-3 size-4" />
					<Skeleton className="size-9 rounded-full" />
					<div className="flex-1 space-y-2">
						<Skeleton className="h-4 w-2/3" />
						<Skeleton className="h-3 w-full" />
						<Skeleton className="h-3 w-24" />
					</div>
				</div>
			))}
		</div>
	);
}

export function NotificationsInbox() {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const { organizationId } = useOrganization();
	const hasOrganization = Boolean(organizationId);
	const [search, setSearch] = useState("");
	const [readFilter, setReadFilter] = useState<ReadFilter>("all");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const deferredSearch = useDeferredValue(search);

	const {
		notifications,
		isLoading,
		isError,
		isFetching,
		unreadCount,
		markAsRead,
		deleteNotification,
		isMarkingRead,
		isDeleting,
		refresh,
	} = useNotifications({ enabled: hasOrganization, limit: 100, organizationId });
	const readFilters: { label: string; value: ReadFilter }[] = [
		{ label: t("common:notifications.filters.all", "All"), value: "all" },
		{ label: t("common:notifications.filters.unread", "Unread"), value: "unread" },
		{ label: t("common:notifications.filters.read", "Read"), value: "read" },
	];
	const getTimelineGroupLabel = (group: TimelineGroup) => {
		switch (group) {
			case "Today":
				return t("common:notifications.timeline.today", "Today");
			case "Yesterday":
				return t("common:notifications.timeline.yesterday", "Yesterday");
			case "Earlier":
				return t("common:notifications.timeline.earlier", "Earlier");
		}
	};

	const filteredNotifications = (() => {
		const normalizedSearch = deferredSearch.trim().toLowerCase();

		return notifications.filter((notification) => {
			if (readFilter === "unread" && notification.isRead) {
				return false;
			}

			if (readFilter === "read" && !notification.isRead) {
				return false;
			}

			if (!normalizedSearch) {
				return true;
			}

			const localized = getLocalizedNotificationContent(notification, t, locale);

			return `${localized.title} ${localized.message}`.toLowerCase().includes(normalizedSearch);
		});
	})();

	const groupedNotifications = (() => {
		const groups: Record<TimelineGroup, NotificationWithMeta[]> = {
			Today: [],
			Yesterday: [],
			Earlier: [],
		};

		for (const notification of filteredNotifications) {
			groups[getGroupLabel(notification)].push(notification);
		}

		return groups;
	})();

	const visibleIds = filteredNotifications.map((notification) => notification.id);
	const hasSearch = deferredSearch.trim().length > 0;
	const selectedVisibleIds = visibleIds.filter((id) => selectedIds.has(id));
	const selectedUnreadVisibleIds = filteredNotifications
		.filter((notification) => selectedIds.has(notification.id) && !notification.isRead)
		.map((notification) => notification.id);
	const selectedVisibleCount = selectedVisibleIds.length;
	const selectedUnreadVisibleCount = selectedUnreadVisibleIds.length;
	const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
	const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
	const hasSelection = selectedVisibleCount > 0;
	const isMutating = isMarkingRead || isDeleting;

	const setSelected = (notificationId: string, checked: boolean) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (checked) {
				next.add(notificationId);
			} else {
				next.delete(notificationId);
			}
			return next;
		});
	};

	const toggleSelectAllVisible = (checked: boolean) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			for (const id of visibleIds) {
				if (checked) {
					next.add(id);
				} else {
					next.delete(id);
				}
			}
			return next;
		});
	};

	const clearSelection = () => setSelectedIds(new Set());

	const handleBulkMarkRead = async () => {
		try {
			await Promise.all(selectedUnreadVisibleIds.map((id) => markAsRead(id)));
			toast.success(
				t("common:notifications.toasts.markedRead", "Marked {count} notifications as read", {
					count: selectedUnreadVisibleCount,
				}),
			);
			clearSelection();
		} catch {
			toast.error(
				t("common:notifications.toasts.markReadFailed", "Failed to mark notifications as read"),
			);
		}
	};

	const emptyTitle =
		readFilter === "unread" && !hasSearch
			? t("common:notifications.empty.unreadTitle", "No unread notifications")
			: notifications.length === 0
				? t("common:notifications.empty.title", "No notifications")
				: t("common:notifications.empty.noMatchesTitle", "No matching notifications");
	const emptyDescription =
		readFilter === "unread" && !hasSearch
			? t(
					"common:notifications.empty.unreadDescription",
					"You are all caught up. New unread updates will appear here.",
				)
			: notifications.length === 0
				? t(
						"common:notifications.empty.inboxDescription",
						"You are all caught up. New updates will appear here.",
					)
				: t(
						"common:notifications.empty.noMatchesDescription",
						"Adjust the search or read filter to widen this inbox view.",
					);

	const handleBulkDelete = async () => {
		try {
			await Promise.all(selectedVisibleIds.map((id) => deleteNotification(id)));
			toast.success(
				t("common:notifications.toasts.deleted", "Deleted {count} notifications", {
					count: selectedVisibleCount,
				}),
			);
			clearSelection();
		} catch {
			toast.error(t("common:notifications.toasts.deleteFailed", "Failed to delete notifications"));
		}
	};

	return (
		<Card className="gap-0 overflow-hidden">
			<CardHeader className="border-b">
				<div className="space-y-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className="text-2xl">
							{t("common:notifications.title", "Notifications")}
						</CardTitle>
						{unreadCount > 0 && (
							<Badge variant="secondary">
								{t("common:notifications.unreadBadge", "{count} unread", { count: unreadCount })}
							</Badge>
						)}
					</div>
					<CardDescription>
						{t(
							"common:notifications.description",
							"Review updates, approvals, and system alerts in one timeline.",
						)}
					</CardDescription>
				</div>
				<CardAction className="flex items-center gap-2">
					<Button disabled={isFetching} onClick={refresh} size="sm" type="button" variant="outline">
						<IconRefresh className={cn("size-4", isFetching && "animate-spin")} />
						{t("common:actions.refresh", "Refresh")}
					</Button>
					<Button asChild size="sm" variant="outline">
						<Link href="/settings/notifications">
							<IconSettings className="size-4" />
							{t("common:nav.settings", "Settings")}
						</Link>
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent className="space-y-4 py-4">
				<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div className="relative md:w-80">
						<IconSearch className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
						<Input
							aria-label={t("common:notifications.search.ariaLabel", "Search notifications")}
							className="pl-9"
							onChange={(event) => setSearch(event.target.value)}
							placeholder={t("common:notifications.search.placeholder", "Search notifications...")}
							value={search}
						/>
					</div>

					<div
						aria-label={t(
							"common:notifications.filters.ariaLabel",
							"Filter notifications by read status",
						)}
						className="inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground"
						role="group"
					>
						{readFilters.map((filter) => (
							<Button
								aria-pressed={readFilter === filter.value}
								className={cn(
									"h-[calc(100%-1px)] flex-1 rounded-md border border-transparent px-2 py-1 shadow-none",
									readFilter === filter.value &&
										"border-border bg-background text-foreground shadow-sm",
								)}
								key={filter.value}
								onClick={() => setReadFilter(filter.value)}
								size="sm"
								type="button"
								variant="ghost"
							>
								{filter.label}
							</Button>
						))}
					</div>
				</div>

				{isError && (
					<Alert variant="destructive">
						<IconBellOff className="size-4" />
						<AlertTitle>
							{t("common:notifications.error.title", "Could not load notifications")}
						</AlertTitle>
						<AlertDescription>
							<Button onClick={refresh} size="sm" type="button" variant="outline">
								{t("common:common.retry", "Retry")}
							</Button>
						</AlertDescription>
					</Alert>
				)}

				{hasSelection && (
					<div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 md:flex-row md:items-center md:justify-between">
						<p className="text-sm text-muted-foreground">
							{t("common:notifications.selection.visibleSelected", "{count} visible selected", {
								count: selectedVisibleCount,
							})}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								disabled={isMutating}
								onClick={clearSelection}
								size="sm"
								type="button"
								variant="ghost"
							>
								{t("common:common.clear", "Clear")}
							</Button>
							<Button
								disabled={isMutating || selectedUnreadVisibleCount === 0}
								onClick={handleBulkMarkRead}
								size="sm"
								type="button"
								variant="outline"
							>
								<IconCheck className="size-4" />
								{t("common:notifications.actions.markRead", "Mark read")}
							</Button>
							<Button
								disabled={isMutating}
								onClick={handleBulkDelete}
								size="sm"
								type="button"
								variant="destructive"
							>
								<IconTrash className="size-4" />
								{t("common:actions.delete", "Delete")}
							</Button>
						</div>
					</div>
				)}

				{isLoading ? (
					<NotificationsInboxSkeleton />
				) : filteredNotifications.length === 0 ? (
					<Empty className="min-h-[360px] border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<IconBell className="size-5" />
							</EmptyMedia>
							<EmptyTitle>{emptyTitle}</EmptyTitle>
							<EmptyDescription>{emptyDescription}</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button onClick={refresh} type="button" variant="outline">
								<IconRefresh className="size-4" />
								{t("common:actions.refresh", "Refresh")}
							</Button>
						</EmptyContent>
					</Empty>
				) : (
					<div className="space-y-6">
						<div className="flex items-center gap-2 rounded-lg border px-3 py-2">
							<Checkbox
								aria-label={t(
									"common:notifications.selection.selectAllAria",
									"Select all visible notifications",
								)}
								checked={someVisibleSelected ? "indeterminate" : allVisibleSelected}
								onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
							/>
							<span className="text-sm text-muted-foreground">
								{t("common:notifications.selection.selectAll", "Select all visible")}
							</span>
						</div>

						{timelineGroups.map((group) => {
							const groupNotifications = groupedNotifications[group];
							if (groupNotifications.length === 0) {
								return null;
							}

							return (
								<section className="space-y-2" key={group}>
									<h2 className="font-medium text-muted-foreground text-sm">
										{getTimelineGroupLabel(group)}
									</h2>
									<div className="divide-y rounded-lg border">
										{groupNotifications.map((notification) => (
											<div className="flex items-start gap-2" key={notification.id}>
												<div className="flex pt-6 pl-3">
													<Checkbox
														aria-label={t(
															"common:notifications.selection.selectNamedAria",
															"Select {title}",
															{
																title: getLocalizedNotificationContent(notification, t, locale)
																	.title,
															},
														)}
														checked={selectedIds.has(notification.id)}
														onCheckedChange={(checked) =>
															setSelected(notification.id, checked === true)
														}
													/>
												</div>
												<div className="min-w-0 flex-1">
													<NotificationItem
														notification={notification}
														onDelete={deleteNotification}
														onMarkAsRead={markAsRead}
													/>
												</div>
											</div>
										))}
									</div>
								</section>
							);
						})}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
