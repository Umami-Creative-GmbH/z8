/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmploymentLifecycleEvents } from "@/components/settings/employee-employment-history/lifecycle-events";
import type { ReactivationChecklist } from "@/lib/employee-lifecycle/reactivation-checklist";
import { ReactivationChecklistCard } from "./reactivation-checklist";

const { getChecklistMock, dismissChecklistMock, listHistoryMock } = vi.hoisted(() => ({
	getChecklistMock: vi.fn(),
	dismissChecklistMock: vi.fn(),
	listHistoryMock: vi.fn(),
}));

/** English defaults with their ICU placeholders filled, as Tolgee would. */
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/app/[locale]/(app)/settings/employees/employee-reactivation.actions", () => ({
	getReactivationChecklistAction: getChecklistMock,
	dismissReactivationChecklistAction: dismissChecklistMock,
	listEmployeeLifecycleHistoryAction: listHistoryMock,
}));

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";

const checklist: ReactivationChecklist = {
	deactivationId: "22222222-2222-4222-8222-222222222222",
	employeeId: EMPLOYEE,
	deactivatedAt: "2026-10-24T08:00:00Z",
	reactivatedAt: "2026-10-26T07:30:00Z",
	timeZone: "Europe/Berlin",
	items: [
		{
			group: "shifts",
			kind: "shift",
			id: "shift-1",
			date: "2026-10-27",
			startTime: "09:00",
			endTime: "17:00",
			href: "/scheduling",
		},
		{
			group: "absences",
			kind: "absence",
			id: "absence-1",
			categoryName: "Annual leave",
			startDate: "2026-11-02",
			endDate: "2026-11-03",
			href: "/team/absences",
		},
	],
};

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

beforeEach(() => {
	getChecklistMock.mockReset();
	dismissChecklistMock.mockReset();
	listHistoryMock.mockReset();
});

describe("reactivation checklist on the employee page", () => {
	it("lists what the deactivation ended in the organization's zone, until dismissed", async () => {
		getChecklistMock.mockResolvedValue({ success: true, data: checklist });
		dismissChecklistMock.mockResolvedValue({ success: true, data: undefined });
		renderWithQueryClient(<ReactivationChecklistCard employeeId={EMPLOYEE} />);

		const shifts = await screen.findByRole("region", { name: "Shifts that were opened" });
		expect(within(shifts).getByRole("link", { name: /Tue, Oct 27, 09:00–17:00/ })).toHaveProperty(
			"pathname",
			"/scheduling",
		);
		const absences = screen.getByRole("region", { name: "Cancelled absences" });
		expect(within(absences).getByRole("link").textContent).toMatch(
			/Annual leave, Nov 2\s*–\s*3, 2026/u,
		);
		// 10:00 in Berlin (summer time) and 8:30 after the switch, never the viewer's zone.
		expect(document.body.textContent).toContain("Oct 24, 2026, 10:00");
		expect(document.body.textContent).toContain("Reactivated on Oct 26, 2026, 8:30");

		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

		await waitFor(() =>
			expect(screen.queryByRole("region", { name: "Shifts that were opened" })).toBeNull(),
		);
		expect(dismissChecklistMock).toHaveBeenCalledWith({
			employeeId: EMPLOYEE,
			deactivationId: checklist.deactivationId,
		});
	});

	it("shows nothing without a checklist", async () => {
		getChecklistMock.mockResolvedValue({ success: true, data: null });
		const { container } = renderWithQueryClient(
			<ReactivationChecklistCard employeeId={EMPLOYEE} />,
		);
		await waitFor(() => expect(getChecklistMock).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});
});

describe("deactivations and reactivations in the employment history", () => {
	it("shows both events in the organization's zone", async () => {
		listHistoryMock.mockResolvedValue({
			success: true,
			data: {
				timeZone: "Europe/Berlin",
				events: [
					{ kind: "reactivated", at: "2026-10-26T07:30:00Z" },
					{ kind: "deactivated", at: "2026-10-24T08:00:00Z" },
				],
			},
		});
		renderWithQueryClient(<EmploymentLifecycleEvents employeeId={EMPLOYEE} />);

		const items = await screen.findAllByRole("listitem");
		// ICU versions differ in the space before AM/PM.
		expect(items.map((item) => item.textContent?.replace(/\s/gu, " "))).toEqual([
			"Reactivated on Oct 26, 2026, 8:30 AM",
			"Deactivated on Oct 24, 2026, 10:00 AM",
		]);
		expect(screen.getByText("Times in Europe/Berlin.")).toBeTruthy();
	});
});
