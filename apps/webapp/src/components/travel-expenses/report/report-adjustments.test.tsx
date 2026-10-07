/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	get: vi.fn(),
	push: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/adjustment-actions", () => ({
	createTravelExpenseAdjustmentAction: mocks.create,
	getTravelExpenseReportAdjustments: mocks.get,
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));

import {
	AdjustmentDeltaPreview,
	AdjustmentNotice,
	ReportAdjustmentsPanel,
} from "./report-adjustments";

const reportId = "6a150000-0000-4000-8000-000000000001";
const baseline = {
	originalReportId: reportId,
	revisionId: "revision-1",
	submissionCycle: 1,
	currency: "EUR",
	approvedAmount: "500.00",
	adjustments: [],
	entitlement: "500.00",
};

function mount(node: ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("report adjustments (#615)", () => {
	it("lets the employee correct an exported or reimbursed report with a reasoned adjustment", async () => {
		mocks.get.mockResolvedValue({
			success: true,
			data: { role: "original", eligibility: { ok: true }, baseline, adjustments: [] },
		});
		mocks.create
			.mockResolvedValueOnce({ success: false, error: "Failed to create the adjustment" })
			.mockResolvedValueOnce({
				success: true,
				data: { status: "created", reportId: "adjustment-1", replayed: true },
			});
		mount(<ReportAdjustmentsPanel reportId={reportId} />);

		fireEvent.click(await screen.findByRole("button", { name: "Correct with an adjustment" }));
		fireEvent.click(screen.getByRole("button", { name: "Create adjustment" }));
		expect(await screen.findByText("Explain what needs correcting.")).toBeTruthy();
		expect(mocks.create).not.toHaveBeenCalled();

		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: " Hotel refunded a night " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create adjustment" }));
		expect(
			await screen.findByText("The adjustment could not be created. Please retry."),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create adjustment" }));

		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/travel-expenses/reports/adjustment-1"),
		);
		const [first, second] = mocks.create.mock.calls.map(([input]) => input);
		expect(first).toEqual({
			originalReportId: reportId,
			reason: "Hotel refunded a night",
			idempotencyKey: expect.any(String),
		});
		// A retry of the same correction can never create a second adjustment.
		expect(second.idempotencyKey).toBe(first.idempotencyKey);
	});

	it("lists linked adjustments with their state and signed difference, without a create action before export or payment", async () => {
		mocks.get.mockResolvedValue({
			success: true,
			data: {
				role: "original",
				eligibility: { ok: false, reason: "not_exported_or_reimbursed" },
				baseline,
				adjustments: [
					{
						reportId: "adjustment-1",
						status: "rejected",
						reason: "Wrong rate",
						createdAt: "2026-10-02T08:00:00Z",
						delta: "-50.00",
						currency: "EUR",
						applied: false,
					},
				],
			},
		});
		mount(<ReportAdjustmentsPanel reportId={reportId} />);
		expect(await screen.findByText("-€50.00")).toBeTruthy();
		expect(screen.getByText("Wrong rate")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Correct with an adjustment" })).toBeNull();
	});

	it("shows the signed difference to the approved amount before the adjustment is submitted", async () => {
		mocks.get.mockResolvedValue({
			success: true,
			data: {
				role: "adjustment",
				originalReportId: reportId,
				reason: "Hotel refunded a night",
				baseline,
				frozen: null,
			},
		});
		mount(
			<AdjustmentDeltaPreview
				reportId="adjustment-1"
				corrected={{ amount: "450.00", currency: "EUR" }}
			/>,
		);
		expect(
			await screen.findByText("This adjustment changes the approved amount of €500.00 by -€50.00."),
		).toBeTruthy();
		expect(
			screen.getByText(
				"It needs a fresh approval of the whole report, also when the amount goes down.",
			),
		).toBeTruthy();
	});

	it("names the corrected report and its frozen difference on a submitted adjustment", async () => {
		mocks.get.mockResolvedValue({
			success: true,
			data: {
				role: "adjustment",
				originalReportId: reportId,
				reason: "Minibar was private",
				baseline,
				frozen: {
					originalReportId: reportId,
					reason: "Minibar was private",
					baseline,
					delta: { amount: "12.30", currency: "EUR" },
				},
			},
		});
		mount(<AdjustmentNotice reportId="adjustment-1" />);
		expect(await screen.findByText("+€12.30")).toBeTruthy();
		expect(screen.getByText("Minibar was private")).toBeTruthy();
		expect(
			(
				screen.getByRole("link", { name: /Open the original report/ }) as HTMLAnchorElement
			).getAttribute("href"),
		).toBe(`/travel-expenses/reports/${reportId}`);
	});

	it("renders nothing for reports the viewer does not own", async () => {
		mocks.get.mockResolvedValue({ success: false, error: "Expense report not found" });
		mount(<ReportAdjustmentsPanel reportId={reportId} />);
		await waitFor(() => expect(mocks.get).toHaveBeenCalled());
		expect(screen.queryByText("Adjustments")).toBeNull();
	});
});
