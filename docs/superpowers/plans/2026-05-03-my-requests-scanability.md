# My Requests Scanability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `My Requests` page easier to scan by replacing the wide all-requests table with prioritized grouped sections and responsive request cards.

**Architecture:** Keep the existing server route, query service, normalized item contract, and server actions unchanged. Refactor `my-requests-client.tsx` to compute filtered groups client-side and render reusable request-card rows for `Needs attention`, `In review`, `Recently decided`, and `All requests`.

**Tech Stack:** Next.js app router, React 19, TypeScript, Vitest, Testing Library, Luxon, Tolgee, existing shadcn/ui components, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`
  Adds client-side grouping helpers, a shared request-card component, section rendering, and removes the table-only presentation.
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`
  Updates UI tests from table-row assumptions to grouped section and card assertions.

No database, server action, route, sidebar, or query-service files should change.

## Task 1: Grouping Helpers And Tests

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`

- [ ] **Step 1: Add failing grouped-section test coverage**

In `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`, replace the existing test named `renders summary cards, needs-attention items, and unified rows` with this test:

```tsx
it("renders requests in prioritized groups and all-request history", () => {
	render(<MyRequestsClient initialResult={createResult()} />);

	expect(screen.getByRole("heading", { name: "My Requests" })).toBeTruthy();
	expect(screen.getByText("Pending")).toBeTruthy();
	expect(screen.getByText("Required fixes")).toBeTruthy();

	const needsAttention = screen.getByRole("region", { name: "Needs attention" });
	expect(within(needsAttention).getByText("Coverage needed")).toBeTruthy();
	expect(within(needsAttention).getByRole("link", { name: "Fix" }).getAttribute("href")).toBe(
		"/absences",
	);

	const inReview = screen.getByRole("region", { name: "In review" });
	expect(within(inReview).getByText("Time correction request")).toBeTruthy();

	const recentlyDecided = screen.getByRole("region", { name: "Recently decided" });
	expect(within(recentlyDecided).getByText("Travel expense claim")).toBeTruthy();

	const allRequests = screen.getByRole("region", { name: "All requests" });
	expect(within(allRequests).getByText("Time correction request")).toBeTruthy();
	expect(within(allRequests).getByText("Travel expense claim")).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused UI test and verify it fails**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: FAIL because `In review`, `Recently decided`, and region-labelled grouped sections do not exist yet.

- [ ] **Step 3: Add grouping constants and helper functions**

In `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`, add this constant after the `statusLabels` object:

```tsx
const RECENT_DECISION_DAYS = 30;
```

Add these helper functions after `formatTravelExpenseSubtitle`:

```tsx
function isRecentlyDecided(item: SelfServiceRequestItem, now: Date) {
	if ((item.status !== "approved" && item.status !== "rejected") || item.resolvedAt === null) {
		return false;
	}

	const cutoff = DateTime.fromJSDate(now).minus({ days: RECENT_DECISION_DAYS });
	return DateTime.fromJSDate(item.resolvedAt) >= cutoff;
}

function groupRequestItems(items: SelfServiceRequestItem[], now: Date) {
	return {
		needsAttention: items.filter((item) => item.status === "rejected"),
		inReview: items.filter((item) => item.status === "pending"),
		recentlyDecided: items.filter((item) => isRecentlyDecided(item, now)),
		all: items,
	};
}
```

Inside `MyRequestsClient`, immediately after `const rejectedItems = filteredItems.filter((item) => item.status === "rejected");`, replace that rejected-only line with:

```tsx
const groupedItems = groupRequestItems(filteredItems, new Date());
```

- [ ] **Step 4: Run the focused UI test and verify the failure has moved**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: FAIL remains because grouped rendering still does not exist, but TypeScript should not report missing `groupedItems` or helper definitions after the next rendering task is completed.

- [ ] **Step 5: Commit helper and test setup**

Only commit if the user explicitly asked for commits in the current session. If commits are requested, run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx' 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
git commit -m "test: cover grouped my requests sections"
```

## Task 2: Request Card Component

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`

- [ ] **Step 1: Add card metadata assertions to the existing date test**

In `my-requests-client.test.tsx`, update `formats request dates with the active locale` to assert card metadata:

```tsx
it("formats request dates with the active locale", () => {
	render(<MyRequestsClient initialResult={createResult()} />);

	expect(screen.getAllByText("18. Apr. 2026").length).toBeGreaterThan(0);
	expect(screen.getAllByText("22. Apr. 2026").length).toBeGreaterThan(0);
	expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
	expect(screen.getAllByText("Decision").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the focused UI test and verify it fails**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: FAIL because request card metadata labels are not rendered yet.

- [ ] **Step 3: Add the reusable request card component**

In `my-requests-client.tsx`, add this component above `SummaryCard`:

```tsx
function RequestCard({ item, preferFix = false }: { item: SelfServiceRequestItem; preferFix?: boolean }) {
	const { t } = useTranslate();
	const locale = useLocale();

	return (
		<article className="rounded-lg border bg-background p-4 shadow-xs">
			<div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
				<div className="min-w-0 space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="outline">
							{t(sourceTypeLabels[item.sourceType].key, sourceTypeLabels[item.sourceType].fallback)}
						</Badge>
						<StatusBadge status={item.status} />
					</div>
					<div className="space-y-1">
						<h3 className="font-medium text-base leading-tight">{requestTitle(item, t)}</h3>
						<p className="break-words text-muted-foreground text-sm">
							{requestSubtitle(item, locale, t)}
						</p>
						{item.decisionReason ? (
							<p className="break-words text-sm">
								<span className="font-medium">{t("myRequests.reasonLabel", "Reason")}:</span>{" "}
								{item.decisionReason}
							</p>
						) : null}
					</div>
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
						<span>
							{t("myRequests.card.submitted", "Submitted")}: {formatDate(item.submittedAt, locale)}
						</span>
						{item.resolvedAt ? (
							<span>
								{t("myRequests.card.decision", "Decision")}: {formatDate(item.resolvedAt, locale)}
							</span>
						) : null}
					</div>
				</div>
				<RequestAction item={item} preferFix={preferFix} />
			</div>
		</article>
	);
}
```

- [ ] **Step 4: Run the focused UI test and verify remaining failures**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: FAIL remains because `RequestCard` has not been used in grouped sections yet.

- [ ] **Step 5: Commit card component**

Only commit if the user explicitly asked for commits in the current session. If commits are requested, run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx' 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
git commit -m "feat: add my requests card presentation"
```

## Task 3: Grouped Section Rendering

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`

- [ ] **Step 1: Add filter consistency test for grouped cards**

In `my-requests-client.test.tsx`, replace `filters by status` with:

```tsx
it("applies filters consistently to grouped sections and all-request history", () => {
	render(<MyRequestsClient initialResult={createResult()} />);

	fireEvent.change(screen.getByLabelText("Status"), { target: { value: "pending" } });

	const inReview = screen.getByRole("region", { name: "In review" });
	expect(within(inReview).getByText("Time correction request")).toBeTruthy();
	expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
	expect(screen.queryByRole("region", { name: "Recently decided" })).toBeNull();

	const allRequests = screen.getByRole("region", { name: "All requests" });
	expect(within(allRequests).getByText("Time correction request")).toBeTruthy();
	expect(within(allRequests).queryByText("Vacation")).toBeNull();
});
```

- [ ] **Step 2: Run the focused UI test and verify it fails**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: FAIL until grouped sections are rendered as labelled regions.

- [ ] **Step 3: Add a reusable request section component**

In `my-requests-client.tsx`, add this component above `RequestCard`:

```tsx
function RequestSection({
	title,
	description,
	items,
	preferFix = false,
	tone = "default",
}: {
	title: string;
	description: string;
	items: SelfServiceRequestItem[];
	preferFix?: boolean;
	tone?: "default" | "attention";
}) {
	if (items.length === 0) {
		return null;
	}

	return (
		<section aria-label={title} className="px-4 lg:px-6">
			<Card className={tone === "attention" ? "border-destructive/30 bg-destructive/5" : undefined}>
				<CardHeader>
					<CardTitle>{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{items.map((item) => (
						<RequestCard key={item.id} item={item} preferFix={preferFix} />
					))}
				</CardContent>
			</Card>
		</section>
	);
}
```

- [ ] **Step 4: Replace the old needs-attention block and table block with grouped sections**

In `my-requests-client.tsx`, remove the existing `rejectedItems` rendering block and replace the entire `<section className="px-4 lg:px-6">` that contains the `All requests` table with this sequence after the source error notice:

```tsx
<section className="px-4 lg:px-6">
	<Card>
		<CardHeader>
			<CardTitle>{t("myRequests.filters.title", "Find requests")}</CardTitle>
			<CardDescription>
				{t(
					"myRequests.filters.description",
					"Filter every request section by text, status, or request type.",
				)}
			</CardDescription>
		</CardHeader>
		<CardContent>
			<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
				<label htmlFor="request-search" className="grid gap-2 text-sm font-medium">
					{t("myRequests.filters.search", "Search")}
					<Input
						id="request-search"
						name="request-search"
						autoComplete="off"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder={t("myRequests.filters.searchPlaceholder", "Search by title…")}
					/>
				</label>
				<label className="grid gap-2 text-sm font-medium">
					{t("myRequests.filters.status", "Status")}
					<select
						className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
						value={statusFilter}
						onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
					>
						<option value="all">{t("myRequests.filters.allStatuses", "All statuses")}</option>
						<option value="pending">{t("myRequests.filters.pendingRequests", "Pending requests")}</option>
						<option value="approved">{t("myRequests.filters.approvedRequests", "Approved requests")}</option>
						<option value="rejected">{t("myRequests.filters.rejectedRequests", "Rejected requests")}</option>
						<option value="cancelled">{t("myRequests.filters.cancelledRequests", "Cancelled requests")}</option>
					</select>
				</label>
				<label className="grid gap-2 text-sm font-medium">
					{t("myRequests.filters.type", "Type")}
					<select
						className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
						value={sourceTypeFilter}
						onChange={(event) => setSourceTypeFilter(event.target.value as SourceTypeFilter)}
					>
						<option value="all">{t("myRequests.filters.allTypes", "All types")}</option>
						<option value="absence">{t("myRequests.sourceTypes.absence", "Absence")}</option>
						<option value="time_correction">{t("myRequests.sourceTypes.timeCorrection", "Time")}</option>
						<option value="travel_expense">{t("myRequests.sourceTypes.travelExpense", "Expense")}</option>
					</select>
				</label>
			</div>
		</CardContent>
	</Card>
</section>

{initialResult.items.length === 0 ? (
	<section className="px-4 lg:px-6">
		<EmptyState
			title={t("myRequests.empty.none.title", "No requests yet")}
			description={t(
				"myRequests.empty.none.description",
				"Requests will appear here when they are submitted or loaded.",
			)}
		/>
	</section>
) : filteredItems.length === 0 ? (
	<section className="px-4 lg:px-6">
		<EmptyState
			title={t("myRequests.empty.filtered.title", "No requests match your filters")}
			description={t(
				"myRequests.empty.filtered.description",
				"Requests will appear here when they are submitted or loaded.",
			)}
		/>
	</section>
) : (
	<>
		<RequestSection
			title={t("myRequests.needsAttention.title", "Needs attention")}
			description={t(
				"myRequests.needsAttention.description",
				"Rejected requests that may require a correction before resubmission.",
			)}
			items={groupedItems.needsAttention}
			preferFix
			tone="attention"
		/>
		<RequestSection
			title={t("myRequests.inReview.title", "In review")}
			description={t(
				"myRequests.inReview.description",
				"Requests waiting for approval or processing.",
			)}
			items={groupedItems.inReview}
		/>
		<RequestSection
			title={t("myRequests.recentlyDecided.title", "Recently decided")}
			description={t(
				"myRequests.recentlyDecided.description",
				"Approved and rejected decisions from the last 30 days.",
			)}
			items={groupedItems.recentlyDecided}
		/>
		<RequestSection
			title={t("myRequests.all.title", "All requests")}
			description={t(
				"myRequests.all.description",
				"Review requests across absences, time corrections, and expenses.",
			)}
			items={groupedItems.all}
		/>
	</>
)}
```

Ensure the old imports from `@/components/ui/table` are removed because the table is no longer rendered.

- [ ] **Step 5: Run the focused UI test and verify it passes or exposes outdated table assumptions**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: Some tests may still fail because older tests use `getByRole("row")`; update those in Task 4.

- [ ] **Step 6: Commit grouped rendering**

Only commit if the user explicitly asked for commits in the current session. If commits are requested, run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx' 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
git commit -m "feat: group my requests by status"
```

## Task 4: Update Action And Empty-State Tests

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`

- [ ] **Step 1: Update unsupported-action test away from table rows**

Replace `does not render unsupported actions` with:

```tsx
it("does not render unsupported actions", () => {
	render(<MyRequestsClient initialResult={createResult()} />);

	const inReview = screen.getByRole("region", { name: "In review" });
	const timeCard = within(inReview).getByText("Time correction request").closest("article");
	expect(timeCard).not.toBeNull();
	expect(within(timeCard as HTMLElement).queryByRole("link", { name: "Fix" })).toBeNull();
});
```

- [ ] **Step 2: Update cancel-action test away from table rows**

In `renders cancel for pending absence requests only`, replace row lookups with article lookups:

```tsx
const inReview = screen.getByRole("region", { name: "In review" });
const absenceCard = within(inReview).getByText("Pending vacation").closest("article");
expect(absenceCard).not.toBeNull();
fireEvent.click(within(absenceCard as HTMLElement).getByRole("button", { name: "Cancel" }));

expect(window.confirm).toHaveBeenCalledWith("Cancel this absence request?");
await waitFor(() => {
	expect(cancelMyAbsenceRequestMock).toHaveBeenCalledWith("absence-pending");
});
const timeCard = within(inReview).getByText("Time correction request").closest("article");
expect(timeCard).not.toBeNull();
expect(within(timeCard as HTMLElement).queryByRole("button", { name: "Cancel" })).toBeNull();
```

- [ ] **Step 3: Keep empty-state test expectations unchanged**

Confirm `distinguishes empty and filtered-empty states` still asserts:

```tsx
expect(screen.getByText("No requests yet")).toBeTruthy();
expect(screen.getByText("No requests match your filters")).toBeTruthy();
```

- [ ] **Step 4: Run focused UI tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: PASS with all `MyRequestsClient` tests passing.

- [ ] **Step 5: Commit updated tests**

Only commit if the user explicitly asked for commits in the current session. If commits are requested, run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
git commit -m "test: update my requests card interactions"
```

## Task 5: Full Feature Verification

**Files:**
- Verify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`
- Verify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`
- Verify: `apps/webapp/src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts`

- [ ] **Step 1: Run UI tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: PASS with all `MyRequestsClient` tests passing.

- [ ] **Step 2: Run query-service tests to confirm no data regression**

Run:

```bash
pnpm --filter webapp test src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts
```

Expected: PASS with all self-service request service tests passing.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git diff -- 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx' 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: Diff only changes grouped presentation and tests. It must not change authentication, organization scoping, server actions, or source adapters.

- [ ] **Step 4: Final commit**

Only commit if the user explicitly asked for commits in the current session. If commits are requested, run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx' 'apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
git commit -m "feat: improve my requests scanability"
```

## Self-Review Notes

- Spec coverage: The plan covers grouped sections, cards, filters, empty states, cancellation behavior, source errors, responsive card semantics, and no query-service changes.
- Placeholder scan: No open placeholders are intended; every task includes exact files, commands, and expected outcomes.
- Type consistency: The plan uses existing `SelfServiceRequestItem`, `SelfServiceRequestStatus`, `RequestAction`, `StatusBadge`, `formatDate`, `requestTitle`, and `requestSubtitle` names from `my-requests-client.tsx`.
