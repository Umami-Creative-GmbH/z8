/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkBalanceRecalculationCard } from "./work-balance-recalculation-card";

const t = (_key: string, defaultValue: string) => defaultValue;

function renderCard({
	isPending = false,
	onRecalculate = vi.fn().mockResolvedValue({ success: true }),
}: {
	isPending?: boolean;
	onRecalculate?: () => Promise<unknown>;
} = {}) {
	return render(
		<WorkBalanceRecalculationCard
			employeeName="Johannes Glier"
			isPending={isPending}
			onRecalculate={onRecalculate}
			t={t}
		/>,
	);
}

describe("WorkBalanceRecalculationCard", () => {
	it("requires a confirmation click before recalculating work balance", async () => {
		const user = userEvent.setup();
		const onRecalculate = vi.fn().mockResolvedValue({ success: true });

		renderCard({ onRecalculate });

		await user.click(screen.getByRole("button", { name: "Recalculate Work Balance" }));

		expect(onRecalculate).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Confirm Recalculation" }));

		await waitFor(() => expect(onRecalculate).toHaveBeenCalledTimes(1));
		expect(screen.getByRole("button", { name: "Recalculate Work Balance" })).toBeTruthy();
	});

	it("moves focus and announces confirmation after the initial keyboard action", async () => {
		const user = userEvent.setup();

		renderCard();

		await user.tab();
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Recalculate Work Balance" }),
		);
		await user.keyboard("{Enter}");

		const confirmButton = await screen.findByRole("button", { name: "Confirm Recalculation" });

		expect(document.activeElement).toBe(confirmButton);
		expect(
			screen
				.getByText("Confirm before queueing this recalculation.")
				.getAttribute("aria-live"),
		).toBe("polite");
	});

	it("disables the action and announces when recalculation is queued", () => {
		renderCard({ isPending: true });

		const queuedButton = screen.getByRole("button", { name: "Recalculation Queued" });

		expect(queuedButton).toHaveProperty("disabled", true);
		expect(screen.queryByRole("button", { name: "Recalculate Work Balance" })).toBeNull();
	});

	it("closes confirmation without throwing when recalculation rejects", async () => {
		const user = userEvent.setup();
		const onRecalculate = vi.fn().mockRejectedValue(new Error("Queue failed"));

		renderCard({ onRecalculate });

		await user.click(screen.getByRole("button", { name: "Recalculate Work Balance" }));
		await expect(
			user.click(screen.getByRole("button", { name: "Confirm Recalculation" })),
		).resolves.toBeUndefined();

		await waitFor(() => expect(onRecalculate).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole("button", { name: "Confirm Recalculation" })).toBeNull();
		expect(screen.getByRole("button", { name: "Recalculate Work Balance" })).toBeTruthy();
	});
});
