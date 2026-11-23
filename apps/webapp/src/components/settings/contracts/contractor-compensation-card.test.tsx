/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractorCompensationRecord } from "@/lib/contractor-compensation/store";
import { ContractorCompensationCard } from "./contractor-compensation-card";

const actions = vi.hoisted(() => ({
	read: vi.fn(),
	set: vi.fn(),
	end: vi.fn(),
	details: vi.fn(),
	list: vi.fn(),
	error: vi.fn(),
	success: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/contracts/contractor-compensation-actions", () => ({
	getContractorCompensation: actions.read,
	setContractorTerms: actions.set,
	endContractorTerms: actions.end,
	updateContractorDetails: actions.details,
	listContractorCompensation: actions.list,
}));
vi.mock("sonner", () => ({ toast: { error: actions.error, success: actions.success } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", hour12: false }),
}));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({ value, onChange }: { value?: string; onChange: (value: string) => void }) => (
		<input
			aria-label="date"
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

const employeeId = "95000000-0000-4000-8000-000000000001";

function record(
	overrides: Partial<ContractorCompensationRecord> = {},
): ContractorCompensationRecord {
	return {
		employeeId,
		activeEngagementKind: "contractor",
		contractorEngagementId: "p1",
		earliestTermsDate: "2026-01-05",
		today: "2026-11-23",
		history: [
			{
				id: "t2",
				employmentPeriodId: "p1",
				effectiveFrom: "2026-06-01",
				effectiveTo: null,
				compensation: {
					compensationBasis: "daily",
					rateAmount: "650.00",
					currency: "EUR",
					dayUnitRule: "half_and_full_day",
					halfDayThresholdMinutes: 240,
					standardDayMinutes: null,
					capAtOneDay: null,
				},
			},
			{
				id: "t1",
				employmentPeriodId: "p1",
				effectiveFrom: "2026-01-05",
				effectiveTo: "2026-06-01",
				compensation: {
					compensationBasis: "hourly",
					rateAmount: "85.00",
					currency: "EUR",
					dayUnitRule: null,
					halfDayThresholdMinutes: null,
					standardDayMinutes: null,
					capAtOneDay: null,
				},
			},
		],
		termsInEffectId: "t2",
		details: { companyName: "Freelance GmbH", vatId: null, referenceCode: null },
		...overrides,
	};
}

const clients: QueryClient[] = [];
function renderCard() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	return render(
		<QueryClientProvider client={client}>
			<ContractorCompensationCard employeeId={employeeId} />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.resetAllMocks();
});
afterEach(() => {
	cleanup();
	for (const client of clients) client.clear();
	clients.length = 0;
});

