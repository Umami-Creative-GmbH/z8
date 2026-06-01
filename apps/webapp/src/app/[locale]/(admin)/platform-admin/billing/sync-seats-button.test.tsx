/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncSeatsButton } from "./sync-seats-button";
import { syncOrganizationSeatsAction } from "./actions";

vi.mock("next/navigation", () => ({
	useRouter: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("./actions", () => ({
	syncOrganizationSeatsAction: vi.fn(),
}));

const refresh = vi.fn();
const syncSeats = vi.mocked(syncOrganizationSeatsAction);
const useRouterMock = vi.mocked(useRouter);
const toastMock = vi.mocked(toast);

function renderButton() {
	render(<SyncSeatsButton organizationId="org_123" organizationName="Acme GmbH" />);
}

describe("SyncSeatsButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useRouterMock.mockReturnValue({ refresh } as ReturnType<typeof useRouter>);
	});

	it("syncs seats, shows a success toast, and refreshes the route", async () => {
		syncSeats.mockResolvedValue({ success: true, seats: 7 });
		const user = userEvent.setup();

		renderButton();
		await user.click(screen.getByRole("button", { name: "Sync seats for Acme GmbH" }));

		await waitFor(() => {
			expect(syncSeats).toHaveBeenCalledWith("org_123");
		});
		expect(toastMock.success).toHaveBeenCalled();
		expect(refresh).toHaveBeenCalled();
	});

	it("shows the action error and does not refresh when the sync fails", async () => {
		syncSeats.mockResolvedValue({ success: false, error: "Billing is disabled" });
		const user = userEvent.setup();

		renderButton();
		await user.click(screen.getByRole("button", { name: "Sync seats for Acme GmbH" }));

		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith("Billing is disabled");
		});
		expect(refresh).not.toHaveBeenCalled();
	});

	it("shows a generic error and does not refresh when the sync throws", async () => {
		syncSeats.mockRejectedValue(new Error("network failed"));
		const user = userEvent.setup();

		renderButton();
		await user.click(screen.getByRole("button", { name: "Sync seats for Acme GmbH" }));

		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith("Failed to sync seats");
		});
		expect(refresh).not.toHaveBeenCalled();
	});
});
