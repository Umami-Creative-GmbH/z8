/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		name,
		value,
		onChange,
	}: {
		name: string;
		value?: string;
		onChange: (value: string) => void;
	}) => (
		<input
			aria-label={name}
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

vi.mock("@/components/ui/select", async () => {
	const { createContext, useContext } = await import("react");
	const Choose = createContext<(value: string) => void>(() => {});
	return {
		Select: ({
			onValueChange,
			children,
		}: {
			onValueChange: (value: string) => void;
			children: ReactNode;
		}) => <Choose.Provider value={onValueChange}>{children}</Choose.Provider>,
		SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		SelectValue: () => null,
		SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
			const choose = useContext(Choose);
			return (
				<button type="button" role="option" aria-selected={false} onClick={() => choose(value)}>
					{children}
				</button>
			);
		},
	};
});

import { RehireForm, type RehireFormProps } from "./rehire-form";

const employeeId = "11111111-1111-4111-8111-111111111111";
const periodId = "22222222-2222-4222-8222-222222222222";

function renderForm(overrides: Partial<RehireFormProps> = {}) {
	const props: RehireFormProps = {
		employeeId,
		previousEmploymentPeriodId: periodId,
		membershipApproved: true,
		teams: [{ id: "team-1", name: "Operations" }],
		managers: [{ id: "manager-1", name: "Morgan Manager" }],
		workPolicies: [{ id: "policy-1", name: "Standard week" }],
		rehire: vi.fn().mockResolvedValue({ success: true, data: {} }),
		onCompleted: vi.fn(),
		onCancel: vi.fn(),
		...overrides,
	};
	render(<RehireForm {...props} />);
	return props;
}

describe("RehireForm", () => {
	it("asks for a new invitation before any access can be restored", () => {
		renderForm({ membershipApproved: false });

		expect(screen.getByRole("note").textContent).toContain("Send a new invitation first");
		expect(screen.queryByRole("button", { name: "Confirm rehire" })).toBeNull();
	});

	it("requires a work policy and a rate for hourly contracts", async () => {
		const user = userEvent.setup();
		const props = renderForm();

		await user.click(screen.getByRole("option", { name: "hourly" }));
		await user.click(screen.getByRole("button", { name: "Confirm rehire" }));

		expect(await screen.findByText("Work Policy is required.")).toBeTruthy();
		expect(screen.getByText("Hourly contracts need a positive hourly rate.")).toBeTruthy();
		expect(props.rehire).not.toHaveBeenCalled();
	});

	it("confirms every new-period term without copying the previous employment", async () => {
		const user = userEvent.setup();
		const props = renderForm();

		await user.click(screen.getByRole("option", { name: "Manager" }));
		await user.click(screen.getByRole("option", { name: "Operations" }));
		await user.click(screen.getByRole("option", { name: "Morgan Manager" }));
		await user.click(screen.getByRole("option", { name: "Standard week" }));
		await user.clear(screen.getByRole("textbox", { name: /Weekly Hours/ }));
		await user.type(screen.getByRole("textbox", { name: /Weekly Hours/ }), "32,5");
		await user.click(screen.getByRole("button", { name: "Confirm rehire" }));

		await waitFor(() => expect(props.onCompleted).toHaveBeenCalled());
		expect(props.rehire).toHaveBeenCalledWith({
			employeeId,
			previousEmploymentPeriodId: periodId,
			requestId: expect.any(String),
			role: "manager",
			teamId: "team-1",
			primaryManagerId: "manager-1",
			workPolicyId: "policy-1",
			weeklyContractMinutes: 1950,
			contractType: "fixed",
			workModel: "onsite",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: null,
		});
	});

	it("keeps entries after a server refusal and focuses its guidance", async () => {
		const user = userEvent.setup();
		const rehire = vi.fn().mockResolvedValue({
			success: false,
			error:
				"This person is no longer an approved organization member. Re-invite them before rehiring.",
		});
		renderForm({ rehire });

		await user.click(screen.getByRole("option", { name: "Standard week" }));
		await user.type(screen.getByRole("textbox", { name: "Note" }), "Returning in spring");
		await user.click(screen.getByRole("button", { name: "Confirm rehire" }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("Re-invite");
		await waitFor(() => expect(document.activeElement).toBe(alert));
		expect((screen.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement).value).toBe(
			"Returning in spring",
		);
	});
});
