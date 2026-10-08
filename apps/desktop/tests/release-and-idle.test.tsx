import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
import { UpdateCheck } from "../src/components/UpdateCheck";
import { IdleDialog } from "../src/components/IdleDialog";
import { LocaleProvider } from "../src/lib/i18n";
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
describe("release and idle confirmation", () => {
	it("checks availability without installing, then sends only the explicitly selected version", async () => {
		native.invoke.mockImplementation(async (command: string) =>
			command === "check_for_updates"
				? { configured: true, version: "0.3.0" }
				: undefined,
		);
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<LocaleProvider language="de">
					<UpdateCheck />
				</LocaleProvider>
			</QueryClientProvider>,
		);
		const install = await screen.findByRole("button", {
			name: "Installieren und neu starten",
		});
		expect(native.invoke.mock.calls.map((call) => call[0])).toEqual([
			"check_for_updates",
		]);
		await userEvent.click(install);
		expect(native.invoke).toHaveBeenCalledWith("install_update", {
			version: "0.3.0",
		});
		client.clear();
	});
	it("shows an installation failure and allows a retry", async () => {
		native.invoke.mockImplementation(async (command: string) => {
			if (command === "check_for_updates")
				return { configured: true, version: "0.3.0" };
			throw new Error("Signature refused");
		});
		const client = new QueryClient();
		render(
			<QueryClientProvider client={client}>
				<UpdateCheck />
			</QueryClientProvider>,
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Install and restart" }),
		);
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Signature refused",
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Install and restart",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
		client.clear();
	});
	it("shows original travel zones and prevents confirming a break while status is unavailable", async () => {
		const confirm = vi.fn(),
			resume = vi.fn();
		render(
			<IdleDialog
				isOpen
				canRecord={false}
				idleEvent={{
					id: "span",
					idleStartTime: "2026-10-08T08:00:00Z",
					returnedAt: "2026-10-08T09:00:00Z",
					idleDurationMs: 3600000,
					review: null,
					startTimezone: "Europe/Berlin",
					returnTimezone: "Europe/London",
				}}
				onBreak={confirm}
				onResume={resume}
			/>,
		);
		expect(screen.getByText(/Europe\/Berlin/).textContent).toContain(
			"Europe/London",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "I was on break" }),
		);
		expect(confirm).not.toHaveBeenCalled();
		await userEvent.click(
			screen.getByRole("button", { name: "I was still working" }),
		);
		expect(resume).toHaveBeenCalledOnce();
	});
});
