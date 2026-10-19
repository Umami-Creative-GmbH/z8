/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	KioskAdminData,
	KioskData,
	KioskRefusalData,
} from "@/app/[locale]/(app)/settings/kiosks/actions";
import { KioskSettings } from "./kiosk-settings";

const mocks = vi.hoisted(() => ({
	createKioskAction: vi.fn(),
	updateKioskAction: vi.fn(),
	issueKioskPairingCodeAction: vi.fn(),
	revokeKioskAction: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/kiosks/actions", () => ({
	createKioskAction: mocks.createKioskAction,
	updateKioskAction: mocks.updateKioskAction,
	issueKioskPairingCodeAction: mocks.issueKioskPairingCodeAction,
	revokeKioskAction: mocks.revokeKioskAction,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/settings/timezone-picker", () => ({
	TimezonePicker: ({ value, onChange }: { value: string; onChange: (zone: string) => void }) => (
		<input
			aria-label="Time zone"
			value={value}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

const store = { id: "11111111-1111-4111-8111-111111111111", name: "Store" };

function kiosk(overrides: Partial<KioskData> = {}): KioskData {
	return {
		id: "22222222-2222-4222-8222-222222222222",
		name: "Front door",
		locationId: store.id,
		locationName: store.name,
		timezone: "Europe/Berlin",
		boardEnabled: false,
		offlineModeEnabled: false,
		badgeScannerEnabled: false,
		badgeCameraEnabled: false,
		status: "paired",
		pairingCodeExpiresAt: null,
		pairedAt: "2026-10-01T08:00:00.000Z",
		lastSeenAt: "2026-10-10T07:30:00.000Z",
		revokedAt: null,
		...overrides,
	};
}

function refusal(overrides: Partial<KioskRefusalData> = {}): KioskRefusalData {
	return {
		id: "55555555-5555-4555-8555-555555555555",
		kioskId: kiosk().id,
		kioskName: "Front door",
		timezone: "Europe/Berlin",
		employeeName: "Wanda Worker",
		action: "clock_in",
		claimedAt: "2026-10-10T05:00:00.000Z",
		timeSource: "device_clock",
		reason: "wrong_pin",
		refusedAt: "2026-10-10T09:00:00.000Z",
		...overrides,
	};
}

function renderSettings(
	kiosks: KioskData[] = [],
	options: { organizationAdopted?: boolean; refusals?: KioskRefusalData[] } = {},
) {
	const data: KioskAdminData = {
		kiosks,
		locations: [store],
		organizationTimezone: "America/New_York",
		organizationAdopted: options.organizationAdopted ?? false,
		refusals: options.refusals ?? [],
	};
	return render(<KioskSettings data={data} />);
}

describe("KioskSettings", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows each kiosk's location, zone, state and when it was last seen in its own zone", () => {
		renderSettings([kiosk()]);

		const row = screen.getByRole("row", { name: /Front door/ });
		expect(within(row).getByText("Store")).toBeTruthy();
		expect(within(row).getByText("Paired")).toBeTruthy();
		expect(within(row).getByText(/9:30\sAM \(Europe\/Berlin\)/)).toBeTruthy();
	});

	it("creates a kiosk in the organization's zone by default and shows its pairing code with a QR link", async () => {
		mocks.createKioskAction.mockResolvedValue({
			success: true,
			data: {
				kioskId: "33333333-3333-4333-8333-333333333333",
				pairingCode: "ABCDE-FGHJK",
				expiresAt: "2026-10-10T08:10:00.000Z",
			},
		});
		renderSettings();

		fireEvent.click(screen.getByRole("button", { name: "Add kiosk" }));
		// The organization's zone, never the admin's browser zone (#761).
		expect((screen.getByLabelText("Time zone") as HTMLInputElement).value).toBe("America/New_York");
		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Back door" } });
		fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Europe/Vienna" } });
		fireEvent.click(screen.getByRole("button", { name: "Create kiosk" }));

		await waitFor(() =>
			expect(mocks.createKioskAction).toHaveBeenCalledWith({
				name: "Back door",
				locationId: store.id,
				timezone: "Europe/Vienna",
			}),
		);
		expect(await screen.findByText("ABCDE-FGHJK")).toBeTruthy();
		expect(screen.getByTestId("kiosk-pairing-url").textContent).toBe(
			`${window.location.origin}/en/kiosk?code=ABCDE-FGHJK`,
		);
	});

	it("warns that pairing again stops the current device, then shows the new code", async () => {
		mocks.issueKioskPairingCodeAction.mockResolvedValue({
			success: true,
			data: {
				kioskId: kiosk().id,
				pairingCode: "MNPQR-STVWX",
				expiresAt: "2026-10-10T08:10:00.000Z",
			},
		});
		renderSettings([kiosk()]);

		fireEvent.click(screen.getByRole("button", { name: "Pair again" }));
		expect(screen.getByText(/stops working immediately/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Rotate token and pair again" }));

		await waitFor(() =>
			expect(mocks.issueKioskPairingCodeAction).toHaveBeenCalledWith({ kioskId: kiosk().id }),
		);
		expect(await screen.findByText("MNPQR-STVWX")).toBeTruthy();
	});

	it("revokes a kiosk after confirmation", async () => {
		mocks.revokeKioskAction.mockResolvedValue({ success: true, data: { kioskId: kiosk().id } });
		renderSettings([kiosk()]);

		fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
		fireEvent.click(screen.getByRole("button", { name: "Revoke kiosk" }));

		await waitFor(() =>
			expect(mocks.revokeKioskAction).toHaveBeenCalledWith({ kioskId: kiosk().id }),
		);
		expect(mocks.refresh).toHaveBeenCalled();
	});

	describe("attached-scanner badge input (#1366)", () => {
		it("is off by default and an admin switches it on for one kiosk", async () => {
			mocks.updateKioskAction.mockResolvedValue({ success: true, data: { kioskId: kiosk().id } });
			renderSettings([kiosk()]);
			expect(screen.queryByText(/Badge scanner on/)).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));
			const scanner = screen.getByRole("switch", { name: "Badge scanner" });
			expect(scanner.getAttribute("aria-checked")).toBe("false");
			fireEvent.click(scanner);
			fireEvent.click(screen.getByRole("button", { name: "Save" }));

			await waitFor(() =>
				expect(mocks.updateKioskAction).toHaveBeenCalledWith(
					expect.objectContaining({ kioskId: kiosk().id, badgeScannerEnabled: true }),
				),
			);
		});

		it("shows which kiosks accept badges and lets an admin switch it off", async () => {
			mocks.updateKioskAction.mockResolvedValue({ success: true, data: { kioskId: kiosk().id } });
			renderSettings([kiosk({ badgeScannerEnabled: true })]);
			expect(screen.getByText(/Badge scanner on/)).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));
			fireEvent.click(screen.getByRole("switch", { name: "Badge scanner" }));
			fireEvent.click(screen.getByRole("button", { name: "Save" }));

			await waitFor(() =>
				expect(mocks.updateKioskAction).toHaveBeenCalledWith(
					expect.objectContaining({ badgeScannerEnabled: false }),
				),
			);
		});
	});

	describe("camera badge input (#1367)", () => {
		it("is off by default and switches on without touching the scanner", async () => {
			mocks.updateKioskAction.mockResolvedValue({ success: true, data: { kioskId: kiosk().id } });
			renderSettings([kiosk()]);
			expect(screen.queryByText(/Badge camera on/)).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));
			const camera = screen.getByRole("switch", { name: "Badge camera" });
			expect(camera.getAttribute("aria-checked")).toBe("false");
			fireEvent.click(camera);
			expect(
				screen.getByRole("switch", { name: "Badge scanner" }).getAttribute("aria-checked"),
			).toBe("false");
			fireEvent.click(screen.getByRole("button", { name: "Save" }));

			await waitFor(() =>
				expect(mocks.updateKioskAction).toHaveBeenCalledWith(
					expect.objectContaining({
						kioskId: kiosk().id,
						badgeCameraEnabled: true,
						badgeScannerEnabled: false,
					}),
				),
			);
		});

		it("shows each input on its own and switches the camera off while the scanner stays on", async () => {
			mocks.updateKioskAction.mockResolvedValue({ success: true, data: { kioskId: kiosk().id } });
			renderSettings([kiosk({ badgeScannerEnabled: true, badgeCameraEnabled: true })]);
			expect(screen.getByText(/Badge scanner on/)).toBeTruthy();
			expect(screen.getByText(/Badge camera on/)).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));
			fireEvent.click(screen.getByRole("switch", { name: "Badge camera" }));
			fireEvent.click(screen.getByRole("button", { name: "Save" }));

			await waitFor(() =>
				expect(mocks.updateKioskAction).toHaveBeenCalledWith(
					expect.objectContaining({ badgeCameraEnabled: false, badgeScannerEnabled: true }),
				),
			);
		});
	});

	describe("offline mode (#1287)", () => {
		it("lets an admin of an adopted organization switch it on", async () => {
			mocks.updateKioskAction.mockResolvedValue({ success: true, data: { kioskId: kiosk().id } });
			renderSettings([kiosk()], { organizationAdopted: true });

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));
			const offline = screen.getByRole("switch", { name: "Offline mode" });
			expect(offline.getAttribute("aria-checked")).toBe("false");
			expect((offline as HTMLButtonElement).disabled).toBe(false);
			fireEvent.click(offline);
			fireEvent.click(screen.getByRole("button", { name: "Save" }));

			await waitFor(() =>
				expect(mocks.updateKioskAction).toHaveBeenCalledWith(
					expect.objectContaining({ kioskId: kiosk().id, offlineModeEnabled: true }),
				),
			);
		});

		it("cannot be switched on in a legacy organization, and says why", () => {
			renderSettings([kiosk()], { organizationAdopted: false });

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));

			const offline = screen.getByRole("switch", { name: "Offline mode" });
			expect((offline as HTMLButtonElement).disabled).toBe(true);
			expect(screen.getByText(/does not use yet/)).toBeTruthy();
		});

		it("can still be switched off after the organization returned to legacy", async () => {
			mocks.updateKioskAction.mockResolvedValue({ success: true, data: { kioskId: kiosk().id } });
			renderSettings([kiosk({ offlineModeEnabled: true })], { organizationAdopted: false });

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));
			const offline = screen.getByRole("switch", { name: "Offline mode" });
			expect((offline as HTMLButtonElement).disabled).toBe(false);
			fireEvent.click(offline);
			fireEvent.click(screen.getByRole("button", { name: "Save" }));

			await waitFor(() =>
				expect(mocks.updateKioskAction).toHaveBeenCalledWith(
					expect.objectContaining({ offlineModeEnabled: false }),
				),
			);
		});

		it("shows in the list which kiosks have it on, and when it is not in effect", () => {
			renderSettings(
				[
					kiosk({ offlineModeEnabled: true }),
					kiosk({ id: "44444444-4444-4444-8444-444444444444", name: "Back door" }),
				],
				{ organizationAdopted: false },
			);

			const on = screen.getByRole("row", { name: /Front door/ });
			expect(within(on).getByText(/Offline mode on, not in effect/)).toBeTruthy();
			const off = screen.getByRole("row", { name: /Back door/ });
			expect(within(off).queryByText(/Offline mode/)).toBeNull();
		});

		it("explains a refusal for an organization that is not adopted", async () => {
			const { toast } = await import("sonner");
			mocks.updateKioskAction.mockResolvedValue({
				success: false,
				error: "Offline mode needs an adopted organization.",
				code: "offline_needs_adoption",
			});
			renderSettings([kiosk()], { organizationAdopted: true });

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));
			fireEvent.click(screen.getByRole("switch", { name: "Offline mode" }));
			fireEvent.click(screen.getByRole("button", { name: "Save" }));

			await waitFor(() =>
				expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/does not use yet/)),
			);
		});
	});

	describe("refused offline clockings (#1290)", () => {
		it("warns before rotating the token of an offline-mode kiosk that its queued clockings will be refused", () => {
			renderSettings([kiosk({ offlineModeEnabled: true })], { organizationAdopted: true });

			fireEvent.click(screen.getByRole("button", { name: "Pair again" }));

			expect(screen.getByText(/saved while offline and not yet sent are refused/)).toBeTruthy();
			expect(screen.getByRole("button", { name: "Rotate token and pair again" })).toBeTruthy();
		});

		it("does not warn for a kiosk without offline mode in effect", () => {
			renderSettings([kiosk({ offlineModeEnabled: true })], { organizationAdopted: false });

			fireEvent.click(screen.getByRole("button", { name: "Pair again" }));

			expect(screen.queryByText(/saved while offline/)).toBeNull();
		});

		it("lists each refused clocking with its kiosk, employee, action, claimed time, time source and reason", () => {
			renderSettings([kiosk({ offlineModeEnabled: true })], {
				organizationAdopted: true,
				refusals: [
					refusal(),
					refusal({
						id: "66666666-6666-4666-8666-666666666666",
						employeeName: null,
						action: "start_break",
						timeSource: "server_anchor",
						reason: "kiosk_rotated",
					}),
				],
			});

			const list = screen.getByRole("table", { name: "Refused offline clockings" });
			const first = within(list).getByRole("row", { name: /Wanda Worker/ });
			expect(within(first).getByText("Front door")).toBeTruthy();
			expect(within(first).getByText("Clock in")).toBeTruthy();
			// The claimed instant in the kiosk's zone, which the kiosk showed.
			expect(within(first).getByText(/7:00\sAM \(Europe\/Berlin\)/)).toBeTruthy();
			expect(within(first).getByText("Device clock")).toBeTruthy();
			expect(within(first).getByText("Wrong PIN")).toBeTruthy();
			const second = within(list).getByRole("row", { name: /Not an employee/ });
			expect(within(second).getByText("Start break")).toBeTruthy();
			expect(within(second).getByText("Server time")).toBeTruthy();
			expect(within(second).getByText("Kiosk revoked or paired again")).toBeTruthy();
		});

		it("shows no list while nothing was refused and no kiosk has offline mode", () => {
			renderSettings([kiosk()]);

			expect(screen.queryByText("Refused offline clockings")).toBeNull();
		});
	});

	it("offers no management for a revoked kiosk", () => {
		renderSettings([kiosk({ status: "revoked", revokedAt: "2026-10-09T10:00:00.000Z" })]);

		const row = screen.getByRole("row", { name: /Front door/ });
		expect(within(row).getByText("Revoked")).toBeTruthy();
		expect(within(row).queryByRole("button")).toBeNull();
	});
});
