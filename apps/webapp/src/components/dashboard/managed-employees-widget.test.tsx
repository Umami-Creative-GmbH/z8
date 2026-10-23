/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActivityMock, getManagedEmployeesMock } = vi.hoisted(() => ({
	getActivityMock: vi.fn(),
	getManagedEmployeesMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			fallback: string,
			params?: Record<string, string | number>,
		) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("@/components/employee-activity-text", () => ({
	EmployeeActivityText: ({
		lastActivityAt,
		lastActivityUtcOffsetMinutes,
	}: {
		lastActivityAt: string | null;
		lastActivityUtcOffsetMinutes: number | null;
	}) => (
		<span>
			activity:{lastActivityAt}:{lastActivityUtcOffsetMinutes}
		</span>
	),
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({
		getStatus: () => "unknown",
		getActivity: getActivityMock,
		getBreak: () => null,
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({
		children,
		href,
		className,
	}: {
		children: ReactNode;
		href: string;
		className?: string;
	}) => (
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

const ada = {
	id: "employee-1",
	position: "Designer",
	user: {
		id: "user-1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
	},
	team: { name: "Ops" },
};

describe("ManagedEmployeesWidget", () => {
	beforeEach(() => {
		getActivityMock.mockReset().mockReturnValue(null);
		getManagedEmployeesMock.mockReset();
	});

	it("asks the server for the caller's own reports without naming a manager", async () => {
		getManagedEmployeesMock.mockResolvedValue({
			success: true,
			data: { isManager: true, employees: [ada] },
		});

		renderManagedEmployeesWidget();

		await screen.findByRole("link", { name: /ada lovelace/i });
		expect(getManagedEmployeesMock).toHaveBeenCalledTimes(1);
		expect(getManagedEmployeesMock).toHaveBeenCalledWith();
	});

	it("renders nothing for a caller who manages nobody", async () => {
		getManagedEmployeesMock.mockResolvedValue({
			success: true,
			data: { isManager: false, employees: [] },
		});

		const { container } = renderManagedEmployeesWidget();

		await vi.waitFor(() => expect(getManagedEmployeesMock).toHaveBeenCalled());
		await vi.waitFor(() => expect(container.textContent).toBe(""));
	});

	it("scopes employee card hover styles to the hovered employee only", async () => {
		getManagedEmployeesMock.mockResolvedValue({
			success: true,
			data: { isManager: true, employees: [ada] },
		});

		renderManagedEmployeesWidget();

		const employeeLink = await screen.findByRole("link", {
			name: /ada lovelace/i,
		});
		const name = within(employeeLink)
			.getAllByText("Ada Lovelace")
			.find((element) => element.className.includes("font-medium"));
		const arrow = Array.from(employeeLink.querySelectorAll("svg")).find(
			(element) =>
				element.getAttribute("class")?.includes("tabler-icon-arrow-right"),
		);

		expect(employeeLink.className).toContain("group/employee");
		expect(name?.className).toContain("group-hover/employee:text-primary");
		expect(arrow?.getAttribute("class")).toContain("group-hover/employee:opacity-100");
		expect(arrow?.getAttribute("class")).toContain("group-hover/employee:translate-x-1");
		expect(arrow?.getAttribute("class")).toContain(
			"transition-[opacity,translate]",
		);
	});

	it("renders employee clock activity metadata in the employee link", async () => {
		getManagedEmployeesMock.mockResolvedValue({
			success: true,
			data: { isManager: true, employees: [ada] },
		});
		getActivityMock.mockReturnValue({
			lastActivityAt: "2026-07-28T10:40:00.000Z",
			lastActivityUtcOffsetMinutes: 120,
		});

		renderManagedEmployeesWidget();

		const employeeLink = await screen.findByRole("link", {
			name: /ada lovelace/i,
		});
		expect(
			within(employeeLink).getByText("activity:2026-07-28T10:40:00.000Z:120"),
		).toBeTruthy();
		expect(getActivityMock).toHaveBeenCalledWith("employee-1");
	});
});
