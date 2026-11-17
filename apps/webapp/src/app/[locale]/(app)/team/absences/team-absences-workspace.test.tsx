// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagerAbsenceListResult } from "./manager-absence-types";
import { TeamAbsencesWorkspace } from "./team-absences-workspace";

const mocks = vi.hoisted(() => ({
	scope: {
		userId: "actor",
		activeOrganizationId: "org-a",
		employeeId: "manager",
		role: "manager",
		isLoading: false,
		error: null as string | null,
		refetch: vi.fn(),
	},
	feature: true,
	refresh: vi.fn(),
}));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => mocks.scope }));
vi.mock("@/stores/organization-settings-store", () => ({
	usePersonnelFilesEnabled: () => mocks.feature,
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("./team-absence-year-calendar", () => ({
	TeamAbsenceYearCalendar: ({ data }: { data: { year: number } }) => <p>Calendar {data.year}</p>,
}));
vi.mock("./team-absences-table", () => ({
	TeamAbsencesTable: ({
		children,
		data,
		recordingAvailable,
	}: {
		children: ReactNode;
		data: ManagerAbsenceListResult;
		recordingAvailable: boolean;
	}) => (
		<>
			{children}
			<p>Records {data.year}</p>
			<input aria-label="Record draft" />
			<button type="button" disabled={!recordingAvailable}>
				Record
			</button>
		</>
	),
}));

const props = {
	actor: { userId: "actor", organizationId: "org-a", employeeId: "manager", role: "manager" },
	requestKey: "2026",
	search: "",
	categories: [],
	sickNotesEnabled: true,
	listResult: {
		success: true as const,
		data: {
			rows: [],
			teams: [],
			total: 0,
			page: 1,
			pageSize: 25,
			year: 2026,
			teamId: null,
			sort: "employee",
			direction: "asc",
			pageCount: 0,
		} as ManagerAbsenceListResult,
	},
	calendarResult: { success: true as const, data: { year: 2026, teamId: null, entries: [] } },
};
describe("team absences current workspace", () => {
	beforeEach(() => {
		mocks.scope = {
			userId: "actor",
			activeOrganizationId: "org-a",
			employeeId: "manager",
			role: "manager",
			isLoading: false,
			error: null,
			refetch: vi.fn(),
		};
		mocks.feature = true;
		mocks.refresh.mockClear();
	});
	it("retains independent usable reads and the draft on failed refresh, then retries", () => {
		const view = render(<TeamAbsencesWorkspace {...props} />);
		fireEvent.change(screen.getByLabelText("Record draft"), { target: { value: "Keep me" } });
		view.rerender(
			<TeamAbsencesWorkspace {...props} calendarResult={{ success: false, error: "Offline" }} />,
		);
		expect(screen.getByText("Calendar 2026")).toBeTruthy();
		expect(screen.getByText("Records 2026")).toBeTruthy();
		expect((screen.getByLabelText("Record draft") as HTMLInputElement).value).toBe("Keep me");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(mocks.refresh).toHaveBeenCalledOnce();
		view.rerender(<TeamAbsencesWorkspace {...props} />);
		expect(screen.queryByRole("alert")).toBeNull();
	});
	it("does not present a previous filter result as the requested year", () => {
		const view = render(<TeamAbsencesWorkspace {...props} />);
		view.rerender(
			<TeamAbsencesWorkspace
				{...props}
				requestKey="2027"
				listResult={{ success: false, error: "Unavailable" }}
				calendarResult={{ success: false, error: "Unavailable" }}
			/>,
		);
		expect(screen.queryByText("Calendar 2026")).toBeNull();
		expect(screen.queryByText("Records 2026")).toBeNull();
	});
	it("retains a pending session's known scope and retires it for A to B to A", () => {
		const view = render(<TeamAbsencesWorkspace {...props} />);
		fireEvent.change(screen.getByLabelText("Record draft"), { target: { value: "Old actor A" } });
		mocks.scope.isLoading = true;
		view.rerender(<TeamAbsencesWorkspace {...props} />);
		expect((screen.getByLabelText("Record draft") as HTMLInputElement).value).toBe("Old actor A");
		mocks.scope.activeOrganizationId = "org-b";
		view.rerender(<TeamAbsencesWorkspace {...props} />);
		expect(screen.queryByText("Records 2026")).toBeNull();
		mocks.scope.activeOrganizationId = "org-a";
		view.rerender(<TeamAbsencesWorkspace {...props} />);
		expect((screen.getByLabelText("Record draft") as HTMLInputElement).value).toBe("");
	});
	it.each(["userId", "employeeId", "role"] as const)(
		"retires records when current %s changes",
		(field) => {
			const view = render(<TeamAbsencesWorkspace {...props} />);
			mocks.scope[field] = "changed";
			view.rerender(<TeamAbsencesWorkspace {...props} />);
			expect(screen.queryByText("Records 2026")).toBeNull();
		},
	);
	it("offers current scope recovery without displaying stale records", () => {
		const view = render(<TeamAbsencesWorkspace {...props} />);
		mocks.scope.error = "Failed";
		view.rerender(<TeamAbsencesWorkspace {...props} />);
		expect(screen.queryByText("Records 2026")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(mocks.scope.refetch).toHaveBeenCalledOnce();
	});
	it("retires the form when the current personnel feature changes", () => {
		const view = render(<TeamAbsencesWorkspace {...props} />);
		fireEvent.change(screen.getByLabelText("Record draft"), {
			target: { value: "Sick note draft" },
		});
		mocks.feature = false;
		view.rerender(<TeamAbsencesWorkspace {...props} />);
		expect((screen.getByLabelText("Record draft") as HTMLInputElement).value).toBe("");
	});
});
