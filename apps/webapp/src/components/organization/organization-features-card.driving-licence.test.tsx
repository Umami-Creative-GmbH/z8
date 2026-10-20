/* @vitest-environment jsdom */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrivingLicenceFeatureState } from "@/lib/organization/driving-licence/policy";
import { render } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	switchControl: vi.fn(),
	impact: vi.fn(),
	refresh: vi.fn(),
	push: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	toggleOrganizationFeature: vi.fn(),
}));
vi.mock("@/lib/organization/driving-licence/policy-actions", () => ({
	switchDrivingLicenceControlAction: mocks.switchControl,
	getDrivingLicenceReactivationImpactAction: mocks.impact,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));

const { OrganizationFeaturesCard } = await import("./organization-features-card");

const neverActivated: DrivingLicenceFeatureState = {
	enabled: false,
	setupRequired: true,
	savedSetup: null,
};
const active: DrivingLicenceFeatureState = {
	enabled: true,
	setupRequired: false,
	savedSetup: { intervalMonths: 6, timezone: "Europe/Berlin" },
};

function renderCard(input: {
	drivingLicence: DrivingLicenceFeatureState;
	role?: "owner" | "admin" | "member";
}) {
	return render(
		<OrganizationFeaturesCard
			organizationId="org-1"
			shiftsEnabled={false}
			projectsEnabled={false}
			surchargesEnabled={false}
			demoDataEnabled={true}
			worksCouncilEnabled={false}
			billableTimeEnabled={false}
			billableCurrency={null}
			personnelFilesEnabled={false}
			organizationTimezone="Europe/Berlin"
			drivingLicence={input.drivingLicence}
			currentMemberRole={input.role ?? "admin"}
		/>,
	);
}

function drivingSwitch() {
	return screen.getByRole("switch", { name: "Toggle driving licence control" });
}

describe("OrganizationFeaturesCard driving licence control (#1421)", () => {
	beforeEach(() => {
		mocks.switchControl
			.mockReset()
			.mockResolvedValue({ success: true, data: { enabled: true, firstActivation: true } });
		mocks.impact
			.mockReset()
			.mockResolvedValue({ success: true, data: { suspendedAuthorizations: 0 } });
		mocks.push.mockReset();
		mocks.refresh.mockReset();
		mocks.toastError.mockReset();
	});
	afterEach(cleanup);

	it("shows the saved on/off value and lets owners and admins, not members, switch it", () => {
		renderCard({ drivingLicence: active, role: "admin" });
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("true");
		expect(drivingSwitch().hasAttribute("disabled")).toBe(false);
		expect(
			screen.getByText(
				"Only organization owners can change feature settings, except personnel files and driving licence control.",
			),
		).toBeTruthy();
		cleanup();

		renderCard({ drivingLicence: neverActivated, role: "owner" });
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("false");
		expect(drivingSwitch().hasAttribute("disabled")).toBe(false);
		cleanup();

		renderCard({ drivingLicence: active, role: "member" });
		expect(drivingSwitch().hasAttribute("disabled")).toBe(true);
		fireEvent.click(drivingSwitch());
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(mocks.switchControl).not.toHaveBeenCalled();
	});

	it("asks for retention, interval and timezone on the first switch-on, then opens the settings", async () => {
		renderCard({ drivingLicence: neverActivated });

		fireEvent.click(drivingSwitch());

		expect(await screen.findByRole("dialog")).toBeTruthy();
		expect(screen.getByText("Central European Time (Berlin)")).toBeTruthy();
		expect(
			screen.getByText(
				"Deadlines use this timezone. It can't be changed after driving licence control is switched on.",
			),
		).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: "Switch on" }));
		await waitFor(() =>
			expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
				"Enter 1 to 120 months.",
				"Enter 1 to 120 months.",
				"Explain the retention period in at least 10 characters.",
			]),
		);
		expect(mocks.switchControl).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Retention period (months)"), {
			target: { value: "24" },
		});
		fireEvent.change(screen.getByLabelText("Retention justification"), {
			target: { value: "Evidence of our internal original licence checks." },
		});
		fireEvent.change(screen.getByLabelText("Routine check interval (months)"), {
			target: { value: "6" },
		});
		await userEvent.click(screen.getByRole("button", { name: "Switch on" }));

		await waitFor(() =>
			expect(mocks.switchControl).toHaveBeenCalledWith({
				enabled: true,
				setup: {
					intervalMonths: 6,
					timezone: "Europe/Berlin",
					retentionMonths: 24,
					retentionJustification: "Evidence of our internal original licence checks.",
				},
			}),
		);
		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith("/settings/driving-licence?tab=intended-drivers"),
		);
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("true");
	});

	it("leaves control off when the setup is cancelled", async () => {
		renderCard({ drivingLicence: neverActivated });

		fireEvent.click(drivingSwitch());
		fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

		expect(mocks.switchControl).not.toHaveBeenCalled();
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("false");
	});

	it("shows how many authorizations will be suspended before switching an existing policy on again (#1422)", async () => {
		mocks.switchControl.mockResolvedValue({
			success: true,
			data: { enabled: true, firstActivation: false },
		});
		mocks.impact.mockResolvedValue({ success: true, data: { suspendedAuthorizations: 3 } });
		renderCard({ drivingLicence: { ...active, enabled: false } });

		fireEvent.click(drivingSwitch());

		expect(
			await screen.findByText(
				"3 authorizations will be suspended because their deadline or expiry passed while control was off.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(mocks.switchControl).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Switch on" }));

		await waitFor(() => expect(mocks.switchControl).toHaveBeenCalledWith({ enabled: true }));
		expect(mocks.push).not.toHaveBeenCalled();
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("true");
	});

	it("says when switching on again suspends nothing, and stays off when cancelled", async () => {
		mocks.impact.mockResolvedValue({ success: true, data: { suspendedAuthorizations: 0 } });
		renderCard({ drivingLicence: { ...active, enabled: false } });

		fireEvent.click(drivingSwitch());

		expect(
			await screen.findByText(
				"No authorization will be suspended: no deadline or expiry passed while control was off.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(mocks.switchControl).not.toHaveBeenCalled();
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("false");
	});

	it("doesn't switch on again when the impact can't be counted", async () => {
		mocks.impact.mockResolvedValue({ success: false, error: "save_failed" });
		renderCard({ drivingLicence: { ...active, enabled: false } });

		fireEvent.click(drivingSwitch());

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith(
				"Driving licence control could not be changed. Please try again.",
			),
		);
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(mocks.switchControl).not.toHaveBeenCalled();
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("false");
	});

	it("asks before switching off and explains that data is kept and cleanup continues", async () => {
		mocks.switchControl.mockResolvedValue({
			success: true,
			data: { enabled: false, firstActivation: false },
		});
		renderCard({ drivingLicence: active });

		fireEvent.click(drivingSwitch());

		expect(mocks.switchControl).not.toHaveBeenCalled();
		expect(
			await screen.findByText(
				"Intended drivers, verifier grants, check records and authorizations are kept, and deadlines keep running. Reminders and tasks stop. Evidence cleanup continues on the saved retention period.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Switch off" }));

		await waitFor(() => expect(mocks.switchControl).toHaveBeenCalledWith({ enabled: false }));
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("false");
	});

	it("keeps control on when switching off is cancelled", async () => {
		renderCard({ drivingLicence: active });

		fireEvent.click(drivingSwitch());
		fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

		expect(mocks.switchControl).not.toHaveBeenCalled();
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("true");
	});

	it("restores the switch and reports a refused change", async () => {
		mocks.switchControl.mockResolvedValue({ success: false, error: "forbidden" });
		renderCard({ drivingLicence: { ...active, enabled: false } });

		fireEvent.click(drivingSwitch());
		fireEvent.click(await screen.findByRole("button", { name: "Switch on" }));

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith(
				"You can't change driving licence control in this organization.",
			),
		);
		expect(drivingSwitch().getAttribute("aria-checked")).toBe("false");
	});
});
