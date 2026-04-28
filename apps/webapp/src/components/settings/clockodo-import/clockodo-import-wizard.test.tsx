/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchClockodoUsers: vi.fn(),
	fetchZ8Employees: vi.fn(),
	getExistingDataCounts: vi.fn(),
	importClockodoData: vi.fn(),
	saveUserMappings: vi.fn(),
	startImportReviewScan: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	validateClockodoCredentials: vi.fn(),
	push: vi.fn(),
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
	useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/app/[locale]/(app)/settings/clockodo-import/actions", () => ({
	fetchClockodoUsers: mocks.fetchClockodoUsers,
	fetchZ8Employees: mocks.fetchZ8Employees,
	getExistingDataCounts: mocks.getExistingDataCounts,
	importClockodoData: mocks.importClockodoData,
	saveUserMappings: mocks.saveUserMappings,
	validateClockodoCredentials: mocks.validateClockodoCredentials,
}));

vi.mock("@/app/[locale]/(app)/settings/import/review-actions", () => ({
	startImportReviewScan: mocks.startImportReviewScan,
}));

import { ClockodoImportWizard } from "./clockodo-import-wizard";

function renderWizard() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	return render(<ClockodoImportWizard organizationId="org_123" />, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	});
}

describe("ClockodoImportWizard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Element.prototype.scrollIntoView = vi.fn();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date("2026-04-28T12:00:00.000Z"));
		mocks.getExistingDataCounts.mockResolvedValue({
			success: true,
			data: {
				employees: 0,
				teams: 0,
				workCategories: 0,
				workPeriods: 0,
				absences: 0,
				workPolicies: 0,
				holidays: 0,
				surcharges: 0,
			},
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts an import review scan with mapped Clockodo users instead of importing directly", async () => {
		mocks.validateClockodoCredentials.mockResolvedValue({
			success: true,
			data: {
				users: 2,
				teams: 1,
				services: 1,
				entries: 12,
				absences: 2,
				targetHours: 1,
				holidayQuotas: 1,
				nonBusinessDays: 1,
				surcharges: 1,
			},
		});
		mocks.fetchClockodoUsers.mockResolvedValue({
			success: true,
			data: [
				{ id: 101, name: "Ada Lovelace", email: "ada@example.com", active: true },
				{ id: 202, name: "Grace Hopper", email: "grace@example.com", active: true },
			],
		});
		mocks.fetchZ8Employees.mockResolvedValue({
			success: true,
			data: [{ id: "emp_1", userId: "user_1", name: "Ada Lovelace", email: "ada@example.com" }],
		});
		mocks.saveUserMappings.mockResolvedValue({ success: true, data: undefined });
		mocks.startImportReviewScan.mockResolvedValue({ success: true, data: { batchId: "batch_1" } });

		renderWizard();

		fireEvent.change(screen.getByLabelText("Clockodo Email"), {
			target: { value: "admin@example.com" },
		});
		fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "api-key-123" } });
		fireEvent.click(screen.getByRole("button", { name: "Connect & Preview" }));
		await screen.findByText("Data Preview");

		fireEvent.click(screen.getByRole("button", { name: "Map Users" }));
		fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
		await screen.findByText("Select Data for Review");
		fireEvent.click(screen.getByRole("button", { name: "Start Review Scan" }));

		await waitFor(() => {
			expect(mocks.startImportReviewScan).toHaveBeenCalledWith({
				organizationId: "org_123",
				provider: "clockodo",
				credential: JSON.stringify({ email: "admin@example.com", apiKey: "api-key-123" }),
				selectedScope: {
					users: true,
					teams: true,
					services: true,
					entries: true,
					absences: true,
					targetHours: true,
					holidayQuotas: true,
					nonBusinessDays: true,
					surcharges: true,
					dateRange: { preset: "all_data", startDate: null, endDate: null },
				},
				dateRange: { startDate: "2016-04-28", endDate: "2026-04-28" },
				employeeIds: ["101", "202"],
				entityTypes: [
					"employee",
					"team",
					"work_category",
					"work_period",
					"absence",
					"target_hours",
					"holiday_quota",
					"holiday",
					"surcharge",
				],
			});
		});
		expect(mocks.saveUserMappings).toHaveBeenCalled();
		expect(mocks.importClockodoData).not.toHaveBeenCalled();
		expect(await screen.findByText("Import review scan started")).toBeTruthy();
		expect(screen.queryByText("Import Complete")).toBeNull();
	});

	it("returns to selection and shows an error when the review scan fails", async () => {
		mocks.validateClockodoCredentials.mockResolvedValue({
			success: true,
			data: {
				users: 1,
				teams: 0,
				services: 0,
				entries: 1,
				absences: 0,
				targetHours: 0,
				holidayQuotas: 0,
				nonBusinessDays: 0,
				surcharges: 0,
			},
		});
		mocks.fetchClockodoUsers.mockResolvedValue({
			success: true,
			data: [{ id: 101, name: "Ada Lovelace", email: "ada@example.com", active: true }],
		});
		mocks.fetchZ8Employees.mockResolvedValue({
			success: true,
			data: [{ id: "emp_1", userId: "user_1", name: "Ada Lovelace", email: "ada@example.com" }],
		});
		mocks.saveUserMappings.mockResolvedValue({ success: true, data: undefined });
		mocks.startImportReviewScan.mockResolvedValue({ success: false, error: "Scan failed" });

		renderWizard();

		fireEvent.change(screen.getByLabelText("Clockodo Email"), {
			target: { value: "admin@example.com" },
		});
		fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "api-key-123" } });
		fireEvent.click(screen.getByRole("button", { name: "Connect & Preview" }));
		await screen.findByText("Data Preview");
		fireEvent.click(screen.getByRole("button", { name: "Map Users" }));
		fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
		await screen.findByText("Select Data for Review");
		fireEvent.click(screen.getByRole("button", { name: "Start Review Scan" }));

		await waitFor(() => {
			expect(mocks.toastError).toHaveBeenCalledWith("Scan failed");
		});
		expect(await screen.findByText("Select Data for Review")).toBeTruthy();
		expect(mocks.importClockodoData).not.toHaveBeenCalled();
	});

	it("does not start a review scan when a custom date range is incomplete", async () => {
		mocks.validateClockodoCredentials.mockResolvedValue({
			success: true,
			data: {
				users: 1,
				teams: 0,
				services: 0,
				entries: 1,
				absences: 0,
				targetHours: 0,
				holidayQuotas: 0,
				nonBusinessDays: 0,
				surcharges: 0,
			},
		});
		mocks.fetchClockodoUsers.mockResolvedValue({
			success: true,
			data: [{ id: 101, name: "Ada Lovelace", email: "ada@example.com", active: true }],
		});
		mocks.fetchZ8Employees.mockResolvedValue({
			success: true,
			data: [{ id: "emp_1", userId: "user_1", name: "Ada Lovelace", email: "ada@example.com" }],
		});
		mocks.saveUserMappings.mockResolvedValue({ success: true, data: undefined });

		renderWizard();

		fireEvent.change(screen.getByLabelText("Clockodo Email"), {
			target: { value: "admin@example.com" },
		});
		fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "api-key-123" } });
		fireEvent.click(screen.getByRole("button", { name: "Connect & Preview" }));
		await screen.findByText("Data Preview");
		fireEvent.click(screen.getByRole("button", { name: "Map Users" }));
		fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
		await screen.findByText("Select Data for Review");

		fireEvent.click(screen.getByRole("combobox"));
		fireEvent.click(await screen.findByText("Custom date range"));

		expect(screen.getByRole("button", { name: "Start Review Scan" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(screen.getByText("Select both a start and end date before starting the scan.")).toBeTruthy();
		expect(mocks.startImportReviewScan).not.toHaveBeenCalled();
	});
});
