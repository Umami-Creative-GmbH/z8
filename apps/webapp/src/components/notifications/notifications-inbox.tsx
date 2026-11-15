"use client";

import {
	IconBell,
	IconBellOff,
	IconCheck,
	IconRefresh,
	IconSettings,
	IconTrash,
} from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications } from "@/hooks/use-notifications";
import { useOrganization } from "@/hooks/use-organization";
import { useSession } from "@/lib/auth-client";
import { getLocalizedNotificationContent } from "@/lib/notifications/localized-notification";
import type { NotificationWithMeta } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { NotificationItem } from "./notification-item";

type ReadFilter = "all" | "unread" | "read";
const timelineGroups = ["Today", "Yesterday", "Earlier"] as const;
type TimelineGroup = (typeof timelineGroups)[number];

function groupFor(
	notification: NotificationWithMeta,
	today: Temporal.PlainDate,
	zone: string,
): TimelineGroup {
	// Preserve local arrival-day semantics, with an explicit system zone. This
	// timeline is not a source of work-record business dates or captured offsets.
	const value = notification.createdAt;
	const instant = Temporal.Instant.from(
		value instanceof Date ? value.toISOString() : String(value),
	);
	const day = instant.toZonedDateTimeISO(zone).toPlainDate();
	return day.equals(today)
		? "Today"
		: day.equals(today.subtract({ days: 1 }))
			? "Yesterday"
			: "Earlier";
}

function useInboxViewModel({
	organizationId,
}: {
	organizationId: string | null;
}) {
	const { t } = useTranslate();
	const selectAllId = useId();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const inbox = useNotifications({
		enabled: Boolean(organizationId),
		limit: 100,
		organizationId,
	});
	const [search, setSearch] = useState("");
	const [readFilter, setReadFilter] = useState<ReadFilter>("all");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const [pending, setPending] = useState(false);
	const [feedback, setFeedback] = useState("");
	const alive = useRef(true);
	const busy = useRef(false);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const deferredSearch = useDeferredValue(search)
		.trim()
		.toLocaleLowerCase(locale);
	const localized = (n: NotificationWithMeta) =>
		getLocalizedNotificationContent(n, t, locale);
	const visible = inbox.notifications.filter(
		(n) =>
			(readFilter === "all" || n.isRead === (readFilter === "read")) &&
			(!deferredSearch ||
				`${localized(n).title} ${localized(n).message}`
					.toLocaleLowerCase(locale)
					.includes(deferredSearch)),
	);
	const selected = visible.filter((n) => selectedIds.has(n.id));
	const selectedUnread = selected.filter((n) => !n.isRead);
	const allSelected = visible.length > 0 && selected.length === visible.length;
	const zone = Temporal.Now.timeZoneId();
	const today = Temporal.Now.plainDateISO(zone);
	const groups = { Today: [], Yesterday: [], Earlier: [] } as Record<
		TimelineGroup,
		NotificationWithMeta[]
	>;
	for (const n of visible) groups[groupFor(n, today, zone)].push(n);
	const groupLabel = (group: TimelineGroup) =>
		group === "Today"
			? t("common:notifications.timeline.today", "Today")
			: group === "Yesterday"
				? t("common:notifications.timeline.yesterday", "Yesterday")
				: t("common:notifications.timeline.earlier", "Earlier");
	const filters: { value: ReadFilter; label: string }[] = [
		{ value: "all", label: t("common:notifications.filters.all", "All") },
		{
			value: "unread",
			label: t("common:notifications.filters.unread", "Unread"),
		},
		{ value: "read", label: t("common:notifications.filters.read", "Read") },
	];
	const setSelected = (ids: string[], checked: boolean) =>
		setSelectedIds((current) => {
			const next = new Set(current);
			for (const id of ids) {
				if (checked) next.add(id);
				else next.delete(id);
			}
			return next;
		});
	const run = async (kind: "read" | "delete", ids: string[], bulk = false) => {
		if (busy.current || !ids.length) return;
		busy.current = true;
		setPending(true);
		setFeedback("");
		const results = await Promise.allSettled(
			ids.map((id) =>
				kind === "read" ? inbox.markAsRead(id) : inbox.deleteNotification(id),
			),
		).finally(() => {
			busy.current = false;
			if (alive.current) setPending(false);
		});
		// A remounted scope has a separate lifetime, even after A -> B -> A.
		if (!alive.current) return;
		const succeeded = ids.filter((_, i) => results[i].status === "fulfilled");
		const failed = ids.length - succeeded.length;
		if (bulk && !failed) setSelectedIds(new Set());
		else setSelected(succeeded, false);
		setFeedback(
			failed && !bulk
				? kind === "delete"
					? t(
							"common:notifications.toasts.deleteFailed",
							"Failed to delete notifications",
						)
					: t(
							"common:notifications.toasts.markReadFailed",
							"Failed to mark notifications as read",
						)
				: failed
					? kind === "delete"
						? t(
								"common:notifications.toasts.deletePartial",
								"{count} deleted; {failed} failed. Retry the remaining selection.",
								{ count: succeeded.length, failed },
							)
						: t(
								"common:notifications.toasts.readPartial",
								"{count} marked read; {failed} failed. Retry the remaining selection.",
								{ count: succeeded.length, failed },
							)
					: kind === "delete"
						? t(
								"common:notifications.toasts.deleted",
								"Deleted {count} notifications",
								{ count: succeeded.length },
							)
						: t(
								"common:notifications.toasts.markedRead",
								"Marked {count} notifications as read",
								{ count: succeeded.length },
							),
		);
	};
	const emptyTitle =
		readFilter === "unread" && !deferredSearch
			? t("common:notifications.empty.unreadTitle", "No unread notifications")
			: inbox.notifications.length === 0
				? t("common:notifications.empty.title", "No notifications")
				: t(
						"common:notifications.empty.noMatchesTitle",
						"No matching notifications",
					);
	const emptyDescription =
		readFilter === "unread" && !deferredSearch
			? t(
					"common:notifications.empty.unreadDescription",
					"You are all caught up. New unread updates will appear here.",
				)
			: inbox.notifications.length === 0
				? t(
						"common:notifications.empty.inboxDescription",
						"You are all caught up. New updates will appear here.",
					)
				: t(
						"common:notifications.empty.noMatchesDescription",
						"Adjust the search or read filter to widen this inbox view.",
					);

	return {
		t,
		selectAllId,
		inbox,
		search,
		setSearch,
		readFilter,
		setReadFilter,
		selectedIds,
		setSelectedIds,
		pending,
		feedback,
		visible,
		selected,
		selectedUnread,
		allSelected,
		localized,
		groups,
		groupLabel,
		filters,
		setSelected,
		run,
		emptyTitle,
		emptyDescription,
	};
}