describe("contractor compensation card", () => {
	it("shows the rate history with the terms in effect today and how days are counted", async () => {
		actions.read.mockResolvedValue({ success: true, data: record() });
		renderCard();

		expect(await screen.findByText("€650.00 per day")).toBeTruthy();
		expect(screen.getByText("Half day up to 240 min, full day above")).toBeTruthy();
		expect(screen.getByText("In effect")).toBeTruthy();
		expect(screen.getByText("€85.00 per hour")).toBeTruthy();
		expect(screen.getByText("Jan 5, 2026 to May 31, 2026")).toBeTruthy();
		expect(screen.getByDisplayValue("Freelance GmbH")).toBeTruthy();
	});

	it("marks no terms in effect when pricing applies none today, even an open one", async () => {
		// E.g. the open terms of an ended engagement, while a new one has no terms yet.
		actions.read.mockResolvedValue({ success: true, data: record({ termsInEffectId: null }) });
		renderCard();

		expect(await screen.findByText("€650.00 per day")).toBeTruthy();
		expect(screen.queryByText("In effect")).toBeNull();
	});

	it("moves the in-effect mark to what the server reports after a change", async () => {
		const user = userEvent.setup();
		actions.read.mockResolvedValue({ success: true, data: record() });
		actions.end.mockResolvedValue({
			success: true,
			data: { changed: true, history: record().history, termsInEffectId: null },
		});
		renderCard();

		expect(await screen.findByText("In effect")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "End rate" }));
		await user.click(screen.getByRole("button", { name: "End rate" }));

		await waitFor(() => expect(screen.queryByText("In effect")).toBeNull());
	});

	it("renders nothing for an employee without contractor terms", async () => {
		actions.read.mockResolvedValue({
			success: true,
			data: record({ activeEngagementKind: "employee", history: [], details: null }),
		});
		const { container } = renderCard();

		await waitFor(() => expect(actions.read).toHaveBeenCalled());
		await waitFor(() => expect(container.textContent).toBe(""));
	});

	it("shows nothing while loading, so an employee's page never flashes the card", async () => {
		actions.read.mockReturnValue(new Promise(() => undefined));
		const { container } = renderCard();

		await waitFor(() => expect(actions.read).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("marks rates of an earlier engagement apart from the active engagement's", async () => {
		const [open, closed] = record().history;
		actions.read.mockResolvedValue({
			success: true,
			data: record({
				history: [
					{ ...open, id: "t3", effectiveFrom: "2026-09-01" },
					{ ...open, employmentPeriodId: "p0", effectiveFrom: "2026-02-01" },
					closed,
				],
				termsInEffectId: "t3",
			}),
		});
		renderCard();

		expect(await screen.findByText("From Sep 1, 2026")).toBeTruthy();
		expect(screen.getAllByText("Earlier engagement")).toHaveLength(1);
	});

	it("keeps earlier contractor rates readable after the engagement ended", async () => {
		actions.read.mockResolvedValue({
			success: true,
			data: record({ activeEngagementKind: "employee" }),
		});
		renderCard();

		expect(await screen.findByText("€650.00 per day")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Set rate" })).toBeNull();
		expect(screen.queryByText("Contracting details")).toBeNull();
	});

	it("sets prorated daily terms with the standard day and cap", async () => {
		const user = userEvent.setup();
		actions.read.mockResolvedValue({ success: true, data: record() });
		actions.set.mockResolvedValue({
			success: true,
			data: { changed: true, history: record().history, termsInEffectId: "t2" },
		});
		renderCard();

		await user.click(await screen.findByRole("button", { name: "Set rate" }));
		const date = screen.getByLabelText("date");
		await user.clear(date);
		await user.type(date, "2026-12-01");
		await user.type(screen.getByLabelText("Daily rate"), "720,50");
		await user.click(screen.getByRole("combobox", { name: "How days are counted" }));
		await user.click(await screen.findByRole("option", { name: "Prorated by a standard day" }));
		const standardDay = await screen.findByLabelText("Standard day (minutes)");
		await user.clear(standardDay);
		await user.type(standardDay, "450");
		await user.click(screen.getByRole("switch", { name: "At most one day per day" }));
		await user.click(screen.getByRole("button", { name: "Save rate" }));

		await waitFor(() =>
			expect(actions.set).toHaveBeenCalledWith({
				employeeId,
				effectiveFrom: "2026-12-01",
				compensation: {
					basis: "daily",
					rateAmount: "720,50",
					currency: "EUR",
					dayUnitRule: "prorated_by_standard_day",
					halfDayThresholdMinutes: null,
					standardDayMinutes: 450,
					capAtOneDay: false,
				},
			}),
		);
		expect(actions.success).toHaveBeenCalledWith("Contractor terms saved");
	});

	it("checks the threshold before saving and never sends an invalid rule", async () => {
		const user = userEvent.setup();
		actions.read.mockResolvedValue({ success: true, data: record() });
		renderCard();

		await user.click(await screen.findByRole("button", { name: "Set rate" }));
		await user.type(screen.getByLabelText("Daily rate"), "600");
		const threshold = screen.getByLabelText("Half-day threshold (minutes)");
		await user.clear(threshold);
		await user.type(threshold, "1441");
		await user.click(screen.getByRole("button", { name: "Save rate" }));

		expect(
			await screen.findByText("Enter a half-day threshold from 1 to 1440 minutes."),
		).toBeTruthy();
		expect(actions.set).not.toHaveBeenCalled();
	});

	it("words a server refusal", async () => {
		const user = userEvent.setup();
		actions.read.mockResolvedValue({ success: true, data: record() });
		actions.end.mockResolvedValue({
			success: false,
			code: "ValidationError",
			refusal: "before_engagement",
			error: "server text",
		});
		renderCard();

		await user.click(await screen.findByRole("button", { name: "End rate" }));
		await user.click(screen.getByRole("button", { name: "End rate" }));

		await waitFor(() =>
			expect(actions.error).toHaveBeenCalledWith(
				"Terms cannot start before the engagement started.",
			),
		);
	});

	it("offers no End rate when every rate belongs to an earlier engagement", async () => {
		const earlier = record().history.map((terms) => ({ ...terms, employmentPeriodId: "p0" }));
		actions.read.mockResolvedValue({
			success: true,
			data: record({ history: earlier, termsInEffectId: null }),
		});
		renderCard();

		expect(await screen.findByRole("button", { name: "Set rate" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "End rate" })).toBeNull();
	});

	it("refuses to end a rate on a day no rate of this engagement applies", async () => {
		const user = userEvent.setup();
		const [, closed] = record().history;
		actions.read.mockResolvedValue({
			success: true,
			data: record({ history: [closed], termsInEffectId: null }),
		});
		renderCard();

		await user.click(await screen.findByRole("button", { name: "End rate" }));
		await user.click(screen.getByRole("button", { name: "End rate" }));

		expect(
			await screen.findByText("No rate applies on this date, so there is nothing to end."),
		).toBeTruthy();
		expect(actions.end).not.toHaveBeenCalled();
	});

	it("says nothing changed when the server found no rate to end", async () => {
		const user = userEvent.setup();
		actions.read.mockResolvedValue({ success: true, data: record() });
		actions.end.mockResolvedValue({
			success: true,
			data: { changed: false, history: record().history, termsInEffectId: "t2" },
		});
		renderCard();

		await user.click(await screen.findByRole("button", { name: "End rate" }));
		await user.click(screen.getByRole("button", { name: "End rate" }));

		await waitFor(() =>
			expect(actions.success).toHaveBeenCalledWith(
				"No rate applied on that date, so nothing changed",
			),
		);
	});

	it("saves the contracting details", async () => {
		const user = userEvent.setup();
		actions.read.mockResolvedValue({ success: true, data: record() });
		actions.details.mockResolvedValue({
			success: true,
			data: { companyName: "Freelance GmbH", vatId: "DE123456789", referenceCode: null },
		});
		renderCard();

		await user.type(await screen.findByLabelText("VAT ID"), "DE123456789");
		await user.click(screen.getByRole("button", { name: "Save details" }));

		await waitFor(() =>
			expect(actions.details).toHaveBeenCalledWith({
				employeeId,
				companyName: "Freelance GmbH",
				vatId: "DE123456789",
				referenceCode: "",
			}),
		);
		expect(actions.success).toHaveBeenCalledWith("Contracting details saved");
	});
});
