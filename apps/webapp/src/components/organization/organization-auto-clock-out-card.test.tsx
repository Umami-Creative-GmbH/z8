/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTolgee } from "@/test/render-with-translations";
import deCatalog from "../../../messages/organization/de.json";

const mocks = vi.hoisted(() => ({
	save: vi.fn(),
	refresh: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
	toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/app/[locale]/(app)/settings/organizations/auto-clock-out-actions", () => ({
	updateAutoClockOutSettings: mocks.save,
}));

import { OrganizationAutoClockOutCard } from "./organization-auto-clock-out-card";

function show(role: "owner" | "admin" | "member" = "admin", minutes = 720, locale = "en") {
	const translations =
		locale === "de"
			? Object.fromEntries(
					Object.entries(deCatalog.organization.autoClockOut).map(([key, value]) => [
						`organization.autoClockOut.${key}`,
						value,
					]),
				)
			: {};
	return render(
		<TolgeeProvider tolgee={createTestTolgee(locale, translations)}>
			<OrganizationAutoClockOutCard
				organizationId="org-1"
				settings={{
					autoClockOutEnabled: true,
					maxUninterruptedMinutes: minutes,
					revision: 0,
				}}
				currentMemberRole={role}
			/>
		</TolgeeProvider>,
	);
}
describe("OrganizationAutoClockOutCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.save.mockResolvedValue({
			success: true,
			data: {
				autoClockOutEnabled: true,
				maxUninterruptedMinutes: 720,
				revision: 1,
			},
		});
	});
	afterEach(cleanup);
	it("renders enabled twelve-hour missing-row defaults with accessible labels and help", () => {
		show();
		expect(
			screen.getByRole("switch", { name: "Automatic clock-out" }).getAttribute("aria-checked"),
		).toBe("true");
		expect(screen.getByLabelText("Hours")).toHaveProperty("value", "12");
		expect(screen.getByLabelText("Minutes")).toHaveProperty("value", "0");
		expect(screen.getByText(/five minutes/)).toBeTruthy();
	});
	it("turns off without losing the saved duration, and re-enables it", async () => {
		show("owner", 485);
		fireEvent.click(screen.getByRole("switch"));
		expect(screen.getByLabelText("Hours")).toHaveProperty("value", "8");
		expect(screen.getByLabelText("Minutes")).toHaveProperty("value", "5");
		expect(screen.getByLabelText("Hours")).toHaveProperty("disabled", true);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(mocks.save).toHaveBeenCalledWith({
				organizationId: "org-1",
				autoClockOutEnabled: false,
				maxUninterruptedMinutes: 485,
			}),
		);
		await waitFor(() => expect(mocks.success).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("switch"));
		expect(screen.getByLabelText("Minutes")).toHaveProperty("value", "5");
	});
	it.each([
		["0", "0"],
		["-1", "5"],
		["1.5", "0"],
		["1", "60"],
		["", "5"],
	])("rejects invalid hours/minutes %s/%s without submission", async (hours, minutes) => {
		show();
		fireEvent.change(screen.getByLabelText("Hours"), {
			target: { value: hours },
		});
		fireEvent.change(screen.getByLabelText("Minutes"), {
			target: { value: minutes },
		});
		fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);
		await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/valid duration/i));
		expect(mocks.save).not.toHaveBeenCalled();
	});
	it("allows one pending save under rapid clicks and restores controls", async () => {
		let resolve!: (result: unknown) => void;
		mocks.save.mockReturnValue(
			new Promise((r) => {
				resolve = r;
			}),
		);
		show();
		const button = screen.getByRole("button", { name: "Save changes" });
		fireEvent.click(button);
		fireEvent.click(button);
		await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
		expect(button).toHaveProperty("disabled", true);
		expect(screen.getByRole("switch")).toHaveProperty("disabled", true);
		resolve({
			success: true,
			data: {
				autoClockOutEnabled: true,
				maxUninterruptedMinutes: 720,
				revision: 1,
			},
		});
		await waitFor(() => expect(button).toHaveProperty("disabled", false));
		expect(mocks.refresh).toHaveBeenCalledOnce();
	});
	it("shows server refusal and leaves the edited values available", async () => {
		mocks.save.mockResolvedValue({ success: false, error: "Access refused" });
		show();
		fireEvent.change(screen.getByLabelText("Hours"), {
			target: { value: "10" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Access refused"));
		expect(mocks.error).toHaveBeenCalledWith("Access refused");
		expect(screen.getByLabelText("Hours")).toHaveProperty("value", "10");
	});
	it("shows read-only settings for members", () => {
		show("member");
		expect(screen.getByRole("switch")).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
	});
	it("renders German catalog labels and save feedback", async () => {
		show("admin", 720, "de");
		expect(screen.getByRole("switch", { name: "Automatisches Ausstempeln" })).toBeTruthy();
		expect(screen.getByLabelText("Stunden")).toHaveProperty("value", "12");
		fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
		expect((await screen.findByRole("status")).textContent).toBe(
			"Einstellungen für automatisches Ausstempeln gespeichert",
		);
	});
	it("restores saving after a rejected request and shows fallback feedback", async () => {
		mocks.save.mockRejectedValueOnce(new Error("network failed"));
		show();
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect((await screen.findByRole("alert")).textContent).toBe(
			"Failed to update automatic clock-out settings",
		);
		expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", false);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await screen.findByRole("status");
		expect(mocks.save).toHaveBeenCalledTimes(2);
	});
	it("connects duration controls to help and validation feedback", async () => {
		show();
		const hours = screen.getByLabelText("Hours");
		const descriptionIds = hours.getAttribute("aria-describedby")?.split(" ") ?? [];
		expect(
			descriptionIds.some((id) =>
				document.getElementById(id)?.textContent?.includes("five minutes"),
			),
		).toBe(true);
		fireEvent.change(hours, { target: { value: "0" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await screen.findByRole("alert");
		expect(hours.getAttribute("aria-invalid")).toBe("true");
		expect(
			hours
				.getAttribute("aria-describedby")
				?.split(" ")
				.some((id) => document.getElementById(id)?.getAttribute("role") === "alert"),
		).toBe(true);
	});
	it("supports keyboard editing and skips disabled duration controls", async () => {
		const user = userEvent.setup();
		show();
		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole("switch"));
		await user.tab();
		expect(document.activeElement).toBe(screen.getByLabelText("Hours"));
		await user.tab();
		expect(document.activeElement).toBe(screen.getByLabelText("Minutes"));
		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save changes" }));
		await user.tab();
		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole("switch"));
		await user.keyboard(" ");
		expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save changes" }));
	});
});
