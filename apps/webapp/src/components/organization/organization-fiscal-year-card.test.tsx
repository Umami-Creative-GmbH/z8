/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

const {
	refreshMock,
	toastErrorMock,
	toastSuccessMock,
	updateOrganizationFiscalYearStartMonthMock,
} = vi.hoisted(() => ({
	refreshMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	updateOrganizationFiscalYearStartMonthMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: toastSuccessMock,
		error: toastErrorMock,
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	updateOrganizationFiscalYearStartMonth: updateOrganizationFiscalYearStartMonthMock,
}));

import { OrganizationFiscalYearCard } from "./organization-fiscal-year-card";

function renderCard(role: "owner" | "admin" | "member" = "owner", month = 1) {
	return render(
		<OrganizationFiscalYearCard
			organizationId="org-1"
			fiscalYearStartMonth={month}
			currentMemberRole={role}
		/>,
	);
}

describe("OrganizationFiscalYearCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		updateOrganizationFiscalYearStartMonthMock.mockResolvedValue({ success: true, data: undefined });
		useOrganizationSettings.getState().reset();
	});

	it("disables the month picker and explains owner-only editing for non-owners", () => {
		renderCard("admin", 4);

		expect(
			(screen.getByRole("combobox", { name: "Fiscal year start month" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			screen.getByText("Only organization owners can change the fiscal year setting."),
		).toBeTruthy();
	});

	it("lets owners change the fiscal year start month", async () => {
		renderCard("owner", 1);

		fireEvent.click(screen.getByRole("combobox", { name: "Fiscal year start month" }));
		fireEvent.click(screen.getByRole("option", { name: "April" }));

		await waitFor(() => {
			expect(updateOrganizationFiscalYearStartMonthMock).toHaveBeenCalledWith("org-1", 4);
		});
		expect(useOrganizationSettings.getState().fiscalYearStartMonth).toBe(4);
		expect(toastSuccessMock).toHaveBeenCalled();
		expect(refreshMock).toHaveBeenCalled();
	});

	it("reverts local and stored month when saving fails", async () => {
		updateOrganizationFiscalYearStartMonthMock.mockResolvedValueOnce({
			success: false,
			error: "No permission",
		});

		renderCard("owner", 7);

		fireEvent.click(screen.getByRole("combobox", { name: "Fiscal year start month" }));
		fireEvent.click(screen.getByRole("option", { name: "October" }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("No permission");
		});
		expect(useOrganizationSettings.getState().fiscalYearStartMonth).toBe(7);
		expect(
			screen.getByRole("combobox", { name: "Fiscal year start month" }).textContent,
		).toContain("July");
	});
});
