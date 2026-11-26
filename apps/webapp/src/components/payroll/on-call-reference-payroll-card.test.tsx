// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import deCatalog from "../../../messages/common/de.json";
import enCatalog from "../../../messages/common/en.json";
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

	it("labels the § 3 EFZG sick-pay line as guidance and leaves the decision to payroll (#2023)", async () => {
		actions.listOnCallPayrollReferenceRowsAction.mockResolvedValue({
			success: true,
			data: [
				{
					...annaSick,
					paidSickDays: {
						from: "2026-03-03",
						untilExclusive: "2026-03-06",
						days: 3,
						continuedPay: null,
						holidaysPaidAsHolidays: [],
					},
				},
			],
		});
		setup({ startDate: "2026-03-01", endDate: "2026-03-31" });

		const line = (await screen.findByText(/No sick pay is owed for this illness/)).closest("p");
		expect(line?.textContent).toMatch(/^Guidance for payroll: No sick pay is owed/);
		expect(
			screen.getByText(
				"Sick-pay lines are guidance under § 3 EFZG; the payroll system decides whether and how much continued pay is paid.",
			),
		).toBeTruthy();
	});

	it("adds no payroll guidance note when no row has a sick-pay line", async () => {
		setup({ startDate: "2026-03-01", endDate: "2026-03-31" });

		expect(await screen.findByText("Anna Berg")).toBeTruthy();
		expect(screen.queryByText(/Guidance for payroll/)).toBeNull();
		expect(screen.queryByText(/payroll system decides/)).toBeNull();
	});

	it("has an English and a German catalog text for the guidance (#2023)", () => {
		const keys = [
			"common.onCall.payroll.sickPayGuidanceLabel",
			"common.onCall.payroll.sickPayGuidanceNote",
		];
		for (const key of keys) {
			const path = key.split(".");
			const read = (catalog: unknown) =>
				path.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
			expect(typeof read(enCatalog), key).toBe("string");
			expect(typeof read(deCatalog), key).toBe("string");
			expect(read(deCatalog), key).not.toBe(read(enCatalog));
		}
		expect(
			(deCatalog as { common: { onCall: { payroll: Record<string, string> } } }).common.onCall
				.payroll.sickPayGuidanceLabel,
		).toBe("Hinweise für die Lohnabrechnung");
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
