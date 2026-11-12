/* @vitest-environment jsdom */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	toggle: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/organization/actions", () => ({
	toggleOrganizationFeature: mocks.toggle,
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { OrganizationFeaturesCard } = await import("./organization-features-card");

function renderCard(input: {
	personnelFilesEnabled?: boolean;
	equipmentEnabled?: boolean;
	equipmentOutstandingReturns?: number;
	role: "owner" | "admin" | "member";
}) {
	return render(
		<OrganizationFeaturesCard
			shiftsEnabled={false}
			projectsEnabled={false}
			surchargesEnabled={false}
			demoDataEnabled={true}
			worksCouncilEnabled={false}
			billableTimeEnabled={false}
			billableCurrency={null}
			personnelFilesEnabled={input.personnelFilesEnabled ?? false}
			equipmentEnabled={input.equipmentEnabled ?? false}
			equipmentOutstandingReturns={input.equipmentOutstandingReturns}
			currentMemberRole={input.role}
		/>,
	);
}

describe("OrganizationFeaturesCard personnel files toggle (#865)", () => {
	beforeEach(() => {
		mocks.toggle.mockReset().mockResolvedValue({ success: true, data: undefined });
	});
	afterEach(cleanup);

	it("lets an admin turn personnel files on without confirmation", async () => {
		renderCard({ personnelFilesEnabled: false, role: "admin" });

		fireEvent.click(screen.getByRole("switch", { name: "Toggle personnel files" }));

		await waitFor(() =>
			expect(mocks.toggle).toHaveBeenCalledWith({ feature: "personnelFilesEnabled", enabled: true }),
		);
	});

	it("asks before turning personnel files off and says documents stay stored", async () => {
		renderCard({ personnelFilesEnabled: true, role: "admin" });

		fireEvent.click(screen.getByRole("switch", { name: "Toggle personnel files" }));

		expect(mocks.toggle).not.toHaveBeenCalled();
		expect(
			await screen.findByText(
				"Personnel file pages and downloads are hidden for everyone. Documents stay stored and still count for retention. Turning personnel files back on restores everything.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

		await waitFor(() =>
			expect(mocks.toggle).toHaveBeenCalledWith({ feature: "personnelFilesEnabled", enabled: false }),
		);
	});

	it("keeps personnel files on when the confirmation is cancelled", async () => {
		renderCard({ personnelFilesEnabled: true, role: "owner" });

		fireEvent.click(screen.getByRole("switch", { name: "Toggle personnel files" }));
		fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

		expect(mocks.toggle).not.toHaveBeenCalled();
		expect(
			screen.getByRole("switch", { name: "Toggle personnel files" }).getAttribute("aria-checked"),
		).toBe("true");
	});

	it("leaves the other features owner-only", () => {
		renderCard({ personnelFilesEnabled: false, role: "admin" });

		expect(
			screen.getByRole("switch", { name: "Toggle work shifts" }).hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen.getByRole("switch", { name: "Toggle personnel files" }).hasAttribute("disabled"),
		).toBe(false);
	});
});

describe("OrganizationFeaturesCard equipment toggle (#1572)", () => {
	beforeEach(() => {
		mocks.toggle.mockReset().mockResolvedValue({ success: true, data: undefined });
	});
	afterEach(cleanup);

	it("lets an admin turn equipment on without confirmation", async () => {
		renderCard({ equipmentEnabled: false, role: "admin" });

		fireEvent.click(screen.getByRole("switch", { name: "Toggle equipment" }));

		await waitFor(() =>
			expect(mocks.toggle).toHaveBeenCalledWith({ feature: "equipmentEnabled", enabled: true }),
		);
	});

	it("warns with the outstanding returns before turning equipment off", async () => {
		renderCard({ equipmentEnabled: true, equipmentOutstandingReturns: 3, role: "admin" });

		fireEvent.click(screen.getByRole("switch", { name: "Toggle equipment" }));

		expect(mocks.toggle).not.toHaveBeenCalled();
		expect(
			await screen.findByText(
				"3 returns are still outstanding. They stay recorded, but nobody can record receipts while equipment is off.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

		await waitFor(() =>
			expect(mocks.toggle).toHaveBeenCalledWith({ feature: "equipmentEnabled", enabled: false }),
		);
	});

	it("leaves out the outstanding warning when nothing is outstanding", async () => {
		renderCard({ equipmentEnabled: true, equipmentOutstandingReturns: 0, role: "owner" });

		fireEvent.click(screen.getByRole("switch", { name: "Toggle equipment" }));

		expect(await screen.findByText("Turn off equipment?")).toBeTruthy();
		expect(screen.queryByText(/still outstanding/)).toBeNull();
	});

	it("does not let members switch equipment", () => {
		renderCard({ equipmentEnabled: false, role: "member" });

		expect(
			screen.getByRole("switch", { name: "Toggle equipment" }).hasAttribute("disabled"),
		).toBe(true);
	});
});
