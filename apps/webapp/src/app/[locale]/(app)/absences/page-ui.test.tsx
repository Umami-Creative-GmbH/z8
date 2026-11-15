// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import AbsencesPage from "./page";

const readers = vi.hoisted(() => ({ employee: vi.fn(), balance: vi.fn() }));
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
	getAbsenceEntries: async () => [],
	getHolidays: async () => [],
}));
vi.mock("./queries", () => ({ getAbsenceCategories: async () => [] }));
vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: () => <p>Employee access required</p>,
}));
vi.mock("@/components/absences/absences-view-container", () => ({
	AbsencesViewContainer: () => <p>Personal absence records</p>,
}));
vi.mock("@/components/absences/vacation-balance-card", () => ({
	VacationBalanceCard: () => <p>Available vacation balance</p>,
}));

describe("Personal absences arrival", () => {
	beforeEach(() => {
		readers.employee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
		});
		readers.balance.mockResolvedValue({
			balance: null,
			configuration: { status: "missing" },
		});
	});
	it("keeps personal records available beside an unavailable balance with one page-owned title", async () => {
		render(await AbsencesPage().props.children.type());
		expect(
			screen.getByRole("heading", { level: 1, name: "Absences" }),
		).toBeTruthy();
		expect(appPageOwnsHeading("/en/absences")).toBe(true);
		expect(appPageOwnsHeading("/en/team/absences")).toBe(false);
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
			render(await AbsencesPage().props.children.type());
			expect(screen.getByText(message)).toBeTruthy();
			expect(screen.getByText("Personal absence records")).toBeTruthy();
		},
	);
	it("keeps the page title when employee access is unavailable", async () => {
		readers.employee.mockResolvedValue(null);
		render(await AbsencesPage().props.children.type());
		expect(
			screen.getByRole("heading", { name: "Absences", level: 1 }),
		).toBeTruthy();
		expect(screen.queryByText("Personal absence records")).toBeNull();
	});
});
