# Notifications Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the missing localized `/notifications` app page as a rich notification inbox with search, read-state filters, grouped timeline, and bulk management.

**Architecture:** Add a server route that requires an authenticated user, then render a focused client inbox component. The inbox uses the existing `useNotifications` hook and existing notification item component, keeping organization scoping in the current `/api/notifications` API.

**Tech Stack:** Next.js App Router, React 19, TanStack Query via `useNotifications`, Tabler icons, existing shadcn-style UI components, Luxon for date grouping, Vitest/Testing Library if component test infrastructure is present.

---

## File Structure

- Create: `apps/webapp/src/app/[locale]/(app)/notifications/page.tsx`
  - Server page for `/notifications`; calls `requireUser()` and renders the client inbox inside the app layout.
- Create: `apps/webapp/src/components/notifications/notifications-inbox.tsx`
  - Client component for fetching notifications, search/filter state, grouping by `createdAt`, selection state, bulk actions, loading/empty/error states, and page layout.
- Modify: `apps/webapp/src/components/notifications/index.ts`
  - Export `NotificationsInbox`.
- Modify: `apps/webapp/src/components/site-header.tsx`
  - Add route title mapping for `/notifications` so the header does not fall back to Dashboard.
- Optional Test: `apps/webapp/src/components/notifications/notifications-inbox.test.tsx`
  - Add only if nearby React component test setup is straightforward in this repo. Otherwise rely on type/lint/build verification and manual browser verification.

## Task 1: Add The Notifications Route

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/notifications/page.tsx`
- Modify: `apps/webapp/src/components/notifications/index.ts`
- Create later dependency: `apps/webapp/src/components/notifications/notifications-inbox.tsx`

- [ ] **Step 1: Create the route page with the intended server boundary**

Create `apps/webapp/src/app/[locale]/(app)/notifications/page.tsx`:

```tsx
import { NotificationsInbox } from "@/components/notifications";
import { requireUser } from "@/lib/auth-helpers";

export default async function NotificationsPage() {
	await requireUser();

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0 md:gap-6 md:p-6 md:pt-0">
			<NotificationsInbox />
		</div>
	);
}
```

- [ ] **Step 2: Add the component export placeholder**

Modify `apps/webapp/src/components/notifications/index.ts`:

```ts
export { NotificationBell } from "./notification-bell";
export { NotificationItem } from "./notification-item";
export { NotificationList } from "./notification-list";
export { NotificationPopover } from "./notification-popover";
export { NotificationSettings } from "./notification-settings";
export { NotificationsInbox } from "./notifications-inbox";
```

- [ ] **Step 3: Run the expected failing type check**

Run: `pnpm exec tsc --noEmit`

Expected: FAIL because `./notifications-inbox` does not exist yet. If this repo does not have a directly runnable TypeScript config from `apps/webapp`, run the normal project check used by the repo and confirm the missing module error appears.

- [ ] **Step 4: Do not commit yet**

This task intentionally depends on Task 2 to make the route compile.

## Task 2: Build The Inbox Component

**Files:**
- Create: `apps/webapp/src/components/notifications/notifications-inbox.tsx`

- [ ] **Step 1: Create the client component**

Create `apps/webapp/src/components/notifications/notifications-inbox.tsx`:

```tsx
"use client";

import {
	IconBellOff,
	IconCheck,
	IconLoader2,
	IconRefresh,
	IconSearch,
	IconSettings,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { NotificationItem } from "@/components/notifications/notification-item";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNotifications } from "@/hooks/use-notifications";
import type { NotificationWithMeta } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";

type NotificationFilter = "all" | "unread" | "read";
type GroupName = "Today" | "Yesterday" | "Earlier";

const FILTERS: Array<{ value: NotificationFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "unread", label: "Unread" },
	{ value: "read", label: "Read" },
];

function getGroupName(notification: NotificationWithMeta): GroupName {
	const createdAt = DateTime.fromJSDate(new Date(notification.createdAt));
	const today = DateTime.now().startOf("day");

	if (createdAt >= today) return "Today";
	if (createdAt >= today.minus({ days: 1 })) return "Yesterday";
	return "Earlier";
}

function matchesQuery(notification: NotificationWithMeta, query: string) {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return true;

	return `${notification.title} ${notification.message}`.toLowerCase().includes(normalizedQuery);
}

function filterNotifications(
	notifications: NotificationWithMeta[],
	filter: NotificationFilter,
	query: string,
) {
	return notifications.filter((notification) => {
		if (filter === "unread" && notification.isRead) return false;
		if (filter === "read" && !notification.isRead) return false;
		return matchesQuery(notification, query);
	});
}

