/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exportMock, queryOptions, useQueryMock } = vi.hoisted(() => ({
	exportMock: vi.fn(),
	queryOptions: [] as Array<{ queryKey: readonly unknown[] }>,
	useQueryMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: useQueryMock }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/audit-log/actions", () => ({
	exportAuditLogsAction: exportMock,
	getAuditLogsAction: vi.fn(),
}));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({ value }: { value: string }) => (
		<input readOnly value={value} />
	),
}));
function Wrapper({ children }: { children?: ReactNode }) {
	return <div>{children}</div>;
}
vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: Wrapper,
	ActionPanelBody: Wrapper,
	ActionPanelContent: Wrapper,
	ActionPanelDescription: Wrapper,
	ActionPanelHeader: Wrapper,
	ActionPanelTitle: Wrapper,
	ActionPanelTrigger: Wrapper,
}));

import { AuditLogViewer } from "./audit-log-viewer";

const log = {
	id: "log-1",
	entityType: "employee",
	entityId: "employee-1",
	action: "employee.updated",
	performedBy: "user-1",
	performedByName: "Admin",
	performedByEmail: "admin@example.test",
	employeeId: "employee-1",
	changes: null,
	metadata: null,
	ipAddress: null,
	userAgent: null,
	timestamp: new Date("2026-01-01T23:30:00.000Z"),
};

describe("AuditLogViewer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queryOptions.length = 0;
		useQueryMock.mockImplementation((options) => {
			queryOptions.push(options);
			return {
				data: {
					success: true,
					data: { logs: [log], total: 1, hasMore: false },
				},
				isLoading: false,
				refetch: vi.fn(),
			};
		});
	});

	it("keys queries and exports by organization and renders in its timezone", async () => {
		let resolveFirstExport: ((value: unknown) => void) | undefined;
		exportMock
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirstExport = resolve;
					}),
			)
			.mockResolvedValueOnce({ success: true, data: [] });
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: vi.fn(() => "blob:audit"),
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);

		const { rerender } = render(
			<AuditLogViewer
				organizationId="org-1"
				organizationTimezone="Europe/Berlin"
			/>,
		);
		expect(queryOptions.at(-1)?.queryKey).toContain("org-1");
		expect(screen.getByText("Jan 2, 2026")).toBeTruthy();
		expect(screen.getByText("00:30:00")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Export" }));

		rerender(
			<AuditLogViewer
				organizationId="org-2"
				organizationTimezone="America/New_York"
			/>,
		);
		expect(queryOptions.at(-1)?.queryKey).toContain("org-2");
		expect(screen.getByText("Jan 1, 2026")).toBeTruthy();
		expect(screen.getByText("18:30:00")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Export" }));

		await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
		resolveFirstExport?.({ success: true, data: [log] });
		await Promise.resolve();
		expect(toast.success).toHaveBeenCalledTimes(1);
	});
});
