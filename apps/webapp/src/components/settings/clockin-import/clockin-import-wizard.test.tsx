/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	validateClockinCredentials: vi.fn(),
	fetchClockinEmployees: vi.fn(),
	fetchZ8Employees: vi.fn(),
	importClockinData: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("@/app/[locale]/(app)/settings/import/clockin-actions", () => ({
	validateClockinCredentials: mocks.validateClockinCredentials,
	fetchClockinEmployees: mocks.fetchClockinEmployees,
	fetchZ8Employees: mocks.fetchZ8Employees,
	importClockinData: mocks.importClockinData,
}));

import { ClockinImportWizard } from "./clockin-import-wizard";

describe("ClockinImportWizard", () => {
	it("advances from credentials to preview", async () => {
		mocks.validateClockinCredentials.mockResolvedValue({
			success: true,
			data: { employees: 3, workdays: 12, absences: 2, schedules: 0 },
		});

		render(<ClockinImportWizard organizationId="org_123" />);

		expect(screen.getByText("Clockin API Token")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Bearer Token"), {
			target: { value: "token-123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Connect & Preview" }));

		await waitFor(() => {
			expect(mocks.validateClockinCredentials).toHaveBeenCalledWith("token-123", "org_123");
		});

		expect(await screen.findByText("Clockin Preview")).toBeTruthy();
		expect(screen.getByText("12")).toBeTruthy();
	});
});
