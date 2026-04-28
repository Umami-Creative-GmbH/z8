/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

		const mocks = vi.hoisted(() => ({
	validateClockinCredentials: vi.fn(),
	fetchClockinEmployees: vi.fn(),
	fetchZ8Employees: vi.fn(),
	importClockinData: vi.fn(),
	startImportReviewScan: vi.fn(),
	toastError: vi.fn(),
		toastSuccess: vi.fn(),
	}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: mocks.toastError,
		success: mocks.toastSuccess,
	},
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/app/[locale]/(app)/settings/import/clockin-actions", () => ({
	validateClockinCredentials: mocks.validateClockinCredentials,
	fetchClockinEmployees: mocks.fetchClockinEmployees,
	fetchZ8Employees: mocks.fetchZ8Employees,
	importClockinData: mocks.importClockinData,
}));

vi.mock("@/app/[locale]/(app)/settings/import/review-actions", () => ({
	startImportReviewScan: mocks.startImportReviewScan,
}));

import { ClockinImportWizard } from "./clockin-import-wizard";

describe("ClockinImportWizard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

	it("starts an import review scan with mapped employees instead of importing directly", async () => {
		mocks.validateClockinCredentials.mockResolvedValue({
			success: true,
			data: { employees: 2, workdays: 12, absences: 2, schedules: 0 },
		});
		mocks.fetchClockinEmployees.mockResolvedValue({
			success: true,
			data: [
				{ id: 101, name: "Ada Lovelace", email: "ada@example.com" },
				{ id: 202, name: "Grace Hopper", email: "grace@example.com" },
			],
		});
		mocks.fetchZ8Employees.mockResolvedValue({
			success: true,
			data: [
				{ id: "emp_1", userId: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
				{ id: "emp_2", userId: "user_2", name: "Grace Hopper", email: "grace@example.com" },
			],
		});
		mocks.startImportReviewScan.mockResolvedValue({ success: true, data: { batchId: "batch_1" } });

		render(<ClockinImportWizard organizationId="org_123" />);

		fireEvent.change(screen.getByLabelText("Bearer Token"), {
			target: { value: "token-123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Connect & Preview" }));
		await screen.findByText("Clockin Preview");

		fireEvent.click(screen.getByRole("button", { name: "Map Employees" }));
		await screen.findByRole("button", { name: "Continue" });
		fireEvent.change(screen.getByLabelText("Map Grace Hopper"), { target: { value: "" } });

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await screen.findByText("Import Scope");
		fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-01-01" } });
		fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-01-31" } });
		fireEvent.click(screen.getByRole("button", { name: "Start Review Scan" }));

		await waitFor(() => {
			expect(mocks.startImportReviewScan).toHaveBeenCalledWith({
				organizationId: "org_123",
				provider: "clockin",
				credential: "token-123",
				selectedScope: {
					workdays: true,
					absences: true,
					schedules: false,
					dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
				},
				dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
				employeeIds: ["101"],
				employeeMappings: [
					{ providerEmployeeId: "101", employeeId: "emp_1", userId: "user_1" },
				],
				entityTypes: ["work_period", "absence"],
			});
		});
		expect(mocks.importClockinData).not.toHaveBeenCalled();
		expect(await screen.findByText("Import review scan started")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open review" }).getAttribute("href")).toBe(
			"/settings/import/batch_1",
		);
		expect(screen.queryByText("Import complete")).toBeNull();
	});

	it("returns to selection and shows an error when the review scan fails", async () => {
		mocks.validateClockinCredentials.mockResolvedValue({
			success: true,
			data: { employees: 1, workdays: 12, absences: 0, schedules: 0 },
		});
		mocks.fetchClockinEmployees.mockResolvedValue({
			success: true,
			data: [{ id: 101, name: "Ada Lovelace", email: "ada@example.com" }],
		});
		mocks.fetchZ8Employees.mockResolvedValue({
			success: true,
			data: [{ id: "emp_1", userId: "user_1", name: "Ada Lovelace", email: "ada@example.com" }],
		});
		mocks.startImportReviewScan.mockResolvedValue({ success: false, error: "Scan failed" });

		render(<ClockinImportWizard organizationId="org_123" />);

		fireEvent.change(screen.getByLabelText("Bearer Token"), {
			target: { value: "token-123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Connect & Preview" }));
		await screen.findByText("Clockin Preview");
		fireEvent.click(screen.getByRole("button", { name: "Map Employees" }));
		fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
		await screen.findByText("Import Scope");
		fireEvent.click(screen.getByRole("button", { name: "Start Review Scan" }));

		await waitFor(() => {
			expect(mocks.toastError).toHaveBeenCalledWith("Scan failed");
		});
		expect(await screen.findByText("Import Scope")).toBeTruthy();
		expect(mocks.importClockinData).not.toHaveBeenCalled();
	});
});
