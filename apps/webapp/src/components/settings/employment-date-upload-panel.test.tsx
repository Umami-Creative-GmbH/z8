/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	commitEmploymentDateUploadAction,
	previewEmploymentDateUploadAction,
} from "@/app/[locale]/(app)/settings/employees/employment-date-upload-actions";
import { EmploymentDateUploadPanel } from "./employment-date-upload-panel";

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => routerMock,
}));
vi.mock("@/app/[locale]/(app)/settings/employees/employment-date-upload-actions", () => ({
	previewEmploymentDateUploadAction: vi.fn(),
	commitEmploymentDateUploadAction: vi.fn(),
}));

function renderWithQuery(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

function csvFile(content: string) {
	const file = new File([content], "joining-dates.csv", { type: "text/csv" });
	Object.defineProperty(file, "text", { value: async () => content });
	return file;
}

const readyOutcome = {
	status: "ready" as const,
	fingerprint: "fp-1",
	rows: [
		{
			row: 2,
			employeeNumber: "EMP-01",
			suppliedEmploymentStartDate: "2024-01-15",
			reason: "HR payroll correction",
			employee: {
				id: "emp-1",
				name: "Ada Lovelace",
				isActive: true,
				employmentStartDate: "2025-01-01",
			},
			impact: null,
			errors: [],
		},
	],
};

describe("EmploymentDateUploadPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(cleanup);

	it("renders inside ActionPanel, preserves the uploaded CSV on preview failure, and commits a reviewed batch once", async () => {
		const user = userEvent.setup();
		let finishCommit!: (value: unknown) => void;
		vi.mocked(previewEmploymentDateUploadAction)
			.mockResolvedValueOnce({ success: false, error: "Temporary failure" } as never)
			.mockResolvedValueOnce({ success: true, data: readyOutcome } as never);
		vi.mocked(commitEmploymentDateUploadAction).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishCommit = resolve;
				}) as never,
		);

		renderWithQuery(<EmploymentDateUploadPanel />);
		await user.click(screen.getByRole("button", { name: "Upload actual joining dates" }));

		const dialog = screen.getByRole("dialog");
		expect(dialog.getAttribute("data-slot")).toBe("action-panel-content");

		const csv =
			"employee_number,employment_start_date,reason\nEMP-01,2024-01-15,HR payroll correction";
		fireEvent.change(screen.getByLabelText("Actual joining dates CSV"), {
			target: { files: [csvFile(csv)] },
		});

		const previewButton = screen.getByRole("button", { name: "Review uploaded joining dates" });
		await waitFor(() => expect(previewButton).toHaveProperty("disabled", false));

		await user.click(previewButton);
		expect(await screen.findByText("Could not review the upload. Try again.")).toBeTruthy();
		expect(previewButton).toHaveProperty("disabled", false);

		await user.click(previewButton);
		expect(await screen.findByText("Ada Lovelace")).toBeTruthy();

		const commitButton = screen.getByRole("button", { name: "Save all reviewed joining dates" });
		await user.click(commitButton);
		await waitFor(() => expect(commitEmploymentDateUploadAction).toHaveBeenCalledTimes(1));
		expect(commitButton).toHaveProperty("disabled", true);
		await user.click(commitButton);
		expect(commitEmploymentDateUploadAction).toHaveBeenCalledTimes(1);

		finishCommit({
			success: true,
			data: {
				status: "committed",
				corrected: 1,
				refreshPending: false,
				rows: readyOutcome.rows,
			},
		});

		expect(
			await screen.findByText("1 actual joining dates saved and balances updated."),
		).toBeTruthy();
		expect(routerMock.refresh).toHaveBeenCalledTimes(1);
	});
});
