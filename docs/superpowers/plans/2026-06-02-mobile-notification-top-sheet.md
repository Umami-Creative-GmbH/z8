# Mobile Notification Top Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show notifications in a top-sliding sheet on mobile while preserving the existing desktop popover.

**Architecture:** Refactor `NotificationPopover` to share the notification panel markup between two responsive containers. Render a mobile-only Radix sheet using `md:hidden` and a desktop-only popover using `hidden md:block`, with separate open state for each surface so opening one portal does not mount the other. Notification loading remains enabled when either surface is open.

**Tech Stack:** Next.js client component, React state, existing shadcn/Radix `Popover` and `Sheet` primitives, Tailwind responsive utilities, Tabler icons, Tolgee translations.

---

### Task 1: Responsive Notification Surface

**Files:**
- Modify: `apps/webapp/src/components/notifications/notification-popover.tsx`

- [ ] **Step 1: Add sheet imports**

Update the imports to include the existing sheet primitives:

```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
```

- [ ] **Step 2: Extract shared panel content**

Inside `NotificationPopover`, create a `notificationContent` JSX constant after `handleClose`. Move the current popover header, separator, `NotificationList`, and footer into it:

```tsx
const notificationContent = (
	<>
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

		<NotificationList
			notifications={notifications}
			isLoading={isLoading}
			onMarkAsRead={handleMarkAsRead}
			onDelete={handleDelete}
			onClose={handleClose}
		/>

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
	</>
);
```

- [ ] **Step 3: Split open state by responsive surface**

Replace the existing single `open` state with mobile and desktop state:

```tsx
const [mobileOpen, setMobileOpen] = useState(false);
const [desktopOpen, setDesktopOpen] = useState(false);
const isOpen = mobileOpen || desktopOpen;
```

Update notification loading and close behavior:

```tsx
} = useNotifications({ enabled: isOpen && hasOrganization, organizationId });

const handleClose = () => {
	setMobileOpen(false);
	setDesktopOpen(false);
};
```

- [ ] **Step 4: Render mobile sheet and desktop popover**

Replace the single `Popover` return with responsive wrappers:

```tsx
return (
	<>
		<div className="md:hidden">
			<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
				<SheetTrigger asChild>{children}</SheetTrigger>
				<SheetContent side="top" className="max-h-[85dvh] gap-0 overflow-hidden p-0">
					{notificationContent}
				</SheetContent>
			</Sheet>
		</div>

		<div className="hidden md:block">
			<Popover open={desktopOpen} onOpenChange={setDesktopOpen}>
				<PopoverTrigger asChild>{children}</PopoverTrigger>
				<PopoverContent className="w-96 p-0" align="end" sideOffset={8}>
					{notificationContent}
				</PopoverContent>
			</Popover>
		</div>
	</>
);
```

- [ ] **Step 5: Verify formatting and types**

Run a targeted check from the repository root:

```bash
pnpm --filter webapp lint
```

Expected: command completes without errors related to `notification-popover.tsx`.
