# Org Chart Manager Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manager relationships visibly connect employee cards in the `/organization` org explorer.

**Architecture:** Keep the existing organization-scoped graph data model unchanged. Add React Flow handles to employee cards so existing `manager` edges can anchor from manager cards to employee cards, and extend the existing client test mock to verify the handles render.

**Tech Stack:** Next.js 16, React 19, `@xyflow/react`, Vitest, Testing Library, Tailwind CSS.

---

## File Structure

- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx`
  - Responsibility: Render the org chart React Flow graph and custom employee/team cards.
  - Change: Import `Handle` and `Position` from `@xyflow/react`; render one source and one target handle on each employee card.
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx`
  - Responsibility: Unit test the client graph behavior using a mocked React Flow implementation.
  - Change: Add mocked `Handle` and `Position` exports; assert manager graph employee nodes expose source and target handles.

## Task 1: Add Test Coverage For Employee Manager Handles

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx:54-99`
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx:247-259`

- [ ] **Step 1: Extend the React Flow mock with handles**

Replace the existing `vi.mock("@xyflow/react", () => ({ ... }))` block with this version. It preserves the current mock behavior and adds `Handle` and `Position` exports that render testable DOM nodes.

```tsx
vi.mock("@xyflow/react", () => ({
	Background: () => <div data-testid="flow-background" />,
	Controls: (props: { className?: string; position?: string }) => (
		<div data-position={props.position} data-testid="flow-controls" className={props.className} />
	),
	Handle: (props: { className?: string; position?: string; type: string }) => (
		<div
			className={props.className}
			data-position={props.position}
			data-testid={`flow-handle-${props.type}-${props.position}`}
		/>
	),
	MarkerType: { ArrowClosed: "arrowclosed" },
	MiniMap: (props: { className?: string; position?: string; maskColor?: string; bgColor?: string }) => (
		<div
			data-bg-color={props.bgColor}
			data-mask-color={props.maskColor}
			data-position={props.position}
			data-testid="flow-minimap"
			className={props.className}
		/>
	),
	Position: { Bottom: "bottom", Top: "top" },
	ReactFlow: ({
		nodes,
		edges,
		nodeTypes,
		children,
	}: {
		nodes: MockFlowNode[];
		edges: MockFlowEdge[];
		nodeTypes: Record<string, (props: { data: unknown }) => ReactNode>;
		children?: ReactNode;
	}) => (
		<div data-testid="react-flow">
			<div data-testid="node-count">{nodes.length}</div>
			<div data-testid="edge-count">{edges.length}</div>
			<div data-testid="edge-labels">{JSON.stringify(edges.map((edge) => edge.label))}</div>
			<div data-testid="edge-styles">{JSON.stringify(edges.map((edge) => edge.style))}</div>
			{nodes.map((node) => {
				const NodeComponent = nodeTypes[node.type ?? ""];

				return NodeComponent ? (
					<div data-testid={`flow-node-${node.id}`} key={node.id}>
						<NodeComponent data={node.data} />
					</div>
				) : null;
			})}
			{children}
		</div>
	),
	ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
	useReactFlow: () => ({ fitView: vi.fn() }),
}));
```

- [ ] **Step 2: Add a failing assertion to the manager relationship test**

In `it("renders manager relationships and employee avatars with deterministic fallback", ...)`, add these assertions after the existing avatar assertions. This verifies both manager and employee cards have a source and target handle available for card-to-card manager connections.

```tsx
		for (const employeeNodeId of ["employee:manager-1", "employee:emp-1"]) {
			const employeeNode = screen.getByTestId(`flow-node-${employeeNodeId}`);

			expect(
				within(employeeNode).getByTestId("flow-handle-source-bottom"),
			).toBeTruthy();
			expect(within(employeeNode).getByTestId("flow-handle-target-top")).toBeTruthy();
		}
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run from the repository root:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx'
```

Expected: FAIL. The failure should say Testing Library cannot find `flow-handle-source-bottom` or `flow-handle-target-top`, because `EmployeeFlowNode` has not rendered handles yet.

## Task 2: Render React Flow Handles On Employee Cards

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx:3-13`
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx:380-428`

- [ ] **Step 1: Import `Handle` and `Position`**

Update the `@xyflow/react` import at the top of `org-chart-client.tsx` to include `Handle` and `Position`.

```tsx
import {
	Background,
	Controls,
	type Edge,
	Handle,
	MarkerType,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
```

- [ ] **Step 2: Add handles to `EmployeeFlowNode`**

Replace the opening of the employee card return block with this version. The `relative` class gives the handles a stable positioning context. The top target handle receives incoming manager edges; the bottom source handle emits outgoing manager edges.

```tsx
	return (
		<div
			className={`relative w-[260px] rounded-xl border bg-card p-4 text-card-foreground shadow-sm ${
				node.isFocused ? "border-primary ring-2 ring-primary/30" : "border-border"
			}`}
		>
			<Handle
				className="border border-primary/40 bg-primary"
				position={Position.Top}
				type="target"
			/>
			<Handle
				className="border border-primary/40 bg-primary"
				position={Position.Bottom}
				type="source"
			/>
			<div className="flex items-start gap-3">
```

Keep the rest of `EmployeeFlowNode` unchanged after the `div className="flex items-start gap-3"` line.

- [ ] **Step 3: Run the focused test and verify it passes**

Run from the repository root:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx'
```

Expected: PASS. The manager relationship test should find both source and target handles on each employee card.

## Task 3: Verify Integration And Quality

**Files:**
- Verify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx`
- Verify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx`

- [ ] **Step 1: Run the org chart graph tests**

Run from the repository root:

```bash
pnpm --dir apps/webapp vitest run 'src/app/[locale]/(app)/organization/org-chart-graph.test.ts' 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx'
```

Expected: PASS. This confirms the data model still creates manager edges and the client can render connection handles for them.

- [ ] **Step 2: Run formatting/lint check for touched files if available through the project test tooling**

Run from the repository root:

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/organization/org-chart-client.test.tsx'
```

Expected: PASS or the same passing Vitest output as the focused test. If this command is not accepted by the workspace script, use the passing focused Vitest command from Task 2 as the verification result.

- [ ] **Step 3: Inspect the final diff**

Run from the repository root:

```bash
git diff -- 'apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx' 'apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.test.tsx' docs/superpowers/specs/2026-05-27-org-chart-manager-handles-design.md docs/superpowers/plans/2026-05-27-org-chart-manager-handles.md
```

Expected: Diff only includes the design doc, this plan, React Flow handle imports/rendering, and matching test mock/assertions.

## Self-Review

- Spec coverage: The plan adds visible React Flow handles to employee cards, preserves existing manager edge data, avoids database/server changes, and tests the client behavior.
- Placeholder scan: No TBD, TODO, or unspecified implementation steps remain.
- Type consistency: The plan uses `Handle`, `Position.Top`, `Position.Bottom`, `type="target"`, and `type="source"`, matching `@xyflow/react` conventions and the test mock.
