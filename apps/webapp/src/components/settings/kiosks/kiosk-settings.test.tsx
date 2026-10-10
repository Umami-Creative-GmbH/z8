/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KioskAdminData, KioskData } from "@/app/[locale]/(app)/settings/kiosks/actions";
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
		status: "paired",
		pairingCodeExpiresAt: null,
		pairedAt: "2026-10-01T08:00:00.000Z",
		lastSeenAt: "2026-10-10T07:30:00.000Z",
		revokedAt: null,
		...overrides,
	};
}

function renderSettings(kiosks: KioskData[] = []) {
	const data: KioskAdminData = {
		kiosks,
		locations: [store],
		organizationTimezone: "America/New_York",
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

	it("offers no management for a revoked kiosk", () => {
		renderSettings([kiosk({ status: "revoked", revokedAt: "2026-10-09T10:00:00.000Z" })]);

		const row = screen.getByRole("row", { name: /Front door/ });
		expect(within(row).getByText("Revoked")).toBeTruthy();
		expect(within(row).queryByRole("button")).toBeNull();
	});
});