function ScopedNotificationsInbox({
	organizationId,
}: {
	organizationId: string | null;
}) {
	const model = useInboxViewModel({ organizationId });
	const {
		t,
		selectAllId,
		inbox,
		search,
		setSearch,
		readFilter,
		setReadFilter,
		setSelectedIds,
		pending,
		feedback,
		visible,
		selected,
		selectedUnread,
		allSelected,
		filters,
		setSelected,
		run,
	} = model;
	return (
		<div className="mx-auto w-full max-w-5xl space-y-6">
			<PageHeader
				title={t("common:notifications.title", "Notifications")}
				description={
					<span role="status" className="tabular-nums">
						{inbox.isLoadingCount
							? t("common:notifications.loadingCount", "Loading unread count…")
							: inbox.isCountError
								? t(
										"common:notifications.countFailed",
										"Unread count unavailable",
									)
								: t("common:notifications.unreadBadge", "{count} unread", {
										count: inbox.unreadCount,
									})}
					</span>
				}
				actions={
					<>
						<Button
							disabled={inbox.isFetching}
							onClick={() => void inbox.refresh()}
							variant="outline"
							size="sm"
						>
							<IconRefresh
								aria-hidden="true"
								className={cn(
									"size-4",
									inbox.isFetching && "animate-spin motion-reduce:animate-none",
								)}
							/>
							{t("common:actions.refresh", "Refresh")}
						</Button>
						<Button asChild variant="outline" size="sm">
							<Link href="/settings/notifications">
								<IconSettings aria-hidden="true" className="size-4" />
								{t("common:nav.settings", "Settings")}
							</Link>
						</Button>
					</>
				}
			/>
			<div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
				<DataTableToolbar
					search={search}
					onSearchChange={setSearch}
					searchLabel={t(
						"common:notifications.search.ariaLabel",
						"Search notifications",
					)}
					searchPlaceholder={t(
						"common:notifications.search.placeholder",
						"Search notifications...",
					)}
					filterControls={
						<fieldset
							aria-label={t(
								"common:notifications.filters.ariaLabel",
								"Filter notifications by read status",
							)}
							className="flex flex-wrap gap-1"
						>
							{filters.map((filter) => (
								<Button
									key={filter.value}
									size="sm"
									variant={readFilter === filter.value ? "secondary" : "ghost"}
									aria-pressed={readFilter === filter.value}
									onClick={() => setReadFilter(filter.value)}
								>
									{filter.label}
								</Button>
							))}
						</fieldset>
					}
				/>
				{!inbox.isLoading && (!inbox.isError || visible.length > 0) && (
					<p className="text-sm text-muted-foreground tabular-nums">
						{t(
							"common:notifications.visibleWindow",
							"{count} visible · latest {limit} notifications",
							{ count: visible.length, limit: 100 },
						)}
					</p>
				)}
				{inbox.isError && (
					<Alert variant="destructive">
						<IconBellOff aria-hidden="true" />
						<AlertTitle>
							{t(
								"common:notifications.error.title",
								"Could not load notifications",
							)}
						</AlertTitle>
						<AlertDescription>
							<Button
								disabled={inbox.isFetching}
								onClick={() => void inbox.refresh()}
								variant="outline"
								size="sm"
							>
								{t("common:common.retry", "Retry")}
							</Button>
						</AlertDescription>
					</Alert>
				)}
				<p role="status" aria-atomic="true" className="text-sm empty:hidden">
					{feedback}
				</p>
				{visible.length > 0 && (
					<div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
						<label
							htmlFor={selectAllId}
							className="flex min-h-9 cursor-pointer items-center gap-2 text-sm"
						>
							<Checkbox
								id={selectAllId}
								disabled={pending}
								aria-label={t(
									"common:notifications.selection.selectAllAria",
									"Select all visible notifications",
								)}
								checked={
									selected.length > 0 && !allSelected
										? "indeterminate"
										: allSelected
								}
								onCheckedChange={(checked) =>
									setSelected(
										visible.map((n) => n.id),
										checked === true,
									)
								}
							/>
							{t(
								"common:notifications.selection.selectAll",
								"Select all visible",
							)}
						</label>
						{selected.length > 0 && (
							<fieldset
								className="flex flex-wrap items-center gap-2"
								aria-label={t(
									"common:notifications.selection.actions",
									"Selected notifications",
								)}
							>
								<span className="text-sm text-muted-foreground tabular-nums">
									{t(
										"common:notifications.selection.visibleSelected",
										"{count} visible selected",
										{ count: selected.length },
									)}
								</span>
								<Button
									disabled={pending}
									onClick={() => setSelectedIds(new Set())}
									size="sm"
									variant="ghost"
								>
									{t("common:common.clear", "Clear")}
								</Button>
								<Button
									disabled={pending || !selectedUnread.length}
									onClick={() =>
										void run(
											"read",
											selectedUnread.map((n) => n.id),
											true,
										)
									}
									size="sm"
									variant="outline"
								>
									<IconCheck aria-hidden="true" />
									{t("common:notifications.actions.markRead", "Mark read")}
								</Button>
								<Button
									disabled={pending}
									onClick={() =>
										void run(
											"delete",
											selected.map((n) => n.id),
											true,
										)
									}
									size="sm"
									variant="destructive"
								>
									<IconTrash aria-hidden="true" />
									{t("common:actions.delete", "Delete")}
								</Button>
							</fieldset>
						)}
					</div>
				)}
				<NotificationTimeline model={model} />
			</div>
		</div>
	);
}

