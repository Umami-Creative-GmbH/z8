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

	describe("proration settings (#1109)", () => {
		it("creates a policy that prorates, with a statutory minimum of min(20, annual days)", async () => {
			const user = userEvent.setup();
			vi.mocked(createVacationPolicy).mockResolvedValue({ success: true } as never);
			render(<VacationPolicyForm open onOpenChange={vi.fn()} organizationId="org_1" />);

			expect(
				screen
					.getByRole("switch", { name: "Prorate in start and exit year" })
					.getAttribute("aria-checked"),
			).toBe("true");
			expect(screen.getByLabelText<HTMLInputElement>("Statutory Minimum Days").value).toBe("20");

			await user.type(screen.getByLabelText("Policy Name"), "Part-time");
			await user.clear(screen.getByLabelText("Default Annual Days"));
			await user.type(screen.getByLabelText("Default Annual Days"), "15");
			expect(screen.getByLabelText<HTMLInputElement>("Statutory Minimum Days").value).toBe("15");
			await user.click(screen.getByRole("button", { name: "Create Policy" }));

			await waitFor(() =>
				expect(createVacationPolicy).toHaveBeenCalledWith(
					expect.objectContaining({
						defaultAnnualDays: "15",
						prorateInStartAndExitYear: true,
						statutoryMinimumDays: "15",
					}),
				),
			);
		});

		it("edits both settings of an existing policy", async () => {
			const user = userEvent.setup();
			vi.mocked(updateVacationPolicy).mockResolvedValue({ success: true } as never);
			render(
				<VacationPolicyForm
					open
					onOpenChange={vi.fn()}
					organizationId="org_1"
					existingPolicy={buildPolicy(
						{ startDate: "2027-01-01", validUntil: null },
						{ defaultAnnualDays: "30", statutoryMinimumDays: "20" },
					)}
				/>,
			);

			await user.click(screen.getByRole("switch", { name: "Prorate in start and exit year" }));
			await user.clear(screen.getByLabelText("Statutory Minimum Days"));
			await user.type(screen.getByLabelText("Statutory Minimum Days"), "24");
			await user.click(screen.getByRole("button", { name: "Update Policy" }));

			await waitFor(() =>
				expect(updateVacationPolicy).toHaveBeenCalledWith(
					"policy_1",
					expect.objectContaining({ prorateInStartAndExitYear: false, statutoryMinimumDays: "24" }),
				),
			);
		});

		it.each([
			{ value: "31", message: "Cannot exceed the default annual days" },
			{ value: "-1", message: "Must be 0 or more" },
		])("refuses a statutory minimum of $value on 30 annual days", async ({ value, message }) => {
			const user = userEvent.setup();
			render(
				<VacationPolicyForm
					open
					onOpenChange={vi.fn()}
					organizationId="org_1"
					existingPolicy={buildPolicy(
						{ startDate: "2027-01-01", validUntil: null },
						{ defaultAnnualDays: "30", statutoryMinimumDays: "20" },
					)}
				/>,
			);

			// The panel focuses its first field on an animation frame; wait before typing elsewhere.
			await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Policy Name")));

			await user.clear(screen.getByLabelText("Statutory Minimum Days"));
			await user.type(screen.getByLabelText("Statutory Minimum Days"), value);
			await user.click(screen.getByRole("button", { name: "Update Policy" }));

			expect(await screen.findByText(message)).toBeTruthy();
			expect(updateVacationPolicy).not.toHaveBeenCalled();
		});

		it("says the switch does not apply to a policy that accrues monthly", () => {
			render(
				<VacationPolicyForm
					open
					onOpenChange={vi.fn()}
					organizationId="org_1"
					existingPolicy={buildPolicy(
						{ startDate: "2027-01-01", validUntil: null },
						{ accrualType: "monthly" },
					)}
				/>,
			);

			expect(screen.getByRole("switch", { name: "Prorate in start and exit year" })).toBeTruthy();
			expect(
				screen.getByText(
					"This policy accrues monthly or biweekly, so it already accrues in part years. The switch doesn't apply to it.",
				),
			).toBeTruthy();
		});
	});
});

function buildPolicy(
	dates: { startDate: string; validUntil: string | null },
	overrides: Partial<{
		defaultAnnualDays: string;
		accrualType: string;
		prorateInStartAndExitYear: boolean;
		statutoryMinimumDays: string;
	}> = {},
) {
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
		prorateInStartAndExitYear: true,
		statutoryMinimumDays: "20",
		...overrides,
	};
}
