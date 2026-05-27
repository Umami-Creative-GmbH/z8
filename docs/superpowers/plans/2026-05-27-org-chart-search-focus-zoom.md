# Org Chart Search Focus Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Center the org chart viewport at a readable fixed zoom when an employee is selected from search.

**Architecture:** Keep the existing graph merge and initial full-chart `fitView` behavior. Change only the search-selected focus effect to center the selected employee node with React Flow `setCenter`, using the known node dimensions to target the node center.

**Tech Stack:** React, React Flow, Vitest, Testing Library, TypeScript.

---

### Task 1: Search Focus Viewport

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx`

- [ ] **Step 1: Write the failing test**

Update the React Flow mock to expose `setCenterMock`, and change the search selection test so it expects `setCenter` instead of `fitView` for search-selected nodes.

```tsx
const { searchMock, employeeNeighborhoodMock, teamNeighborhoodMock, fitViewMock, setCenterMock } = vi.hoisted(() => ({
	searchMock: vi.fn(),
	employeeNeighborhoodMock: vi.fn(),
	teamNeighborhoodMock: vi.fn(),
	fitViewMock: vi.fn(),
	setCenterMock: vi.fn(),
}));

useReactFlow: () => ({ fitView: fitViewMock, setCenter: setCenterMock }),

expect(setCenterMock).toHaveBeenCalledWith(130, 70, {
	zoom: 1.05,
	duration: 240,
});
expect(fitViewMock).not.toHaveBeenCalledWith(
	expect.objectContaining({ nodes: [expect.objectContaining({ id: "employee:emp-2" })] }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx'`

Expected: FAIL because `setCenter` is not called for search focus yet.

- [ ] **Step 3: Write minimal implementation**

In `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx`, add a focused zoom constant and replace the search focus `fitView` call.

```tsx
const FLOW_SEARCH_FOCUS_ZOOM = 1.05;

reactFlow.setCenter(
	focusNode.position.x + NODE_WIDTH / 2,
	focusNode.position.y + NODE_HEIGHT / 2,
	{
		zoom: FLOW_SEARCH_FOCUS_ZOOM,
		duration: 240,
	},
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx'`

Expected: PASS.

- [ ] **Step 5: Run org chart regression tests**

Run: `pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx' 'src/app/[locale]/(app)/organization/org-chart-graph.test.ts'`

Expected: PASS with 2 test files and 28 tests.
