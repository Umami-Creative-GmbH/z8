# Webhook Delivery Logs Dialog Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the webhook delivery logs dialog into a cohesive feature folder while preserving every existing loading, error, pagination, expansion, and formatting behavior.

**Architecture:** Keep the folder entry point as the sole public component. Put request lifecycle and mutable dialog state in a hook, then pass typed data and callbacks to stateless table, row, status-badge, and pagination components. Keep timezone formatting in the row so the presentation concern remains localized.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Luxon, Tolgee, Tabler Icons, existing Z8 UI primitives.

---

## File Structure

- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/index.tsx` - action-panel composition and UI state selection.
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/use-webhook-delivery-logs.ts` - delivery request lifecycle, page state, retries, and expanded rows.
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/delivery-logs-table.tsx` - table headings and delivery-row mapping.
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/delivery-log-row.tsx` - expandable table row, date formatting, and delivery details.
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/delivery-status-badge.tsx` - translated status badge selection.
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/delivery-logs-pagination.tsx` - shown-range text and previous/next controls.
- Move: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog.test.tsx` to `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/index.test.tsx` - regression coverage through the public entry point.
- Modify: `apps/webapp/src/components/webhooks/webhook-endpoint-card.tsx:44` - import the public dialog from the new folder entry point.
- Delete: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog.tsx` - superseded monolithic component.

### Task 1: Preserve The Public Contract In Its New Location

**Files:**
- Move: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog.test.tsx` to `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/index.test.tsx`
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/index.tsx`

- [ ] **Step 1: Move the existing regression test and change its relative component import**

```tsx
import { WebhookDeliveryLogsDialog } from "./index";
```

Keep every existing mock, helper, and assertion unchanged. The four cases must still cover offset `20`, stale response suppression, a retryable error, and page reset after switching webhook IDs.

- [ ] **Step 2: Add a failing entry-point stub and run the focused test**

```tsx
export function WebhookDeliveryLogsDialog() {
	return null;
}
```

Run: `pnpm --filter webapp test src/components/webhooks/webhook-delivery-logs-dialog/index.test.tsx`

Expected: FAIL because the stub renders no delivery rows, pagination controls, or retry action.

- [ ] **Step 3: Verify the moved test retains these externally visible expectations**

```tsx
await screen.findByText("page-1");
await user.click(screen.getByRole("button", { name: "Next" }));
await waitFor(() => {
	expect(mocks.getWebhookDeliveryLogs).toHaveBeenLastCalledWith("webhook-1", {
		limit: 20,
		offset: 20,
	});
});
```

Do not add unit tests for private presentation components. The public dialog test protects the behavior while leaving component internals freely composable.

### Task 2: Extract Request Lifecycle Into A Hook

**Files:**
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/use-webhook-delivery-logs.ts`
- Modify: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/index.tsx`

- [ ] **Step 1: Implement the hook with the existing request and pagination invariants**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { getWebhookDeliveryLogs } from "@/app/[locale]/(app)/settings/webhooks/actions";
import type { WebhookDelivery } from "@/lib/webhooks/types";

export const WEBHOOK_DELIVERY_LOGS_PAGE_SIZE = 20;

type Page = { webhookId: string; offset: number };
type DeliveryPage = { requestKey: string; deliveries: WebhookDelivery[]; total: number };
type RequestError = { requestKey: string; message: string };

