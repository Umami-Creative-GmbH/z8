/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { getCurrentEmployeeMock, getManagedEmployeesMock } = vi.hoisted(() => ({
	getCurrentEmployeeMock: vi.fn(),
	getManagedEmployeesMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getCurrentEmployee: getCurrentEmployeeMock,
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
}));

vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: {},
		listeners: {},
		setNodeRef: vi.fn(),
		transform: null,
		transition: undefined,
		isDragging: false,
	}),
}));

vi.mock("@dnd-kit/utilities", () => ({
	CSS: { Translate: { toString: () => undefined } },
}));

vi.mock("./actions", () => ({
	getManagedEmployees: getManagedEmployeesMock,
}));

import { ManagedEmployeesWidget } from "./managed-employees-widget";

function renderManagedEmployeesWidget() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<ManagedEmployeesWidget />
		</QueryClientProvider>,
	);
}

describe("ManagedEmployeesWidget", () => {
	it("scopes employee card hover styles to the hovered employee only", async () => {
		getCurrentEmployeeMock.mockResolvedValue({ id: "manager-1", role: "manager" });
		getManagedEmployeesMock.mockResolvedValue({
			success: true,
			data: [
				{
					id: "employee-1",
					position: "Designer",
					user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com", image: null },
					team: { name: "Ops" },
				},
			],
		});

		renderManagedEmployeesWidget();

		const employeeLink = await screen.findByRole("link", { name: /ada lovelace/i });
		const name = within(employeeLink)
			.getAllByText("Ada Lovelace")
			.find((element) => element.className.includes("font-medium"));
		const arrow = Array.from(employeeLink.querySelectorAll("svg")).find((element) =>
			element.getAttribute("class")?.includes("tabler-icon-arrow-right"),
		);

		expect(employeeLink.className).toContain("group/employee");
		expect(name?.className).toContain("group-hover/employee:text-primary");
		expect(arrow?.getAttribute("class")).toContain("group-hover/employee:opacity-100");
		expect(arrow?.getAttribute("class")).toContain("group-hover/employee:translate-x-1");
	});
});
