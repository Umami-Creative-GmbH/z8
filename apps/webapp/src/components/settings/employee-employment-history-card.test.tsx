/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Settings } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	EmployeeEmploymentHistoryCard,
	type EmployeeEmploymentHistoryCardProps,
} from "./employee-employment-history-card";
import { toEmploymentHistoryPayload } from "./employee-employment-history/utils";

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
		hourlyRate: 28.5,
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
	history = [...baseHistory],
}: {
	history?: EmployeeEmploymentHistoryCardProps["history"];
	canManage?: boolean;
	onCreate?: EmployeeEmploymentHistoryCardProps["onCreate"];
	onCancel?: EmployeeEmploymentHistoryCardProps["onCancel"];
	workPolicies?: EmployeeEmploymentHistoryCardProps["workPolicies"];
} = {}) {
	return render(
		<EmployeeEmploymentHistoryCard
			history={history}
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
	it("converts the inherit work policy option to null in create payloads", () => {
		const payload = toEmploymentHistoryPayload({
			validFrom: "2026-01-01",
			reviewState: "draft",
			weeklyHours: "40",
			workModel: "onsite",
			contractType: "fixed",
			workPolicyId: "__inherit__",
			hourlyRate: "",
			probationStartsOn: "",
			probationEndsOn: "",
			changeReason: "",
		});

		expect(payload.workPolicyId).toBeNull();
	});

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

	it("does not cancel an employment change when confirmation is declined", async () => {
		const onCancel = vi.fn().mockResolvedValue({ success: true });

		renderCard({ onCancel });

		fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

		const dialog = await screen.findByRole("alertdialog");
		expect(
			within(dialog).getByText(
				"Cancel this employment change? This removes the scheduled or draft employment change.",
			),
		).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "Keep change" }));

		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("cancels an employment change after confirmation is accepted", async () => {
		const onCancel = vi.fn().mockResolvedValue({ success: true });

		renderCard({ onCancel });

		fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
		expect(onCancel).not.toHaveBeenCalled();

		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel change" }));

		await waitFor(() => expect(onCancel).toHaveBeenCalledWith("history-pending"));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	});

	it("names the employment change being canceled by type and effective date", async () => {
		renderCard();

		fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

		const dialog = await screen.findByRole("alertdialog");
		expect(
			within(dialog).getByRole("heading", { name: "Cancel hourly change effective Mar 1, 2026?" }),
		).toBeTruthy();
		expect(within(dialog).getByText("30h / week · remote · pending")).toBeTruthy();
	});

	it("keeps the dialog open while canceling and shows a failure inline", async () => {
		let resolveCancel: (value: { success: false; error: string }) => void = () => {};
		const onCancel = vi.fn(
			() =>
				new Promise<{ success: false; error: string }>((resolve) => {
					resolveCancel = resolve;
				}),
		);

		renderCard({ onCancel: onCancel as EmployeeEmploymentHistoryCardProps["onCancel"] });

		fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
		const dialog = await screen.findByRole("alertdialog");
		const confirm = within(dialog).getByRole("button", { name: "Cancel change" });
		fireEvent.click(confirm);

		await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(true));
		expect(within(dialog).getByRole("button", { name: "Keep change" }).hasAttribute("disabled")).toBe(
			true,
		);
		fireEvent.click(confirm);
		expect(onCancel).toHaveBeenCalledTimes(1);

		resolveCancel({ success: false, error: "Change already applied" });

		expect(await within(dialog).findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(confirm.hasAttribute("disabled")).toBe(false);
	});

	it("groups terms by employment stint with the gap between them and unknown legacy dates", () => {
		renderCard({
			history: [
				{
					...baseHistory[0],
					id: "history-rehired",
					validFrom: new Date("2026-06-01T00:00:00.000Z"),
					employmentPeriodId: "period-2",
					employmentPeriod: {
						id: "period-2",
						status: "open",
						startedAt: new Date("2026-06-01T00:00:00.000Z"),
						endedAt: null,
					},
				},
				{
					...baseHistory[0],
					id: "history-first-stint",
					validUntil: new Date("2026-03-31T22:00:00.000Z"),
					employmentPeriodId: "period-1",
					employmentPeriod: {
						id: "period-1",
						status: "closed",
						startedAt: null,
						endedAt: new Date("2026-03-31T22:00:00.000Z"),
					},
				},
			],
		});

		expect(screen.getByRole("region", { name: /Employment Jun 1, 2026 – Present/ })).toBeTruthy();
		expect(
			screen.getByRole("region", { name: /Employment Date not recorded – Mar 31, 2026/ }),
		).toBeTruthy();
		expect(screen.getByText("Not employed Mar 31, 2026 – Jun 1, 2026")).toBeTruthy();
	});
});
