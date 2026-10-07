/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createVacationPolicy,
	updateVacationPolicy,
} from "@/app/[locale]/(app)/settings/vacation/actions";
import { AppLocaleProvider } from "@/components/providers/app-locale-provider";
import { VacationPolicyForm } from "./vacation-policy-form";

const refresh = vi.fn();
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/[locale]/(app)/settings/vacation/actions", () => ({
	createVacationPolicy: vi.fn(),
	updateVacationPolicy: vi.fn(),
}));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("VacationPolicyForm", () => {
	beforeEach(() => vi.clearAllMocks());

	it("re-enables create and keeps the panel open when creation rejects", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		vi.mocked(createVacationPolicy).mockRejectedValue(
			new Error("Network failed"),
		);
		render(
			<VacationPolicyForm
				open
				onOpenChange={onOpenChange}
				organizationId="org_1"
			/>,
		);

		await user.type(screen.getByLabelText("Policy Name"), "Standard");
		await user.click(screen.getByRole("button", { name: "Create Policy" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Create Policy" }),
			).toHaveProperty("disabled", false),
		);
		expect(toast.error).toHaveBeenCalledWith("An unexpected error occurred");
		expect(toast.success).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});

	it("shows the policy dates and accrual months in the app language", async () => {
		const user = userEvent.setup();
		render(
			<AppLocaleProvider locale="de">
				<VacationPolicyForm
					open
					onOpenChange={vi.fn()}
					organizationId="org_1"
					existingPolicy={buildPolicy({ startDate: "2027-01-01", validUntil: "2027-10-23" })}
				/>
			</AppLocaleProvider>,
		);

		expect(screen.getByLabelText("Effective From").textContent).toBe("1. Jan. 2027");
		expect(screen.getByLabelText("Valid Until (optional)").textContent).toBe("23. Okt. 2027");

		await user.click(screen.getByRole("combobox", { name: "Accrual Start Month" }));

		expect(screen.getByRole("option", { name: "März" })).toBeTruthy();
	});

	it("saves picked and cleared dates as YYYY-MM-DD", async () => {
		const user = userEvent.setup();
		vi.mocked(updateVacationPolicy).mockResolvedValue({ success: true } as never);
		render(
			<VacationPolicyForm
				open
				onOpenChange={vi.fn()}
				organizationId="org_1"
				existingPolicy={buildPolicy({ startDate: "2027-01-01", validUntil: "2027-10-23" })}
			/>,
		);

		fireEvent.click(screen.getByLabelText("Effective From"));
		fireEvent.click(screen.getByRole("button", { name: /January 5th, 2027/ }));
		fireEvent.click(screen.getByLabelText("Valid Until (optional)"));
		fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
		await user.click(screen.getByRole("button", { name: "Update Policy" }));

		await waitFor(() =>
			expect(updateVacationPolicy).toHaveBeenCalledWith(
				"policy_1",
				expect.objectContaining({ startDate: "2027-01-05", validUntil: undefined }),
			),
		);
	});
});

function buildPolicy(dates: { startDate: string; validUntil: string | null }) {
	return {
		id: "policy_1",
		name: "Standard",
		...dates,
		isCompanyDefault: false,
		defaultAnnualDays: "20",
		accrualType: "annual",
		accrualStartMonth: 1,
		allowCarryover: false,
		maxCarryoverDays: null,
		carryoverExpiryMonths: null,
	};
}
