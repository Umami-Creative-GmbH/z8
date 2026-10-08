import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
import { useClockTimezone } from "../src/hooks/useClockTimezone";
import { TimezoneDialog } from "../src/components/TimezoneDialog";
beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute("open", "");
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute("open");
	};
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
function Clock({
	action,
	update,
}: {
	action: () => Promise<boolean>;
	update: () => Promise<void>;
}) {
	const timezone = useClockTimezone("Europe/Berlin");
	return (
		<>
			<button onClick={() => timezone.run(action)}>Clock in</button>
			<TimezoneDialog
				savedZone="Europe/Berlin"
				deviceZone={timezone.deviceZone}
				onCancel={timezone.cancel}
				onContinue={timezone.continueOnce}
				onUpdate={async () => {
					timezone.cancel();
					await update();
				}}
			/>
		</>
	);
}
describe("device timezone choice before self clocking", () => {
	it("uses matching native timezone without another prompt", async () => {
		native.invoke.mockResolvedValue("Europe/Berlin");
		const action = vi.fn(async () => true);
		render(<Clock action={action} update={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: "Clock in" }));
		expect(action).toHaveBeenCalledOnce();
		expect(screen.queryByRole("dialog")).toBeNull();
	});
	it("cancels without recording or changing the saved preference", async () => {
		native.invoke.mockResolvedValue("America/New_York");
		const action = vi.fn(async () => true),
			update = vi.fn();
		render(<Clock action={action} update={update} />);
		await userEvent.click(screen.getByRole("button", { name: "Clock in" }));
		expect(await screen.findByRole("dialog")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(action).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});
	it("continues only the selected action, and offers a separate saved-preference workflow", async () => {
		native.invoke.mockResolvedValue("America/New_York");
		const action = vi.fn(async () => true),
			update = vi.fn(async () => {});
		render(<Clock action={action} update={update} />);
		await userEvent.click(screen.getByRole("button", { name: "Clock in" }));
		await userEvent.click(
			await screen.findByRole("button", { name: "Continue once" }),
		);
		expect(action).toHaveBeenCalledOnce();
		expect(update).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Clock in" }));
		await userEvent.click(
			await screen.findByRole("button", {
				name: "Update saved timezone in Z8",
			}),
		);
		expect(update).toHaveBeenCalledOnce();
		expect(action).toHaveBeenCalledOnce();
	});
});
