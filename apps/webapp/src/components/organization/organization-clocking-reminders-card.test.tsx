/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CLOCKING_REMINDER_SETTINGS } from "@/lib/time-tracking/clocking-reminders/settings-policy";
import { createTestTolgee } from "@/test/render-with-translations";

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
vi.mock("@/app/[locale]/(app)/settings/organizations/clocking-reminder-actions", () => ({
	updateClockingReminderSettings: mocks.save,
}));

import { OrganizationClockingRemindersCard } from "./organization-clocking-reminders-card";

function show(role: "owner" | "admin" | "member" = "admin") {
	return render(
		<TolgeeProvider tolgee={createTestTolgee("en", {})}>
			<OrganizationClockingRemindersCard
				organizationId="org-1"
				settings={DEFAULT_CLOCKING_REMINDER_SETTINGS}
				currentMemberRole={role}
			/>
		</TolgeeProvider>,
	);
}

describe("OrganizationClockingRemindersCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.save.mockImplementation(async (input) => ({
			success: true,
			data: { ...input, revision: 1 },
		}));
	});
	afterEach(cleanup);

	it("shows every reminder off with its default minutes and every role selected", () => {
		show();
		for (const name of [
			"Missed clock-in reminder",
			"Forgotten clock-out reminder",
			"Break-due reminder",
		])
			expect(screen.getByRole("switch", { name }).getAttribute("aria-checked")).toBe("false");
		expect(screen.getByLabelText("Minutes after the expected start")).toHaveProperty("value", "15");
		expect(screen.getByLabelText("Minutes after the expected end")).toHaveProperty("value", "30");
		expect(screen.getByLabelText("Minutes before the break is due")).toHaveProperty("value", "15");
		for (const name of ["Admins", "Managers", "Employees"])
			expect(screen.getByRole("checkbox", { name }).getAttribute("aria-checked")).toBe("true");
	});

	it("saves enabled reminders, edited grace minutes and the chosen roles", async () => {
		show();
		fireEvent.click(screen.getByRole("switch", { name: "Missed clock-in reminder" }));
		fireEvent.change(screen.getByLabelText("Minutes after the expected start"), {
			target: { value: "10" },
		});
		fireEvent.click(screen.getByRole("switch", { name: "Break-due reminder" }));
		fireEvent.change(screen.getByLabelText("Minutes before the break is due"), {
			target: { value: "20" },
		});
		fireEvent.click(screen.getByRole("checkbox", { name: "Admins" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(mocks.save).toHaveBeenCalledWith({
				organizationId: "org-1",
				missedClockIn: { enabled: true, graceMinutes: 10 },
				forgottenClockOut: { enabled: false, graceMinutes: 30 },
				breakDue: { enabled: true, leadMinutes: 20 },
				roles: ["manager", "employee"],
			}),
		);
		await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
		expect((await screen.findByRole("status")).textContent).toBe(
			"Clocking reminder settings saved",
		);
	});

	it.each(["-1", "1441", "2.5", ""])("rejects %j grace minutes without saving", async (value) => {
		show();
		fireEvent.change(screen.getByLabelText("Minutes after the expected end"), {
			target: { value },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/minutes/i));
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it.each(["0", "1441", "2.5", ""])("rejects %j lead minutes without saving", async (value) => {
		show();
		fireEvent.change(screen.getByLabelText("Minutes before the break is due"), {
			target: { value },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/1 to 1440/));
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("marks only the invalid minutes input and describes it by its own error", async () => {
		show();
		const lead = screen.getByLabelText("Minutes before the break is due");
		fireEvent.change(lead, { target: { value: "0" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		const alert = await screen.findByRole("alert");
		expect(screen.getAllByRole("alert")).toHaveLength(1);
		expect(lead.getAttribute("aria-invalid")).toBe("true");
		expect(lead.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
		for (const label of ["Minutes after the expected start", "Minutes after the expected end"]) {
			const input = screen.getByLabelText(label);
			expect(input.getAttribute("aria-invalid")).not.toBe("true");
			expect(input.getAttribute("aria-describedby")?.split(" ")).not.toContain(alert.id);
		}
	});

	it("saves once the invalid minutes are corrected", async () => {
		show();
		const lead = screen.getByLabelText("Minutes before the break is due");
		fireEvent.change(lead, { target: { value: "0" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await screen.findByRole("alert");
		fireEvent.change(lead, { target: { value: "5" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(mocks.save).toHaveBeenCalledWith(
				expect.objectContaining({ breakDue: { enabled: false, leadMinutes: 5 } }),
			),
		);
		expect(screen.queryByRole("alert")).toBeNull();
		expect(lead.getAttribute("aria-invalid")).not.toBe("true");
	});

	it("requires at least one role", async () => {
		show();
		for (const name of ["Admins", "Managers", "Employees"])
			fireEvent.click(screen.getByRole("checkbox", { name }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/role/i));
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("shows a server refusal", async () => {
		mocks.save.mockResolvedValue({ success: false, error: "Access refused" });
		show();
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Access refused"));
		expect(mocks.error).toHaveBeenCalledWith("Access refused");
	});

	it("is read-only for members", () => {
		show("member");
		expect(screen.getByRole("switch", { name: "Missed clock-in reminder" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(screen.getByRole("checkbox", { name: "Admins" }).getAttribute("aria-disabled")).toBe(
			"true",
		);
		expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
	});
});
