/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeeKioskCard } from "./employee-kiosk-card";

const actions = vi.hoisted(() => ({
	getEmployeeKioskStateAction: vi.fn(),
	issueEmployeeKioskPinAction: vi.fn(),
	resetEmployeeKioskPinAction: vi.fn(),
	unlockEmployeeKioskPinAction: vi.fn(),
	addKioskOnlyEmployeeEmailAction: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, values?: Record<string, string>) =>
			(defaultValue ?? _key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? ""),
	}),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/app/[locale]/(app)/settings/employees/kiosk-actions", () => actions);

const employeeId = "d8570000-0000-4000-8000-000000000005";
const baseState = {
	canManagePin: true,
	hasPin: false,
	lockedUntil: null,
	kioskOnly: false,
	canAddEmail: false,
};

function renderCard() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<EmployeeKioskCard employeeId={employeeId} />
		</QueryClientProvider>,
	);
}

describe("EmployeeKioskCard (#857)", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("renders nothing for a viewer who may not manage the employee's kiosk access", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue({ success: true, data: null });
		const { container } = renderCard();

		await waitFor(() =>
			expect(actions.getEmployeeKioskStateAction).toHaveBeenCalledWith(employeeId),
		);
		expect(container.textContent).toBe("");
	});

	it("issues a PIN and shows it once", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue({ success: true, data: baseState });
		actions.issueEmployeeKioskPinAction.mockResolvedValue({
			success: true,
			data: { pin: "042917" },
		});
		renderCard();

		fireEvent.click(await screen.findByRole("button", { name: "Issue PIN" }));

		expect(await screen.findByText("042917")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Done" }));
		expect(screen.queryByText("042917")).toBeNull();
	});

	it("unlocks a locked-out employee", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue({
			success: true,
			data: { ...baseState, hasPin: true, lockedUntil: "2026-03-02T08:15:00Z" },
		});
		actions.unlockEmployeeKioskPinAction.mockResolvedValue({
			success: true,
			data: { unlocked: true },
		});
		renderCard();

		fireEvent.click(await screen.findByRole("button", { name: "Unlock" }));

		await waitFor(() =>
			expect(actions.unlockEmployeeKioskPinAction).toHaveBeenCalledWith(employeeId),
		);
		expect(screen.getByRole("button", { name: "Reset PIN" })).toBeTruthy();
	});

	it("adds a real email to a kiosk-only employee", async () => {
		actions.getEmployeeKioskStateAction.mockResolvedValue({
			success: true,
			data: { ...baseState, kioskOnly: true, canAddEmail: true },
		});
		actions.addKioskOnlyEmployeeEmailAction.mockResolvedValue({
			success: true,
			data: { invitationSent: true },
		});
		renderCard();

		expect(await screen.findByText("Kiosk only")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Email address"), {
			target: { value: "jamie@example.com" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add email and invite" }));

		await waitFor(() =>
			expect(actions.addKioskOnlyEmployeeEmailAction).toHaveBeenCalledWith({
				employeeId,
				email: "jamie@example.com",
			}),
		);
		await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
	});
});