function groupNotifications(notifications: NotificationWithMeta[]) {
	const groups: Record<GroupName, NotificationWithMeta[]> = {
		Today: [],
		Yesterday: [],
		Earlier: [],
	};

	for (const notification of notifications) {
		groups[getGroupName(notification)].push(notification);
	}

	return groups;
}

function LoadingState() {
	return (
		<Card>
			<CardContent className="space-y-4 p-4">
				{Array.from({ length: 5 }).map((_, index) => (
					<div className="flex items-start gap-3" key={index.toString()}>
						<Skeleton className="size-5 rounded" />
						<Skeleton className="size-9 rounded-full" />
						<div className="flex-1 space-y-2">
							<Skeleton className="h-4 w-2/3" />
							<Skeleton className="h-3 w-full" />
							<Skeleton className="h-3 w-24" />
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

function EmptyInbox({ filter, query }: { filter: NotificationFilter; query: string }) {
	const hasQuery = query.trim().length > 0;
	const title = hasQuery
		? "No matching notifications"
		: filter === "unread"
			? "No unread notifications"
			: "No notifications";
	const description = hasQuery
		? "Try a different search term or clear the current filters."
		: filter === "unread"
			? "You're all caught up. New unread notifications will appear here."
			: "New notifications will appear here when there is something to review.";

	return (
		<Card>
			<CardContent>
				<Empty className="border-0 py-12">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconBellOff className="size-5" />
						</EmptyMedia>
						<EmptyTitle>{title}</EmptyTitle>
						<EmptyDescription>{description}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</CardContent>
		</Card>
	);
}

export function NotificationsInbox() {
	const [filter, setFilter] = useState<NotificationFilter>("all");
	const [query, setQuery] = useState("");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const deferredQuery = useDeferredValue(query);

	const {
		notifications,
		unreadCount,
		total,
		isLoading,
		isFetching,
		isError,
		markAsRead,
		deleteNotification,
		refresh,
		isMarkingRead,
		isDeleting,
	} = useNotifications({ limit: 100 });

	const visibleNotifications = useMemo(
		() => filterNotifications(notifications, filter, deferredQuery),
		[deferredQuery, filter, notifications],
	);
	const groupedNotifications = useMemo(
		() => groupNotifications(visibleNotifications),
		[visibleNotifications],
	);
	const selectedCount = selectedIds.size;
	const selectedUnreadCount = visibleNotifications.filter(
		(notification) => selectedIds.has(notification.id) && !notification.isRead,
	).length;
	const allVisibleSelected =
		visibleNotifications.length > 0 &&
		visibleNotifications.every((notification) => selectedIds.has(notification.id));

	const handleToggleSelected = (id: string, checked: boolean) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	};

	const handleToggleAllVisible = (checked: boolean) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			for (const notification of visibleNotifications) {
				if (checked) next.add(notification.id);
				else next.delete(notification.id);
			}
			return next;
		});
	};

	const handleMarkSelectedRead = async () => {
		const unreadIds = visibleNotifications
			.filter((notification) => selectedIds.has(notification.id) && !notification.isRead)
			.map((notification) => notification.id);

		try {
			await Promise.all(unreadIds.map((id) => markAsRead(id)));
			setSelectedIds(new Set());
			toast.success("Selected notifications marked as read");
		} catch {
			toast.error("Some notifications could not be marked as read");
		}
	};

	const handleDeleteSelected = async () => {
		const ids = visibleNotifications
			.filter((notification) => selectedIds.has(notification.id))
			.map((notification) => notification.id);

		try {
			await Promise.all(ids.map((id) => deleteNotification(id)));
			setSelectedIds(new Set());
			toast.success("Selected notifications deleted");
		} catch {
			toast.error("Some notifications could not be deleted");
		}
	};

	if (isLoading) return <LoadingState />;

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="font-semibold text-2xl tracking-tight">Notifications</h2>
						{unreadCount > 0 && (
							<span className="rounded-full bg-primary px-2 py-0.5 text-primary-foreground text-xs font-medium">
								{unreadCount > 99 ? "99+" : unreadCount} unread
							</span>
						)}
					</div>
					<p className="text-muted-foreground text-sm">
						Review alerts, approvals, reminders, and system updates for your active organization.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button onClick={refresh} variant="outline" disabled={isFetching}>
						<IconRefresh className={cn("size-4", isFetching && "animate-spin")} />
						Refresh
					</Button>
					<Button asChild variant="outline">
						<Link href="/settings/notifications">
							<IconSettings className="size-4" />
							Settings
						</Link>
					</Button>
				</div>
			</div>

			<Card>
				<CardContent className="space-y-3 p-4">
					<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<div className="relative lg:w-96">
							<IconSearch className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
							<Input
								aria-label="Search notifications"
								className="pl-9"
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search notifications"
								value={query}
							/>
						</div>
						<Tabs value={filter} onValueChange={(value) => setFilter(value as NotificationFilter)}>
							<TabsList>
								{FILTERS.map((item) => (
									<TabsTrigger key={item.value} value={item.value}>
										{item.label}
									</TabsTrigger>
								))}
							</TabsList>
						</Tabs>
					</div>

					{selectedCount > 0 && (
						<div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
							<p className="font-medium text-sm">{selectedCount} selected</p>
							<div className="flex flex-wrap items-center gap-2">
								<Button onClick={() => setSelectedIds(new Set())} size="sm" variant="ghost">
									<IconX className="size-4" />
									Clear
								</Button>
								<Button
									onClick={handleMarkSelectedRead}
									size="sm"
									variant="outline"
									disabled={selectedUnreadCount === 0 || isMarkingRead}
								>
									{isMarkingRead ? <IconLoader2 className="size-4 animate-spin" /> : <IconCheck className="size-4" />}
									Mark read
								</Button>
								<Button
									onClick={handleDeleteSelected}
									size="sm"
									variant="destructive"
									disabled={isDeleting}
								>
									{isDeleting ? <IconLoader2 className="size-4 animate-spin" /> : <IconTrash className="size-4" />}
									Delete
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			{isError && (
				<Alert variant="destructive">
					<AlertTitle>Notifications could not be loaded</AlertTitle>
					<AlertDescription>
						Refresh the page or try again. If the problem persists, check your organization access.
					</AlertDescription>
				</Alert>
			)}

			{visibleNotifications.length === 0 ? (
				<EmptyInbox filter={filter} query={deferredQuery} />
			) : (
				<Card>
					<CardHeader className="flex flex-row items-center justify-between border-b py-3">
						<CardTitle className="font-medium text-sm">
							{visibleNotifications.length} of {total} notifications
						</CardTitle>
						<label className="flex items-center gap-2 text-muted-foreground text-sm">
							<Checkbox
								checked={allVisibleSelected}
								onCheckedChange={(checked) => handleToggleAllVisible(checked === true)}
							/>
							Select all visible
						</label>
					</CardHeader>
					<CardContent className="p-0">
						{(["Today", "Yesterday", "Earlier"] as const).map((groupName) => {
							const group = groupedNotifications[groupName];
							if (group.length === 0) return null;

							return (
								<section key={groupName}>
									<div className="border-b bg-muted/30 px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
										{groupName}
									</div>
									<div className="divide-y">
										{group.map((notification) => (
											<div className="flex items-start gap-2 px-3" key={notification.id}>
												<Checkbox
													aria-label={`Select ${notification.title}`}
													checked={selectedIds.has(notification.id)}
													className="mt-6"
													onCheckedChange={(checked) =>
														handleToggleSelected(notification.id, checked === true)
													}
												/>
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
					</CardContent>
				</Card>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm exec tsc --noEmit`

Expected: PASS, or only unrelated existing errors. If the command fails because the repo does not expose a standalone TypeScript check, run `pnpm build` after implementation verification instead.

- [ ] **Step 3: Commit route and component**

Run:

```bash
git add "apps/webapp/src/app/[locale]/(app)/notifications/page.tsx" "apps/webapp/src/components/notifications/index.ts" "apps/webapp/src/components/notifications/notifications-inbox.tsx"
git commit -m "feat: add notifications inbox page"
```

Expected: commit succeeds. Do not include unrelated dirty files.

## Task 3: Add Header Title Mapping

**Files:**
- Modify: `apps/webapp/src/components/site-header.tsx`

- [ ] **Step 1: Update title route mapping**

Modify the title key mapping in `apps/webapp/src/components/site-header.tsx` so `/notifications` resolves before the dashboard fallback:

```tsx
		if (path === "/" || path === "") return "dashboard.title";
		if (path.startsWith("/notifications")) return "notifications.title";
		if (path.startsWith("/calendar")) return "calendar.title";
```

Modify the default title mapping in the same file:

```tsx
		if (path === "/" || path === "") return "Dashboard";
		if (path.startsWith("/notifications")) return "Notifications";
		if (path.startsWith("/calendar")) return "Calendar";
```

- [ ] **Step 2: Run focused static check**

Run: `pnpm exec biome check src/components/site-header.tsx`

Expected: PASS, or formatting/lint output that can be fixed with `pnpm exec biome check --write src/components/site-header.tsx`.

- [ ] **Step 3: Commit header mapping**

Run:

```bash
git add "apps/webapp/src/components/site-header.tsx"
git commit -m "fix: title notifications route"
```

Expected: commit succeeds. Do not include unrelated dirty files.

## Task 4: Add Focused Component Tests If Feasible

**Files:**
- Optional Create: `apps/webapp/src/components/notifications/notifications-inbox.test.tsx`

- [ ] **Step 1: Check whether React component tests are configured**

Run: `pnpm test -- --runInBand src/components/notifications/notifications-inbox.test.tsx`

Expected: If Vitest reports the file is missing, continue. If it reports unsupported `--runInBand`, use `pnpm test -- src/components/notifications/notifications-inbox.test.tsx` for later runs.

- [ ] **Step 2: Add test only if jsdom React tests already run in this repo**

Create `apps/webapp/src/components/notifications/notifications-inbox.test.tsx` if existing component test setup supports it:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsInbox } from "./notifications-inbox";

vi.mock("@/hooks/use-notifications", () => ({
	useNotifications: vi.fn(),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: vi.fn() }),
}));

const { useNotifications } = await import("@/hooks/use-notifications");

describe("NotificationsInbox", () => {
	beforeEach(() => {
		vi.mocked(useNotifications).mockReturnValue({
			notifications: [],
			total: 0,
			hasMore: false,
			isLoading: false,
			isFetching: false,
			isError: false,
			unreadCount: 0,
			isLoadingCount: false,
			markAsRead: vi.fn(),
			markAllAsRead: vi.fn(),
			deleteNotification: vi.fn(),
			deleteAllNotifications: vi.fn(),
			isMarkingRead: false,
			isMarkingAllRead: false,
			isDeleting: false,
			isDeletingAll: false,
			refresh: vi.fn(),
		});
	});

	it("renders the empty inbox state", () => {
		render(<NotificationsInbox />);

		expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
		expect(screen.getByText("No notifications")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute(
			"href",
			"/settings/notifications",
		);
	});
});
```

- [ ] **Step 3: Run the component test if added**

Run: `pnpm test -- src/components/notifications/notifications-inbox.test.tsx`

Expected: PASS. If jsdom matchers or aliases are not configured and fixing that would become broad setup work, delete this optional test and rely on Task 5 verification.

- [ ] **Step 4: Commit test if added**

Run:

```bash
git add "apps/webapp/src/components/notifications/notifications-inbox.test.tsx"
git commit -m "test: cover notifications inbox empty state"
```

Expected: commit succeeds if the test file exists. Skip this commit if no test file was added.

## Task 5: Final Verification

**Files:**
- Verify only; no code changes expected.

- [ ] **Step 1: Run formatting/lint check for touched files**

Run:

```bash
pnpm exec biome check "src/app/[locale]/(app)/notifications/page.tsx" "src/components/notifications/index.ts" "src/components/notifications/notifications-inbox.tsx" "src/components/site-header.tsx"
```

Expected: PASS. If Biome reports fixable formatting issues, run the same command with `--write`, review the diff, and commit formatting changes with `git commit -m "style: format notifications inbox"`.

- [ ] **Step 2: Run project tests available without secrets**

Run: `pnpm test`

Expected: PASS, or unrelated pre-existing failures documented with file names and error summaries.

- [ ] **Step 3: Run production build if environment allows**

Run: `pnpm build`

Expected: PASS. If build fails because Phase CLI variables or system secrets are unavailable, document the skipped build and the exact missing requirement.

- [ ] **Step 4: Browser verify the route**

Run: `pnpm dev`

Then open the app in a browser and verify:

```text
/notifications loads inside the authenticated app shell.
The page header says Notifications.
Search filters title/message matches.
All/Unread/Read filters update the list.
Notifications are grouped into Today, Yesterday, and Earlier.
Selecting one or more rows shows bulk actions.
Mark read and delete actions update the list and unread count.
Settings opens /settings/notifications.
```

Expected: All checks pass. If login or environment variables block browser verification, document the blocker and rely on static verification.

- [ ] **Step 5: Final git status check**

Run: `git status --short`

Expected: Only unrelated pre-existing user changes remain. The implementation files should be committed or intentionally left staged only if the user requested no commits.

## Self-Review Notes

- Spec coverage: route, rich client inbox, search, read filters, grouped timeline, bulk read/delete, existing API reuse, loading/empty/error states, and verification are all covered.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `NotificationFilter`, `NotificationWithMeta`, `createdAt`, `isRead`, `markAsRead`, `deleteNotification`, and `refresh` match existing hook/type contracts.