export function useWebhookDeliveryLogs(webhookId: string, open: boolean) {
	const [isLoading, setIsLoading] = useState(false);
	const [page, setPage] = useState<Page>({ webhookId, offset: 0 });
	const [deliveryPage, setDeliveryPage] = useState<DeliveryPage>({
		requestKey: "",
		deliveries: [],
		total: 0,
	});
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
	const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
	const [requestError, setRequestError] = useState<RequestError | null>(null);
	const [retryToken, setRetryToken] = useState(0);
	const requestSequence = useRef(0);
	const latestLoadKey = useRef("");

	if (page.webhookId !== webhookId) {
		setPage({ webhookId, offset: 0 });
		setExpandedRows(new Set());
	}

	const offset = page.webhookId === webhookId ? page.offset : 0;
	const requestKey = `${webhookId}:${offset}`;
	const loadKey = `${requestKey}:${retryToken}`;
	const deliveries = deliveryPage.requestKey === requestKey ? deliveryPage.deliveries : [];
	const total = deliveryPage.requestKey === requestKey ? deliveryPage.total : 0;

	useEffect(() => {
		if (!open) return;

		const requestId = ++requestSequence.current;
		latestLoadKey.current = loadKey;
		let cancelled = false;

		void Promise.resolve().then(async () => {
			if (cancelled) return;
			setRequestError(null);
			setIsLoading(true);
			const result = await getWebhookDeliveryLogs(webhookId, {
				limit: WEBHOOK_DELIVERY_LOGS_PAGE_SIZE,
				offset,
			}).catch(() => null);
			if (cancelled || requestId !== requestSequence.current || loadKey !== latestLoadKey.current) return;
			if (result?.success && result.data) {
				setDeliveryPage({ requestKey, deliveries: result.data.deliveries, total: result.data.total });
			} else {
				setRequestError({ requestKey, message: result && !result.success ? result.error : "" });
			}
			setLoadedRequestKey(requestKey);
			setIsLoading(false);
		});

		return () => {
			cancelled = true;
			if (requestId === requestSequence.current) requestSequence.current += 1;
		};
	}, [loadKey, offset, open, requestKey, webhookId]);

	return {
		deliveries,
		total,
		offset,
		isLoading,
		hasRequestError: requestError?.requestKey === requestKey,
		errorMessage: requestError?.message,
		shouldShowInitialLoading: open && deliveries.length === 0 && loadedRequestKey !== requestKey,
		expandedRows,
		retry: () => setRetryToken((value) => value + 1),
		setOffset: (update: number | ((currentOffset: number) => number)) =>
			setPage((currentPage) => ({
				webhookId,
				offset:
					typeof update === "function"
						? update(currentPage.webhookId === webhookId ? currentPage.offset : 0)
						: update,
			})),
		toggleRow: (id: string) =>
			setExpandedRows((currentRows) => {
				const nextRows = new Set(currentRows);
				if (nextRows.has(id)) nextRows.delete(id);
				else nextRows.add(id);
				return nextRows;
			}),
	};
}
```

- [ ] **Step 2: Compose the hook in the entry point, retaining state precedence**

```tsx
const logs = useWebhookDeliveryLogs(webhookId, open);
const errorMessage =
	logs.errorMessage || t("webhooks:webhooks.logs.loadError", "Failed to load delivery logs");

{(logs.isLoading || logs.shouldShowInitialLoading) && logs.deliveries.length === 0 ? (
	<div className="flex items-center justify-center py-12">
		<IconLoader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
		<span className="sr-only">{t("common.loading", "Loading...")}</span>
	</div>
) : logs.hasRequestError ? (
	<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
		<p className="text-destructive">{errorMessage}</p>
		<Button variant="outline" size="sm" onClick={logs.retry}>
			{t("common.retry", "Retry")}
		</Button>
	</div>
) : logs.deliveries.length === 0 ? (
	<div className="flex flex-col items-center justify-center py-12 text-center">
		<p className="text-muted-foreground">{t("webhooks:webhooks.logs.empty", "No delivery logs yet")}</p>
	</div>
) : (
	<DeliveryLogsTable
		deliveries={logs.deliveries}
		expandedRows={logs.expandedRows}
		onToggleRow={logs.toggleRow}
	/>
)}
```

Keep the loading-before-error order and only show the full-screen spinner when no deliveries are currently displayed.

- [ ] **Step 3: Run the focused test**

Run: `pnpm --filter webapp test src/components/webhooks/webhook-delivery-logs-dialog/index.test.tsx`

Expected: FAIL until the missing presentation components in the entry point are implemented, while the hook compiles independently.

### Task 3: Extract Delivery Table And Row Presentation

**Files:**
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/delivery-logs-table.tsx`
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/delivery-log-row.tsx`
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/delivery-status-badge.tsx`

- [ ] **Step 1: Implement the translated status badge**

```tsx
"use client";

import { IconCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";

export function DeliveryStatusBadge({ status }: { status: string }) {
	const { t } = useTranslate();
	if (status === "success") {
		return <Badge variant="default" className="bg-green-600"><IconCheck className="mr-1 size-3" aria-hidden="true" />{t("webhooks:webhooks.logs.success", "Success")}</Badge>;
	}
	if (status === "failed") {
		return <Badge variant="destructive"><IconX className="mr-1 size-3" aria-hidden="true" />{t("webhooks:webhooks.logs.failed", "Failed")}</Badge>;
	}
	if (status === "retrying") {
		return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><IconRefresh className="mr-1 size-3" aria-hidden="true" />{t("webhooks:webhooks.logs.retrying", "Retrying")}</Badge>;
	}
	return <Badge variant="secondary"><IconLoader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />{t("webhooks:webhooks.logs.pending", "Pending")}</Badge>;
}
```

- [ ] **Step 2: Implement one expandable delivery row, preserving date and detail rendering**

