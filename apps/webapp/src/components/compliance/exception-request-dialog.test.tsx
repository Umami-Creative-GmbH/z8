/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestComplianceException } from "@/app/[locale]/(app)/settings/compliance/actions";
import { ExceptionRequestDialog } from "./exception-request-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/compliance/actions", () => ({
	requestComplianceException: vi.fn(),
}));

function renderWithQuery(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("ExceptionRequestDialog", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("renders in ActionPanel and shows inline validation errors for empty reason and invalid planned duration", async () => {
		const user = userEvent.setup();
		renderWithQuery(
			<ExceptionRequestDialog open onOpenChange={vi.fn()} defaultExceptionType="overtime_daily" />,
		);

		expect(screen.getByRole("dialog").getAttribute("data-slot")).toBe("action-panel-content");

		await user.type(screen.getByLabelText("Planned hours"), "15");
		await user.type(screen.getByLabelText("Planned minutes"), "75");
		await user.click(screen.getByRole("button", { name: "Submit Request" }));

		expect(
			await screen.findByText("Please provide a reason for your exception request."),
		).toBeTruthy();
		expect(screen.getByText("Enter whole hours between 0 and 12.")).toBeTruthy();
		expect(screen.getByText("Enter whole minutes between 0 and 59.")).toBeTruthy();
		expect(screen.getByLabelText(/Reason for Exception/).getAttribute("aria-invalid")).toBe("true");
		expect(requestComplianceException).not.toHaveBeenCalled();
	});

	it("preserves entered values on failure, blocks duplicate submission, and submits calculated duration on retry", async () => {
		const user = userEvent.setup();
		let finish!: (value: { success: false; error: string }) => void;
		vi.mocked(requestComplianceException)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}) as never,
			)
			.mockResolvedValueOnce({ success: true, data: { id: "exc-1" } } as never);

		const onOpenChange = vi.fn();
		const onSuccess = vi.fn();

		renderWithQuery(
			<ExceptionRequestDialog
				open
				onOpenChange={onOpenChange}
				defaultExceptionType="overtime_daily"
				organizationId="org-1"
				onSuccess={onSuccess}
			/>,
		);

		const reasonInput = screen.getByLabelText(/Reason for Exception/);
		const hoursInput = screen.getByLabelText("Planned hours");
		const minutesInput = screen.getByLabelText("Planned minutes");
		await user.type(reasonInput, "Critical customer deployment");
		await user.type(hoursInput, "2");
		await user.type(minutesInput, "30");

		await user.click(screen.getByRole("button", { name: "Submit Request" }));
		await waitFor(() => expect(requestComplianceException).toHaveBeenCalledTimes(1));
		const pendingButton = screen.getByRole("button", { name: "Submitting…" });
		expect(pendingButton).toHaveProperty("disabled", true);
		fireEvent.submit(reasonInput.closest("form") as HTMLFormElement);
		expect(requestComplianceException).toHaveBeenCalledTimes(1);

		finish({ success: false, error: "Temporary outage" });
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Submit Request" })).toHaveProperty(
				"disabled",
				false,
			),
		);
		expect((reasonInput as HTMLTextAreaElement).value).toBe("Critical customer deployment");
		expect((hoursInput as HTMLInputElement).value).toBe("2");
		expect((minutesInput as HTMLInputElement).value).toBe("30");

		await user.click(screen.getByRole("button", { name: "Submit Request" }));
		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
		expect(requestComplianceException).toHaveBeenLastCalledWith({
			exceptionType: "overtime_daily",
			reason: "Critical customer deployment",
			plannedDurationMinutes: 150,
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
