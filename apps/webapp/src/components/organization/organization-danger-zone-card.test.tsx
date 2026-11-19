/* @vitest-environment jsdom */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as authSchema from "@/db/auth-schema";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";
import { render } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	deleteOrganization: vi.fn(),
	recoverOrganization: vi.fn(),
	refresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/organization/actions", () => ({
	deleteOrganization: mocks.deleteOrganization,
	recoverOrganization: mocks.recoverOrganization,
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const { OrganizationDangerZoneCard } = await import("./organization-danger-zone-card");

const organization = {
	id: "org-1",
	name: "Acme",
	deletedAt: null,
} as typeof authSchema.organization.$inferSelect;

const deletedOrganization = {
	...organization,
	deletedAt: new Date("2026-11-18T10:00:00Z"),
} as typeof authSchema.organization.$inferSelect;

function renderCard(
	settingsAccess: SettingsAccess | null,
	org: typeof authSchema.organization.$inferSelect = organization,
) {
	return render(<OrganizationDangerZoneCard organization={org} settingsAccess={settingsAccess} />);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

async function openDeleteDialogAndConfirm() {
	fireEvent.click(screen.getByRole("button", { name: "Delete Organization" }));
	const input = await screen.findByLabelText('Type "Acme" to confirm');
	fireEvent.change(input, { target: { value: "Acme" } });
	const dialog = await screen.findByRole("alertdialog");
	const confirm = Array.from(dialog.querySelectorAll("button")).find(
		(button) => button.textContent === "Delete Organization",
	);
	if (!confirm) throw new Error("confirm button not found");
	fireEvent.click(confirm);
	return dialog;
}

describe("OrganizationDangerZoneCard by settings access", () => {
	afterEach(cleanup);

	it.each(["owner", "orgAdmin"] as const)("shows the delete control to an %s", (access) => {
		renderCard(access);

		expect(screen.getByRole("button", { name: /Delete Organization/ })).toBeTruthy();
	});

	it.each([
		["a scoped manager", "scopedManager"],
		["an org member", "member"],
		["a former employee (no settings access)", null],
	] as const)("shows nothing to %s", (_label, access) => {
		renderCard(access);

		expect(screen.queryByText("Danger Zone")).toBeNull();
		expect(screen.queryByRole("button", { name: /Delete Organization/ })).toBeNull();
	});
});

describe("OrganizationDangerZoneCard delete confirmation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(cleanup);

	it("keeps the dialog open with a pending label while deletion runs, then closes on success", async () => {
		const pending = deferred<{ success: true; data: undefined }>();
		mocks.deleteOrganization.mockReturnValue(pending.promise);
		renderCard("orgAdmin");

		const dialog = await openDeleteDialogAndConfirm();

		await waitFor(() => expect(dialog.textContent).toContain("Deleting..."));
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
		expect(mocks.deleteOrganization).toHaveBeenCalledWith({ confirmationName: "Acme" });

		pending.resolve({ success: true, data: undefined });

		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(mocks.toastSuccess).toHaveBeenCalled();
		expect(mocks.refresh).toHaveBeenCalled();
	});

	it("shows the failure inside the open dialog and keeps the typed name", async () => {
		mocks.deleteOrganization.mockResolvedValue({
			success: false,
			error: "Organization is already scheduled for deletion",
		});
		renderCard("owner");

		await openDeleteDialogAndConfirm();

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe("Organization is already scheduled for deletion");
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(
			(screen.getByLabelText('Type "Acme" to confirm') as HTMLInputElement).value,
		).toBe("Acme");
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Organization is already scheduled for deletion",
		);
		expect(mocks.refresh).not.toHaveBeenCalled();
	});

	it("does not submit until the organization name is typed", async () => {
		renderCard("owner");

		fireEvent.click(screen.getByRole("button", { name: "Delete Organization" }));
		const dialog = await screen.findByRole("alertdialog");
		const confirm = Array.from(dialog.querySelectorAll("button")).find(
			(button) => button.textContent === "Delete Organization",
		);

		expect(confirm).toHaveProperty("disabled", true);
	});
});

describe("OrganizationDangerZoneCard recover confirmation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(cleanup);

	it("keeps the dialog open while recovery runs and shows a failure inline", async () => {
		const pending = deferred<{ success: false; error: string }>();
		mocks.recoverOrganization.mockReturnValue(pending.promise);
		renderCard("orgAdmin", deletedOrganization);

		fireEvent.click(screen.getByRole("button", { name: "Recover Organization" }));
		const dialog = await screen.findByRole("alertdialog");
		const confirm = Array.from(dialog.querySelectorAll("button")).find(
			(button) => button.textContent === "Recover Organization",
		);
		if (!confirm) throw new Error("confirm button not found");
		fireEvent.click(confirm);

		await waitFor(() => expect(dialog.textContent).toContain("Recovering..."));
		expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);

		pending.resolve({ success: false, error: "Organization is not scheduled for deletion" });

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe("Organization is not scheduled for deletion");
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(mocks.refresh).not.toHaveBeenCalled();
	});

	it("closes the dialog after a successful recovery", async () => {
		mocks.recoverOrganization.mockResolvedValue({ success: true, data: undefined });
		renderCard("owner", deletedOrganization);

		fireEvent.click(screen.getByRole("button", { name: "Recover Organization" }));
		const dialog = await screen.findByRole("alertdialog");
		const confirm = Array.from(dialog.querySelectorAll("button")).find(
			(button) => button.textContent === "Recover Organization",
		);
		if (!confirm) throw new Error("confirm button not found");
		fireEvent.click(confirm);

		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(mocks.toastSuccess).toHaveBeenCalled();
		expect(mocks.refresh).toHaveBeenCalled();
	});
});