```tsx
export function DeliveryLogRow({
	delivery,
	open,
	onOpenChange,
}: {
	delivery: WebhookDelivery;
	open: boolean;
	onOpenChange: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const timezone = useOrganizationTimezone();

	return (
		<Collapsible open={open} onOpenChange={onOpenChange} asChild>
				<CollapsibleTrigger asChild>
					<TableRow className="cursor-pointer hover:bg-muted/50">
						<TableCell className="font-mono text-xs">
							{DateTime.fromJSDate(delivery.createdAt, { zone: "utc" }).setZone(timezone).setLocale(locale).toFormat("MMM d, HH:mm:ss")}
						</TableCell>
						<TableCell className="font-mono text-xs">{delivery.eventType}</TableCell>
						<TableCell><DeliveryStatusBadge status={delivery.status} /></TableCell>
						<TableCell>{delivery.httpStatus ? <span className={delivery.httpStatus >= 200 && delivery.httpStatus < 300 ? "text-green-600" : "text-red-600"}>{delivery.httpStatus}</span> : "-"}</TableCell>
						<TableCell>{delivery.durationMs ? `${delivery.durationMs}ms` : "-"}</TableCell>
						<TableCell>{delivery.attemptNumber}/{delivery.maxAttempts}</TableCell>
					</TableRow>
				</CollapsibleTrigger>
				<CollapsibleContent asChild>
					<TableRow className="bg-muted/30">
						<TableCell colSpan={6} className="p-4">
							<div className="space-y-3">
								{delivery.errorMessage && <div><span className="text-sm font-medium text-red-600">{t("webhooks:webhooks.logs.error", "Error")}:</span><p className="text-sm text-muted-foreground">{delivery.errorMessage}</p></div>}
								<div><span className="text-sm font-medium">{t("webhooks:webhooks.logs.payload", "Payload")}:</span><pre className="mt-1 max-h-40 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(delivery.payload, null, 2)}</pre></div>
								{delivery.responseBody && <div><span className="text-sm font-medium">{t("webhooks:webhooks.logs.response", "Response")}:</span><pre className="mt-1 max-h-40 overflow-x-auto rounded bg-muted p-2 text-xs">{delivery.responseBody}</pre></div>}
							</div>
						</TableCell>
					</TableRow>
				</CollapsibleContent>
		</Collapsible>
	);
}
```

Keep the original `Collapsible` child structure and `colSpan={6}` unchanged.

- [ ] **Step 3: Implement the table shell and map every delivery to the row component**

```tsx
export function DeliveryLogsTable({
	deliveries,
	expandedRows,
	onToggleRow,
}: {
	deliveries: WebhookDelivery[];
	expandedRows: Set<string>;
	onToggleRow: (id: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<Table>
			<TableHeader><TableRow>
				<TableHead className="w-[140px]">{t("webhooks:webhooks.logs.time", "Time")}</TableHead>
				<TableHead className="w-[180px]">{t("webhooks:webhooks.logs.event", "Event")}</TableHead>
				<TableHead className="w-[100px]">{t("webhooks:webhooks.logs.status", "Status")}</TableHead>
				<TableHead className="w-[80px]">{t("webhooks:webhooks.logs.http", "HTTP")}</TableHead>
				<TableHead className="w-[80px]">{t("webhooks:webhooks.logs.duration", "Duration")}</TableHead>
				<TableHead className="w-[80px]">{t("webhooks:webhooks.logs.attempt", "Attempt")}</TableHead>
			</TableRow></TableHeader>
			<TableBody>{deliveries.map((delivery) => <DeliveryLogRow key={delivery.id} delivery={delivery} open={expandedRows.has(delivery.id)} onOpenChange={() => onToggleRow(delivery.id)} />)}</TableBody>
		</Table>
	);
}
```

- [ ] **Step 4: Run the focused regression test**

Run: `pnpm --filter webapp test src/components/webhooks/webhook-delivery-logs-dialog/index.test.tsx`

Expected: PASS for all four public behavior cases.

### Task 4: Extract Pagination And Finalize The Entry Point

**Files:**
- Create: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/delivery-logs-pagination.tsx`
- Modify: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog/index.tsx`

- [ ] **Step 1: Implement pagination with the unchanged disabled states and range**

