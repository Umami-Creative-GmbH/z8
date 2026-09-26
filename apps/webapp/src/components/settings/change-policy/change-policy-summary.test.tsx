/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangePolicyRecord } from "@/app/[locale]/(app)/settings/change-policies/actions";
import { ChangePolicyDialog } from "./change-policy-dialog";
import { ChangePolicyTable } from "./change-policy-table";

type ComponentWithChildren = { children?: React.ReactNode };

const mocks = vi.hoisted(() => ({
	getChangePolicies: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/change-policies/actions", () => ({
	getChangePolicies: mocks.getChangePolicies,
	deleteChangePolicy: vi.fn(),
	createChangePolicy: vi.fn(),
	updateChangePolicy: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/ui/action-panel", () => {
	const Passthrough = ({ children }: ComponentWithChildren) => <div>{children}</div>;
	return {
		ActionPanel: ({ children, open }: ComponentWithChildren & { open: boolean }) =>
			open ? <div>{children}</div> : null,
		ActionPanelBody: Passthrough,
		ActionPanelContent: Passthrough,
		ActionPanelDescription: Passthrough,
		ActionPanelFooter: Passthrough,
		ActionPanelHeader: Passthrough,
		ActionPanelTitle: Passthrough,
	};
});

/** Same-day self-service with no approval window: nothing routes a clock-out to approval. */
const sameDayOnlyPolicy: ChangePolicyRecord = {
	id: "policy_1",
	organizationId: "org_1",
	name: "Strict edits",
	description: null,
	selfServiceDays: 0,
	approvalDays: 0,
	noApprovalRequired: false,
	notifyAllManagers: false,
	isActive: true,
	createdAt: new Date("2026-09-01T00:00:00Z"),
	createdBy: "user_1",
	updatedAt: new Date("2026-09-01T00:00:00Z"),
	updatedBy: null,
};

function withQueryClient(children: React.ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("change policy without an approval window", () => {
	it("summarizes same-day self-service and never promises clock-out approval", () => {
		render(
			withQueryClient(
				<ChangePolicyDialog
					open
					onOpenChange={() => {}}
					organizationId="org_1"
					editingPolicy={sameDayOnlyPolicy}
					onSuccess={() => {}}
				/>,
			),
		);

		expect(screen.getByText(/Same-day edits are free/)).toBeTruthy();
		expect(screen.getByText(/Beyond 0 days: only admins\/team leads can edit/)).toBeTruthy();
		expect(screen.queryByText(/clock-out/i)).toBeNull();
	});

	it("lists the policy with a same-day approval window, not as covering all clock-outs", async () => {
		mocks.getChangePolicies.mockResolvedValue({ success: true, data: [sameDayOnlyPolicy] });

		render(
			withQueryClient(
				<ChangePolicyTable
					canManage={false}
					organizationId="org_1"
					onCreateClick={() => {}}
					onEditClick={() => {}}
				/>,
			),
		);

		expect(await screen.findByText("Strict edits")).toBeTruthy();
		// Both the self-service and the approval-window column read "Same day only".
		expect(screen.getAllByText("Same day only")).toHaveLength(2);
		expect(screen.queryByText(/clock-outs/i)).toBeNull();
	});
});
