/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	EmployeeEmploymentHistoryCard,
	type EmployeeEmploymentHistoryCardProps,
} from "../employee-employment-history-card";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const hourlyTerms: EmployeeEmploymentHistoryCardProps["history"][number] = {
	id: "history-current",
	validFrom: new Date("2026-01-01T00:00:00.000Z"),
	validUntil: null,
	status: "active",
	contractType: "hourly",
	weeklyContractMinutes: 2400,
	probationStartsOn: null,
	probationEndsOn: null,
	workModel: "hybrid",
	workPolicyId: null,
	hourlyRate: 25,
	currency: "EUR",
	changeReason: null,
	reviewState: "confirmed",
};

function renderCard(changeWage?: EmployeeEmploymentHistoryCardProps["changeWage"]) {
	return render(
		<EmployeeEmploymentHistoryCard
			history={[hourlyTerms]}
			canManage={true}
			onCreate={vi.fn()}
			onConfirm={vi.fn()}
			onCancel={vi.fn()}
			isCreating={false}
			isMutating={false}
			changeWage={changeWage}
		/>,
	);
}

function fillChangeWage({ date, wage, reason }: { date: string; wage: string; reason: string }) {
	fireEvent.click(screen.getByRole("button", { name: "Change wage" }));
	fireEvent.change(screen.getByLabelText("Valid from"), { target: { value: date } });
	fireEvent.change(screen.getByLabelText("New hourly wage"), { target: { value: wage } });
	fireEvent.change(screen.getByLabelText("Reason"), { target: { value: reason } });
}

describe("Change wage on the Contract & Work Model card", () => {
	it("is not offered without a wage change permission", () => {
		renderCard();

		expect(screen.queryByRole("button", { name: "Change wage" })).toBeNull();
	});

	it("saves a confirmed wage change by default", async () => {
		const onSubmit = vi.fn().mockResolvedValue({ success: true });
		renderCard({ onSubmit, isPending: false });

		fillChangeWage({ date: "2026-07-01", wage: "27.50", reason: "Annual review" });
		fireEvent.click(screen.getByRole("button", { name: "Save wage change" }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				effectiveOn: "2026-07-01",
				hourlyRate: "27.50",
				changeReason: "Annual review",
				reviewState: "confirmed",
			}),
		);
	});

	it("saves the wage change as a draft when asked", async () => {
		const onSubmit = vi.fn().mockResolvedValue({ success: true });
		renderCard({ onSubmit, isPending: false });

		fillChangeWage({ date: "2026-07-01", wage: "27.50", reason: "Proposal" });
		fireEvent.click(screen.getByRole("checkbox", { name: "Save as draft" }));
		fireEvent.click(screen.getByRole("button", { name: "Save wage change" }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reviewState: "draft" })),
		);
	});

	it("requires a date, a wage and a reason", async () => {
		const onSubmit = vi.fn();
		renderCard({ onSubmit, isPending: false });

		fireEvent.click(screen.getByRole("button", { name: "Change wage" }));
		fireEvent.click(screen.getByRole("button", { name: "Save wage change" }));

		expect(await screen.findByText("Valid from is required")).toBeTruthy();
		expect(screen.getByText("Hourly rate must be a positive number")).toBeTruthy();
		expect(screen.getByText("Reason is required")).toBeTruthy();
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
