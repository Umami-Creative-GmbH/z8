/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { Settings } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	EmployeeEmploymentHistoryCard,
	type EmployeeEmploymentHistoryCardProps,
} from "./employee-employment-history-card";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number | null>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
				fallback,
			),
	}),
}));

afterEach(() => {
	Settings.defaultZone = "system";
	Settings.defaultLocale = "en-US";
	vi.restoreAllMocks();
});

const baseHistory = [
	{
		id: "history-current",
		employeeId: "employee-1",
		organizationId: "org-1",
		validFrom: new Date("2026-01-01T00:00:00.000Z"),
		validUntil: null,
		status: "active",
		contractType: "fixed",
		weeklyContractMinutes: 2400,
		probationStartsOn: null,
		probationEndsOn: null,
		workModel: "hybrid",
		workPolicyId: null,
		hourlyRate: null,
		currency: "EUR",
		changeReason: "Current agreement",
		reviewState: "confirmed",
		createdBy: "user-1",
		confirmedBy: "user-1",
		confirmedAt: new Date("2025-12-15T00:00:00.000Z"),
		createdAt: new Date("2025-12-01T00:00:00.000Z"),
		updatedAt: new Date("2025-12-15T00:00:00.000Z"),
	},
	{
		id: "history-pending",
		employeeId: "employee-1",
		organizationId: "org-1",
		validFrom: new Date("2026-03-01T00:00:00.000Z"),
		validUntil: null,
		status: "active",
		contractType: "hourly",
		weeklyContractMinutes: 1800,
		probationStartsOn: null,
		probationEndsOn: null,
		workModel: "remote",
		workPolicyId: null,
		hourlyRate: "28.50",
		currency: "EUR",
		changeReason: "Scheduled change",
		reviewState: "pending",
		createdBy: "user-1",
		confirmedBy: null,
		confirmedAt: null,
		createdAt: new Date("2026-02-01T00:00:00.000Z"),
		updatedAt: new Date("2026-02-01T00:00:00.000Z"),
	},
] as const;

function renderCard({
	canManage = true,
	onCreate = vi.fn(),
	onCancel = vi.fn(),
	workPolicies = [],
}: {
	canManage?: boolean;
	onCreate?: EmployeeEmploymentHistoryCardProps["onCreate"];
	onCancel?: EmployeeEmploymentHistoryCardProps["onCancel"];
	workPolicies?: EmployeeEmploymentHistoryCardProps["workPolicies"];
} = {}) {
	return render(
		<EmployeeEmploymentHistoryCard
			history={[...baseHistory]}
			canManage={canManage}
			onCreate={onCreate}
			onConfirm={vi.fn()}
			onCancel={onCancel}
			isCreating={false}
			isMutating={false}
			workPolicies={workPolicies}
		/>,
	);
}

describe("EmployeeEmploymentHistoryCard", () => {
	it("renders current contract context", () => {
		renderCard();

		expect(screen.getByText("Contract & Work Model")).toBeTruthy();
		expect(screen.getAllByText("40h / week").length).toBeGreaterThan(0);
		expect(screen.getAllByText("hybrid").length).toBeGreaterThan(0);
	});

	it("hides add action for read-only users", () => {
		renderCard({ canManage: false });

		expect(screen.queryByRole("button", { name: /add change/i })).toBeNull();
	});

	it("hides confirm and cancel actions for read-only users", () => {
		renderCard({ canManage: false });

		expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
	});

	it("renders UTC-midnight effective dates without shifting to the previous local day", () => {
		Settings.defaultZone = "America/Los_Angeles";
		Settings.defaultLocale = "en-US";

		renderCard();

		expect(screen.getAllByText(/Jan 1, 2026/).length).toBeGreaterThan(0);
		expect(screen.queryByText(/Dec 31, 2025/)).toBeNull();
	});

	it("renders selected work policy names for contract rows", () => {
		render(
			<EmployeeEmploymentHistoryCard
				history={[{ ...baseHistory[0], workPolicyId: "policy-1" }]}
				canManage={true}
				onCreate={vi.fn()}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
				isCreating={false}
				isMutating={false}
				workPolicies={[{ id: "policy-1", name: "Thirty hour employee override" }]}
			/>,
		);

		expect(screen.getAllByText("Policy: Thirty hour employee override").length).toBeGreaterThan(0);
	});

	it("requires an effective date before creating an employment change", async () => {
		const onCreate = vi.fn().mockResolvedValue({ success: true });

		renderCard({ onCreate });

		fireEvent.click(screen.getByRole("button", { name: /add change/i }));
		fireEvent.click(screen.getByRole("button", { name: /save change/i }));

		expect(await screen.findByText("Effective Date is required")).toBeTruthy();
		expect(onCreate).not.toHaveBeenCalled();
	});

	it("does not cancel an employment change when confirmation is declined", () => {
		const onCancel = vi.fn().mockResolvedValue({ success: true });
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

		renderCard({ onCancel });

		fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

		expect(confirmSpy).toHaveBeenCalledWith(
			"Cancel this employment change? This removes the scheduled or draft employment change.",
		);
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("cancels an employment change after confirmation is accepted", () => {
		const onCancel = vi.fn().mockResolvedValue({ success: true });
		vi.spyOn(window, "confirm").mockReturnValue(true);

		renderCard({ onCancel });

		fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

		expect(onCancel).toHaveBeenCalledWith("history-pending");
	});
});
