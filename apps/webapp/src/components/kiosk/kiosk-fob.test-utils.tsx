import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { KioskDeviceInfo, KioskEmployeeSnapshot } from "@/lib/time-tracking/kiosk/protocol";
import { KioskApp } from "./kiosk-app";

/**
 * The shared setup of the kiosk fob page suites (#1505 registration, #1506
 * selection): a kiosk with its NFC fob reader on, two employees, the kiosk
 * endpoints stubbed at `fetch`, and an attached keyboard-style reader typing a
 * chip's serial number. Each suite mocks Tolgee and navigation itself.
 */
export const kiosk: KioskDeviceInfo = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Front door",
	locationId: "11111111-1111-4111-8111-111111111111",
	locationName: "Store",
	timezone: "Europe/Berlin",
	boardEnabled: false,
	language: "en",
	offlineMode: false,
	nfcFobReaderEnabled: true,
};

export const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
export const ben = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Ben Özdemir" };
/** A 7-byte chip serial number as an ACR1552U in hex mode types it. */
export const TYPED_SERIAL = "04a1b2c3d4e5f6";
export const SERIAL = "04A1B2C3D4E5F6";

export const clockedOut: KioskEmployeeSnapshot = {
	employee: anna,
	state: { status: "clocked_out" },
	dayTotal: { date: "2026-11-02", timezone: "Europe/Berlin", minutes: 0 },
};

export type Call = { url: string; body: Record<string, unknown> | null };
export type Route = (call: Call) => Response | Promise<Response>;

/** Answers `fetch` from `routes` by URL (404 otherwise) and records every call. */
export function stubFetch(routes: Record<string, Route>) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const call = { url, body: init?.body ? JSON.parse(String(init.body)) : null };
			calls.push(call);
			const route = routes[url];
			return route ? route(call) : Response.json({}, { status: 404 });
		}),
	);
	return calls;
}

/** The kiosk's session, name list and employee status, then the suite's own routes. */
export function kioskRoutes(
	routes: Record<string, Route>,
	device: KioskDeviceInfo = kiosk,
): Record<string, Route> {
	return {
		"/api/kiosk/session": () => Response.json({ kiosk: device }),
		"/api/kiosk/employees": () => Response.json({ employees: [anna, ben] }),
		"/api/kiosk/employee-status": () => Response.json(clockedOut),
		...routes,
	};
}

export function urls(calls: Call[], url: string) {
	return calls.filter((call) => call.url === url);
}

/** A keyboard-style reader typing `text` at once, then Enter. */
export function readKeys(text: string) {
	const target = document.activeElement ?? document.body;
	for (const key of text) {
		const capital = key !== key.toLowerCase();
		if (capital) fireEvent.keyDown(target, { key: "Shift", shiftKey: true });
		fireEvent.keyDown(target, { key, shiftKey: capital });
	}
	fireEvent.keyDown(target, { key: "Enter" });
}

export async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

export async function openHome() {
	render(<KioskApp />);
	await screen.findByRole("button", { name: /Anna Berger/ });
}

export function pressPin(pin: string) {
	for (const digit of pin) fireEvent.click(screen.getByRole("button", { name: digit }));
	fireEvent.click(screen.getByRole("button", { name: "OK" }));
}
