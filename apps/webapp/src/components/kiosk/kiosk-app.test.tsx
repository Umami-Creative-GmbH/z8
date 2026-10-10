/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KIOSK_TOKEN_STORAGE_KEY, type KioskDeviceInfo } from "@/lib/kiosk/protocol";
import { KioskApp } from "./kiosk-app";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

const kiosk: KioskDeviceInfo = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Front door",
	locationId: "11111111-1111-4111-8111-111111111111",
	locationName: "Store",
	timezone: "Europe/Berlin",
	boardEnabled: false,
};

type Route = (request: { url: string; init: RequestInit | undefined }) => Response;

function stubFetch(route: Route) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url, init });
			return route({ url, init });
		}),
	);
	return calls;
}

function header(init: RequestInit | undefined, name: string): string | null {
	return new Headers(init?.headers).get(name);
}

describe("KioskApp", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.history.replaceState(null, "", "/en/kiosk");
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("pairs with the code from the QR link and keeps only the device token", async () => {
		window.history.replaceState(null, "", "/en/kiosk?code=ABCDE-FGHJK");
		const calls = stubFetch(({ url }) =>
			url === "/api/kiosk/pair"
				? Response.json({ token: "z8k_device-token", kiosk })
				: Response.json({}, { status: 404 }),
		);
		render(<KioskApp />);

		const input = (await screen.findByLabelText("Pairing code")) as HTMLInputElement;
		expect(input.value).toBe("ABCDE-FGHJK");
		expect(window.location.search).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Pair this device" }));

		expect(await screen.findByText("Front door")).toBeTruthy();
		expect(screen.getByText("Store")).toBeTruthy();
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({ code: "ABCDE-FGHJK" });
		expect(window.localStorage.getItem(KIOSK_TOKEN_STORAGE_KEY)).toBe("z8k_device-token");
		expect(window.localStorage.length).toBe(1);
	});

	it("explains a refused code and stays unpaired", async () => {
		stubFetch(() => Response.json({ code: "invalid_code" }, { status: 401 }));
		render(<KioskApp />);

		fireEvent.change(await screen.findByLabelText("Pairing code"), {
			target: { value: "ZZZZZ-ZZZZZ" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair this device" }));

		expect(await screen.findByText(/invalid or has expired/)).toBeTruthy();
		expect(window.localStorage.getItem(KIOSK_TOKEN_STORAGE_KEY)).toBeNull();
	});

	it("opens a paired device on its kiosk, authenticating with the device token header", async () => {
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_device-token");
		const calls = stubFetch(() => Response.json({ kiosk }));
		render(<KioskApp />);

		expect(await screen.findByText("Front door")).toBeTruthy();
		expect(calls[0].url).toBe("/api/kiosk/session");
		expect(header(calls[0].init, "x-kiosk-token")).toBe("z8k_device-token");
		expect(header(calls[0].init, "authorization")).toBeNull();
	});

	it("shows the revoked screen for a revoked kiosk", async () => {
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_device-token");
		stubFetch(() => Response.json({ code: "kiosk_revoked" }, { status: 401 }));
		render(<KioskApp />);

		expect(await screen.findByText(/contact your admin/i)).toBeTruthy();
		expect(screen.queryByLabelText("Pairing code")).toBeNull();
	});

	it("forgets a token that no longer works and offers pairing", async () => {
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_rotated-away");
		stubFetch(() => Response.json({ code: "kiosk_unknown" }, { status: 401 }));
		render(<KioskApp />);

		expect(await screen.findByLabelText("Pairing code")).toBeTruthy();
		await waitFor(() => expect(window.localStorage.getItem(KIOSK_TOKEN_STORAGE_KEY)).toBeNull());
	});

	it("says so when the server cannot be reached, without forgetting the pairing", async () => {
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_device-token");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);
		render(<KioskApp />);

		expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
		expect(window.localStorage.getItem(KIOSK_TOKEN_STORAGE_KEY)).toBe("z8k_device-token");
	});
});
