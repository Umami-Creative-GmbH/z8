# Approval Inbox Panels Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `ApprovalInboxContent` into a stateful controller and a focused panel renderer without changing inbox behavior.

**Architecture:** Keep queries, reducer state, derived selections, mutations, and every event handler in `ApprovalInboxContent`. Add an `ApprovalInboxPanels` component in the same module, with explicitly typed props for the already-derived values and callbacks, and move only the final JSX panel tree into it.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest, Testing Library, React Doctor.

---

### Task 1: Preserve Inbox Interaction Coverage

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx:644-987`

- [ ] **Step 1: Add a regression assertion for panel callbacks in the existing page test**

Extend the existing mocked `ApprovalInboxToolbar` or fast-lane interaction test to select an item, invoke its bulk action, and assert the existing `bulkApproveMutateAsyncMock` receives the selected approval ID. Keep the current page import and mocks so the test verifies the public page behavior through `ApprovalInboxPage`.

```tsx
fireEvent.click(screen.getByRole("button", { name: "Select All" }));
fireEvent.click(screen.getByRole("button", { name: /bulk approve/i }));

await waitFor(() =>
	expect(bulkApproveMutateAsyncMock).toHaveBeenCalledWith(["approval-1"]),
);
```

- [ ] **Step 2: Run the focused test before the refactor**

Run: `pnpm test --run src/app/[locale]/\(app\)/approvals/inbox/page.test.tsx`

Expected: PASS. This records current page behavior before moving the panel tree.

- [ ] **Step 3: Define the focused panel component and props**

Above `ApprovalInboxContent` in `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`, add `ApprovalInboxPanels` and its prop type. Include the derived values required by the five panel calls and callbacks such as `onBulkApprove`, `onOpenBulkReject`, `onFiltersChange`, `onSelectItem`, and `onActioned`. Use the existing `ApprovalInboxItem`, `ApprovalInboxWarning`, `ApprovalInboxType`, `ApprovalInboxFilters`, and `ReturnType<typeof useTranslate>["t"]` types rather than introducing duplicate domain types.

```tsx
type ApprovalInboxPanelsProps = {
	t: ReturnType<typeof useTranslate>["t"];
	items: ApprovalInboxItem[];
	warnings: ApprovalInboxWarning[];
	totalCount: number;
	fastLaneGroups: ApprovalInboxFastLaneGroupView[];
	filters: ApprovalInboxFilters;
	selectedIds: Set<string>;
	supportedTypes: ApprovalInboxType[];
	selectedCount: number;
	sprintItems: ApprovalInboxItem[];
	detailApproval: ApprovalInboxItem | null;
	sprintOpen: boolean;
	bulkRejectOpen: boolean;
	bulkRejectReason: string;
	isBulkActionPending: boolean;
	canBulkApproveSelection: boolean;
	canBulkRejectSelection: boolean;
	isBulkApprovePending: boolean;
	isBulkRejectPending: boolean;
	isFetching: boolean;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	onBulkApprove: () => Promise<void>;
	onFastLaneApprove: (approvalIds: string[]) => Promise<void>;
	onFastLaneReject: (approvalIds: string[], reason: string) => Promise<void>;
	onFiltersChange: (filters: ApprovalInboxFilters) => void;
	onSelectAll: (checked: boolean) => void;
	onSelectItem: (id: string, checked: boolean) => void;
	onOpenDetail: (approval: ApprovalInboxItem) => void;
	onCloseDetail: () => void;
	onFetchNextPage: () => void;
	onRefresh: () => void;
	onOpenBulkReject: () => void;
	onBulkRejectOpenChange: (open: boolean) => void;
	onBulkRejectReasonChange: (reason: string) => void;
	onBulkReject: () => Promise<void>;
	onSprintOpenChange: (open: boolean) => void;
};

function ApprovalInboxPanels(props: ApprovalInboxPanelsProps) {
	return <div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6" />;
}
```

- [ ] **Step 4: Move only the final panel JSX into `ApprovalInboxPanels`**

Move the JSX currently returned by `ApprovalInboxContent` after its loading and error branches into `ApprovalInboxPanels`. Replace the parent return with the child call, passing all existing values and handlers unchanged.

```tsx
return (
	<ApprovalInboxPanels
		t={t}
		items={items}
		warnings={warnings}
		totalCount={totalCount}
		fastLaneGroups={fastLaneGroups}
		filters={uiState.filters}
		selectedIds={selectedIds}
		supportedTypes={supportedTypes}
		selectedCount={selectedIds.size}
		sprintItems={sprintItems}
		detailApproval={uiState.detailApproval}
		sprintOpen={uiState.sprintOpen}
		bulkRejectOpen={uiState.bulkRejectOpen}
		bulkRejectReason={uiState.bulkRejectReason}
		isBulkActionPending={isBulkActionPending}
		canBulkApproveSelection={canBulkApproveSelection}
		canBulkRejectSelection={canBulkRejectSelection}
		isBulkApprovePending={bulkApproveMutation.isPending}
		isBulkRejectPending={bulkRejectMutation.isPending}
		isFetching={isFetching}
		hasNextPage={!!hasNextPage}
		isFetchingNextPage={isFetchingNextPage}
		onBulkApprove={handleBulkApprove}
		onFastLaneApprove={handleFastLaneApprove}
		onFastLaneReject={handleFastLaneReject}
		onFiltersChange={handleFiltersChange}
		onSelectAll={handleSelectAll}
		onSelectItem={handleSelectItem}
		onOpenDetail={handleOpenDetail}
		onCloseDetail={handleCloseDetail}
		onFetchNextPage={() => fetchNextPage()}
		onRefresh={() => refetch()}
		onOpenBulkReject={() => dispatch({ type: "bulkRejectOpenChanged", open: true })}
		onBulkRejectOpenChange={(open) => dispatch({ type: "bulkRejectOpenChanged", open })}
		onBulkRejectReasonChange={(reason) => dispatch({ type: "bulkRejectReasonChanged", reason })}
		onBulkReject={handleBulkReject}
		onSprintOpenChange={(open) => dispatch({ type: "sprintOpenChanged", open })}
	/>
);
```

Do not move `useApprovalInbox`, mutation hooks, reducer dispatches, derived selection calculations, error branches, or toast-producing functions out of `ApprovalInboxContent`.

- [ ] **Step 5: Run the focused page test after the refactor**

Run: `pnpm test --run src/app/[locale]/\(app\)/approvals/inbox/page.test.tsx`

Expected: PASS with all existing and new page interaction tests.

- [ ] **Step 6: Format and type-check the changed module**

Run: `pnpm exec biome check src/app/[locale]/\(app\)/approvals/inbox/page.tsx src/app/[locale]/\(app\)/approvals/inbox/page.test.tsx`

Run: `pnpm typecheck`

Expected: both commands exit 0.

- [ ] **Step 7: Verify React Doctor and commit the refactor**

Run: `npx react-doctor@latest --verbose --scope changed`

Expected: `react-doctor/no-giant-component` no longer reports `ApprovalInboxContent`; no new diagnostic is introduced by `page.tsx`.

```bash
git add "apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx" "apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.test.tsx"
git commit -m "refactor: split approval inbox panels"
```