```tsx
"use client";

import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { WEBHOOK_DELIVERY_LOGS_PAGE_SIZE } from "./use-webhook-delivery-logs";

export function DeliveryLogsPagination({
	deliveriesCount,
	total,
	offset,
	isLoading,
	onOffsetChange,
}: {
	deliveriesCount: number;
	total: number;
	offset: number;
	isLoading: boolean;
	onOffsetChange: (update: (currentOffset: number) => number) => void;
}) {
	const { t } = useTranslate();
	if (total <= WEBHOOK_DELIVERY_LOGS_PAGE_SIZE) return null;
	return (
		<div className="flex items-center justify-between border-t pt-4">
			<p className="text-sm text-muted-foreground">{t("webhooks:webhooks.logs.showing", "Showing {{start}}-{{end}} of {{total}}", { start: offset + 1, end: Math.min(offset + deliveriesCount, total), total })}</p>
			<div className="flex gap-2">
				<Button variant="outline" size="sm" onClick={() => onOffsetChange((currentOffset) => Math.max(0, currentOffset - WEBHOOK_DELIVERY_LOGS_PAGE_SIZE))} disabled={offset === 0 || isLoading}>{t("common.previous", "Previous")}</Button>
				<Button variant="outline" size="sm" onClick={() => onOffsetChange((currentOffset) => currentOffset + WEBHOOK_DELIVERY_LOGS_PAGE_SIZE)} disabled={offset + WEBHOOK_DELIVERY_LOGS_PAGE_SIZE >= total || isLoading}>{t("common.next", "Next")}</Button>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Complete the action-panel entry point and use the extracted pieces**

```tsx
export function WebhookDeliveryLogsDialog({ webhookId, webhookName, open, onOpenChange }: WebhookDeliveryLogsDialogProps) {
	const { t } = useTranslate();
	const logs = useWebhookDeliveryLogs(webhookId, open);
	const errorMessage = logs.errorMessage || t("webhooks:webhooks.logs.loadError", "Failed to load delivery logs");

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>{t("webhooks:webhooks.logs.title", "Delivery Logs")} - {webhookName}</ActionPanelTitle>
					<ActionPanelDescription>{t("webhooks:webhooks.logs.description", "Recent webhook delivery attempts and their results.")}</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody>
					{(logs.isLoading || logs.shouldShowInitialLoading) && logs.deliveries.length === 0 ? (
						<div className="flex items-center justify-center py-12"><IconLoader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" /><span className="sr-only">{t("common.loading", "Loading...")}</span></div>
					) : logs.hasRequestError ? (
						<div className="flex flex-col items-center justify-center gap-3 py-12 text-center"><p className="text-destructive">{errorMessage}</p><Button variant="outline" size="sm" onClick={logs.retry}>{t("common.retry", "Retry")}</Button></div>
					) : logs.deliveries.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center"><p className="text-muted-foreground">{t("webhooks:webhooks.logs.empty", "No delivery logs yet")}</p></div>
					) : (
						<DeliveryLogsTable deliveries={logs.deliveries} expandedRows={logs.expandedRows} onToggleRow={logs.toggleRow} />
					)}
				</ActionPanelBody>
				<DeliveryLogsPagination deliveriesCount={logs.deliveries.length} total={logs.total} offset={logs.offset} isLoading={logs.isLoading} onOffsetChange={logs.setOffset} />
			</ActionPanelContent>
		</ActionPanel>
	);
}
```

Import `IconLoader2`, `Button`, `DeliveryLogsPagination`, `DeliveryLogsTable`, and `useWebhookDeliveryLogs` in this entry point. Keep the states inline because they are specific to this action panel.

- [ ] **Step 3: Run focused tests and typecheck**

Run: `pnpm --filter webapp test src/components/webhooks/webhook-delivery-logs-dialog/index.test.tsx && pnpm --filter webapp typecheck`

Expected: all four Vitest cases pass and TypeScript exits with code `0`.

### Task 5: Update Consumer And Remove The Monolith

**Files:**
- Modify: `apps/webapp/src/components/webhooks/webhook-endpoint-card.tsx:44`
- Delete: `apps/webapp/src/components/webhooks/webhook-delivery-logs-dialog.tsx`

- [ ] **Step 1: Point the card at the explicit folder entry point**

```tsx
import { WebhookDeliveryLogsDialog } from "./webhook-delivery-logs-dialog";
```

This import remains textually unchanged because TypeScript resolves the new folder's `index.tsx`; verify no source import targets the deleted `.tsx` file through an extension-specific path.

- [ ] **Step 2: Delete the monolithic component and confirm only the folder entry exports the dialog**

Run: `rg "WebhookDeliveryLogsDialog" apps/webapp/src/components/webhooks`

Expected: the endpoint card, the new `index.tsx`, and the moved test reference the dialog; the former standalone dialog file is absent.

- [ ] **Step 3: Run final focused validation and inspect the diff**

Run: `pnpm --filter webapp test src/components/webhooks/webhook-delivery-logs-dialog/index.test.tsx && pnpm --filter webapp typecheck && git diff --check && git diff -- apps/webapp/src/components/webhooks`

Expected: test and typecheck commands exit with code `0`, whitespace validation produces no output, and the diff contains only the new feature folder, the removed monolith, the relocated test, and any necessary import adjustment.

- [ ] **Step 4: Commit the refactor**

```bash
git add apps/webapp/src/components/webhooks
git commit -m "refactor: split webhook delivery logs dialog"
```
