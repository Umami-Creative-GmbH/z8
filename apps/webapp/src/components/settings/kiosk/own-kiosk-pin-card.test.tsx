/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnKioskPinCard } from "./own-kiosk-pin-card";

const actions = vi.hoisted(() => ({
	getOwnKioskPinStatusAction: vi.fn(),
	setOwnKioskPinAction: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, defaultValue?: string) => defaultValue ?? _key }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/app/[locale]/(app)/settings/security/kiosk-pin-actions", () => actions);

function renderCard() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<OwnKioskPinCard />
		</QueryClientProvider>,
	);
}

function enter(pin: string, confirmation: string) {
	fireEvent.change(screen.getByLabelText("New PIN"), { target: { value: pin } });
	fireEvent.change(screen.getByLabelText("Repeat PIN"), { target: { value: confirmation } });
	fireEvent.click(screen.getByRole("button", { name: "Save PIN" }));
}

describe("OwnKioskPinCard (#857)", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("renders nothing for a user without an employee profile here", async () => {
		actions.getOwnKioskPinStatusAction.mockResolvedValue({
			success: true,
			data: { hasEmployee: false, hasPin: false },
		});
		const { container } = renderCard();

		await waitFor(() => expect(actions.getOwnKioskPinStatusAction).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("saves a new PIN", async () => {
		actions.getOwnKioskPinStatusAction.mockResolvedValue({
			success: true,
			data: { hasEmployee: true, hasPin: false },
		});
		actions.setOwnKioskPinAction.mockResolvedValue({ success: true, data: { saved: true } });
		renderCard();
		await screen.findByLabelText("New PIN");

		enter("4821", "4821");

		await waitFor(() => expect(actions.setOwnKioskPinAction).toHaveBeenCalledWith("4821"));
		await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
	});

	it("does not submit a malformed or unconfirmed PIN", async () => {
		actions.getOwnKioskPinStatusAction.mockResolvedValue({
			success: true,
			data: { hasEmployee: true, hasPin: true },
		});
		renderCard();
		await screen.findByLabelText("New PIN");

		enter("12a4", "12a4");
		expect(await screen.findByText("A kiosk PIN has 4 to 6 digits.")).toBeTruthy();
		enter("4821", "4822");
		expect(await screen.findByText("The PINs do not match.")).toBeTruthy();
		expect(actions.setOwnKioskPinAction).not.toHaveBeenCalled();
	});
});
