// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnCallReferencePayrollCard } from "./on-call-reference-payroll-card";

const actions = vi.hoisted(() => ({ listOnCallPayrollReferenceRowsAction: vi.fn() }));
vi.mock("@/app/[locale]/(app)/settings/contracts/on-call-actions", () => actions);
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

function setup(props: { startDate: string; endDate: string; employeeIds?: string[] }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
	return render(<OnCallReferencePayrollCard organizationId="org-a" {...props} />, {
		wrapper: ({ children }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
}

const annaSick = {
	employeeId: "employee-anna",
	employeeName: "Anna Berg",
	kind: "sick_leave",
	eventDate: "2026-03-03",
	breakdown: { averageMinutesPerDay: 240 },
	paidSickDays: null,
};

describe("OnCallReferencePayrollCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.listOnCallPayrollReferenceRowsAction.mockResolvedValue({
			success: true,
			data: [annaSick],
		});
	});

	it("lists the workspace's selected employees only", async () => {
		setup({ startDate: "2026-03-01", endDate: "2026-03-31", employeeIds: ["employee-anna"] });

		expect(await screen.findByText("Anna Berg")).toBeTruthy();
		expect(actions.listOnCallPayrollReferenceRowsAction).toHaveBeenCalledWith({
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			method: "three_months",
			employeeIds: ["employee-anna"],
		});
	});

	it("asks for a shorter period instead of listing more than three months", async () => {
		setup({ startDate: "2026-01-01", endDate: "2026-04-15" });

		expect(
			await screen.findByText(
				"Reference hours are listed for at most three months at a time. Choose a shorter period.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(actions.listOnCallPayrollReferenceRowsAction).not.toHaveBeenCalled();
	});

	it("shows nothing when the selection matches nobody", async () => {
		const { container } = setup({
			startDate: "2026-03-01",
			endDate: "2026-03-31",
			employeeIds: [],
		});

		await waitFor(() => expect(container.innerHTML).toBe(""));
		expect(actions.listOnCallPayrollReferenceRowsAction).not.toHaveBeenCalled();
	});
});