export function NotificationsInbox() {
	const { organizationId } = useOrganization();
	const { data: session, isPending } = useSession();
	const key = JSON.stringify([
		session?.user.id,
		session?.session.activeOrganizationId,
		organizationId,
		isPending,
	]);
	return <ScopedNotificationsInbox key={key} organizationId={organizationId} />;
}

function NotificationTimeline({
	model,
}: {
	model: ReturnType<typeof useInboxViewModel>;
}) {
	const {
		inbox,
		pending,
		t,
		visible,
		emptyTitle,
		emptyDescription,
		groups,
		groupLabel,
		selectedIds,
		setSelected,
		localized,
		run,
	} = model;
	return (
		<div aria-busy={inbox.isFetching || pending}>
			{inbox.isLoading ? (
				<div
					role="status"
					aria-label={t(
						"common:notifications.loading",
						"Loading notifications…",
					)}
					className="space-y-3"
				>
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-20 w-full" />
					))}
				</div>
			) : visible.length === 0 ? (
				!inbox.isError && (
					<Empty className="min-h-64">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<IconBell aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>{emptyTitle}</EmptyTitle>
							<EmptyDescription>{emptyDescription}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				)
			) : (
				timelineGroups.map(
					(group) =>
						groups[group].length > 0 && (
							<section
								key={group}
								aria-label={groupLabel(group)}
								className="mt-5 first:mt-0"
							>
								<h2 className="mb-2 text-sm font-semibold">
									{groupLabel(group)}
								</h2>
								<ul className="divide-y">
									{groups[group].map((n) => (
										<li key={n.id} className="flex min-w-0 items-start gap-1">
											<div className="pl-1 pt-4">
												<Checkbox
													disabled={pending}
													aria-label={t(
														"common:notifications.selection.selectNamedAria",
														"Select {title}",
														{ title: localized(n).title },
													)}
													checked={selectedIds.has(n.id)}
													onCheckedChange={(checked) =>
														setSelected([n.id], checked === true)
													}
												/>
											</div>
											<div className="min-w-0 flex-1">
												<NotificationItem
													notification={n}
													disabled={pending}
													onDelete={(id) => void run("delete", [id])}
													onMarkAsRead={(id) => void run("read", [id])}
												/>
											</div>
										</li>
									))}
								</ul>
							</section>
						),
				)
			)}
		</div>
	);
}
