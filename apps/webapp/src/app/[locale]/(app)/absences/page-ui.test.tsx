// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import AbsencesPage from "./page";

const readers = vi.hoisted(() => ({
	employee: vi.fn(),
	balance: vi.fn(),
	entries: vi.fn(),
	holidays: vi.fn(),
	container: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/tolgee/server", () => ({
	getTranslate:
		async () =>
		(_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_, key) =>
				String(params?.[key] ?? `{${key}}`),
			),
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: async () => ({
					timezone: "Europe/Berlin",
					name: "Example organization",
				}),
			},
		},
	},
}));
vi.mock("./actions", () => ({
	getCurrentEmployee: readers.employee,
	getVacationBalanceResult: readers.balance,
}));
vi.mock("./queries", () => ({
	getAbsenceCategories: async () => [],
	getAbsenceEntries: readers.entries,
	getHolidays: readers.holidays,
}));
vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: () => <p>Employee access required</p>,
}));
vi.mock("@/components/absences/absences-view-container", () => ({
	AbsencesViewContainer: (props: Record<string, unknown>) => {
		readers.container(props);
		return <p>Personal absence records</p>;
	},
}));
vi.mock("@/components/absences/vacation-balance-card", () => ({
	VacationBalanceCard: () => <p>Available vacation balance</p>,
}));
vi.mock("@/components/statutory/on-call/on-call-status-card", () => ({
	OnCallStatusCard: () => null,
}));

/** Renders the page's streamed content for a URL query. */
async function renderPage(
	query: Record<string, string | string[] | undefined> = {},
) {
	const page = AbsencesPage({ searchParams: Promise.resolve(query) });
	render(await page.props.children.type(page.props.children.props));
}

describe("Personal absences arrival", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
		readers.entries.mockReset().mockResolvedValue([]);
		readers.holidays.mockReset().mockResolvedValue([]);
		readers.container.mockReset();
		readers.employee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
		});
		readers.balance.mockResolvedValue({
			balance: null,
			configuration: { status: "missing" },
		});
	});
	afterEach(() => {
		vi.useRealTimers();
	});
	it("loads the linked view and year directly, keeping the balance on the current year", async () => {
		await renderPage({ view: "table", year: "2027" });
		expect(readers.entries).toHaveBeenCalledTimes(1);
		expect(readers.entries).toHaveBeenCalledWith(
			"employee-1",
			"2027-01-01",
			"2027-12-31",
		);
		// Calendar dates, not Berlin midnights: 2026-12-31T23:00Z read as 31 December 2026.
		expect(readers.holidays).toHaveBeenCalledWith(
			"employee-1",
			new Date("2027-01-01T00:00:00.000Z"),
			new Date("2027-12-31T00:00:00.000Z"),
		);
		expect(readers.balance).toHaveBeenCalledWith(
			"employee-1",
			2026,
			"Europe/Berlin",
		);
		expect(readers.container).toHaveBeenCalledWith(
			expect.objectContaining({
				year: 2027,
				initialView: "table",
				currentDate: "2026-11-19",
			}),
		);
	});
	it("falls back to the calendar for the current year on invalid parameters", async () => {
		await renderPage({ view: "list", year: "2101" });
		expect(readers.entries).toHaveBeenCalledWith(
			"employee-1",
			"2026-01-01",
			"2026-12-31",
		);
		expect(readers.container).toHaveBeenCalledWith(
			expect.objectContaining({ year: 2026, initialView: "calendar" }),
		);
	});
	it("keeps personal records available beside an unavailable balance with one page-owned title", async () => {
		await renderPage();
		expect(
			screen.getByRole("heading", { level: 1, name: "Absences" }),
		).toBeTruthy();
		expect(appPageOwnsHeading("/en/absences")).toBe(true);
		expect(screen.getByText("Missing vacation policy")).toBeTruthy();
		expect(screen.getByText("Personal absence records")).toBeTruthy();
		expect(screen.queryByText("Available vacation balance")).toBeNull();
	});
	it.each([
		[{ status: "conflict", periods: [] }, "Conflicting vacation policies"],
		[
			{ status: "conflict", periods: [{ reason: "zero_working_days" }] },
			"Work schedule without working days",
		],
	])(
		"keeps the configuration reason distinct from an empty record",
		async (configuration, message) => {
			readers.balance.mockResolvedValue({ balance: null, configuration });
			await renderPage();
			expect(screen.getByText(message)).toBeTruthy();
			expect(screen.getByText("Personal absence records")).toBeTruthy();
		},
	);
	it("keeps the page title when employee access is unavailable", async () => {
		readers.employee.mockResolvedValue(null);
		await renderPage();
		expect(
			screen.getByRole("heading", { name: "Absences", level: 1 }),
		).toBeTruthy();
		expect(screen.queryByText("Personal absence records")).toBeNull();
	});
});
