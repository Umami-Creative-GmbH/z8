/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskClockAttemptOutcome,
	type KioskClockResult,
	type KioskDeviceInfo,
	type KioskEmployeeSnapshot,
} from "@/lib/time-tracking/kiosk/protocol";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	usePathname: () => "/kiosk",
	useRouter: () => ({ replace: navigation.replace }),
}));

/**
 * The on-device QR decoder, controlled by the test: each frame the kiosk reads
 * yields the next queued text (or nothing). `available: false` is a browser
 * that cannot read QR codes live.
 */
const decoder = vi.hoisted(() => ({
	available: true,
	frames: [] as Array<string | null>,
	reads: 0,
}));
vi.mock("@/lib/time-tracking/kiosk/camera-qr-decoder", () => ({
	createKioskQrDecoder: async () =>
		decoder.available
			? {
					read: async () => {
						decoder.reads += 1;
						return decoder.frames.length > 0 ? (decoder.frames.shift() ?? null) : null;
					},
				}
			: null,
}));

const { KioskApp } = await import("./kiosk-app");

/**
 * #1367: kiosk badges read with the kiosk's own camera, through the kiosk page
 * with the kiosk endpoints stubbed at `fetch`, the camera stubbed at
 * `navigator.mediaDevices.getUserMedia` and the QR decoder above. The camera
 * runs only between "Scan badge" on the home screen and the end of that scan.
 */
const kiosk: KioskDeviceInfo = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Front door",
	locationId: "11111111-1111-4111-8111-111111111111",
	locationName: "Store",
	timezone: "Europe/Berlin",
	boardEnabled: false,
	language: "en",
	offlineMode: false,
	badgeScannerEnabled: false,
	badgeCameraEnabled: true,
};

const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
const ben = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Ben Özdemir" };
const BADGE = "K8B0123456789ABCDEFGHJKMNPQRSTVWX0123456789ABCDEFGHJKMNP";
const OTHER_BADGE = "K8BXWVTSRQPNMKJHGFEDCBA9876543210XWVTSRQPNMKJHGFEDCBA987";
const UNCERTAIN_KEY = "z8.kiosk.uncertainAction";
const SCAN = "Scan badge";
const CANCEL = "Cancel scanning";
const LOOKING = "Hold your kiosk badge up to the camera";

const dayTotal = { date: "2026-10-10", timezone: "Europe/Berlin", minutes: 0 };
const clockedOut: KioskEmployeeSnapshot = {
	employee: anna,
	state: { status: "clocked_out" },
	dayTotal,
};
const clockedIn: KioskClockResult = {
	employee: anna,
	state: { status: "clocked_in", workPeriodId: "wp-1", since: "2026-10-10T06:30:00Z" },
	dayTotal,
	outcome: "executed",
	action: "clock_in",
	at: { instant: "2026-10-10T06:30:00Z", zone: "Europe/Berlin" },
};

type Call = { url: string; body: unknown; raw: unknown };
type Route = (call: Call) => Response | Promise<Response>;

function stubFetch(routes: Record<string, Route>) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const call = {
				url,
				raw: init?.body,
				body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
			};
			calls.push(call);
			const route = routes[url];
			return route ? route(call) : Response.json({}, { status: 404 });
		}),
	);
	return calls;
}

function kioskRoutes(
	extra: Record<string, Route> = {},
	device: KioskDeviceInfo = kiosk,
): Record<string, Route> {
	return {
		"/api/kiosk/session": () => Response.json({ kiosk: device }),
		"/api/kiosk/employees": () => Response.json({ employees: [anna, ben] }),
		"/api/kiosk/employee-status": () => Response.json(clockedOut),
		"/api/kiosk/clock": () => Response.json(clockedIn),
		...extra,
	};
}

function urls(calls: Call[], url: string) {
	return calls.filter((call) => call.url === url);
}

/** A device camera: each opened stream has one video track that records being stopped. */
function stubCamera(open?: () => Promise<MediaStream>) {
	const tracks: Array<{ live: () => boolean; end: () => void }> = [];
	function stream(): MediaStream {
		let stopped = false;
		const ended = new Set<() => void>();
		const track = {
			kind: "video",
			stop: () => {
				stopped = true;
			},
			live: () => !stopped,
			/** The camera went away on its own (unplugged, taken by another app). */
			end: () => {
				stopped = true;
				for (const listener of ended) listener();
			},
			addEventListener: (type: string, listener: () => void) => {
				if (type === "ended") ended.add(listener);
			},
			removeEventListener: (type: string, listener: () => void) => {
				if (type === "ended") ended.delete(listener);
			},
		};
		tracks.push(track);
		return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
	}
	const getUserMedia = vi.fn(open ?? (async () => stream()));
	Object.defineProperty(window.navigator, "mediaDevices", {
		configurable: true,
		value: { getUserMedia },
	});
	return {
		getUserMedia,
		tracks,
		stream,
		/** Whether some opened camera stream is still running. */
		running: () => tracks.some((track) => track.live()),
	};
}

function cameraError(name: string) {
	return new DOMException("camera", name);
}

/** A person typing into the search box, a key at a time. */
async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

/** A keyboard-style scanner burst, as in the #1366 suite. */
function scanKeys(text: string) {
	const target = document.activeElement ?? document.body;
	for (const key of text) fireEvent.keyDown(target, { key });
	fireEvent.keyDown(target, { key: "Enter" });
}

async function openHome() {
	render(<KioskApp />);
	await screen.findByRole("button", { name: /Anna Berger/ });
}

async function startScan() {
	fireEvent.click(screen.getByRole("button", { name: SCAN }));
	await screen.findByRole("heading", { name: LOOKING });
}

describe("kiosk badge clocking with the kiosk camera (#1367)", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_device-token");
		window.history.replaceState(null, "", "/en/kiosk");
		navigation.replace.mockReset();
		decoder.available = true;
		decoder.frames = [];
		decoder.reads = 0;
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		Reflect.deleteProperty(window.navigator, "mediaDevices");
	});

	it("opens the camera only on Scan badge, reads the badge on the device, stops the camera and opens the employee", async () => {
		const camera = stubCamera();
		const calls = stubFetch(kioskRoutes());
		await openHome();
		// The home screen alone never opens the camera.
		await advance(1_000);
		expect(camera.getUserMedia).not.toHaveBeenCalled();

		await startScan();
		expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
		expect(camera.getUserMedia.mock.calls[0]?.[0]).toMatchObject({ audio: false, video: {} });
		expect(camera.running()).toBe(true);
		decoder.frames.push(null, BADGE);

		expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(camera.running()).toBe(false);
		expect(urls(calls, "/api/kiosk/employee-status").map((call) => call.body)).toEqual([
			{ badge: BADGE, badgeInput: "camera" },
		]);
		// Reading the badge recorded nothing.
		expect(urls(calls, "/api/kiosk/clock")).toEqual([]);

		fireEvent.click(screen.getByRole("button", { name: "Clock in" }));

		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Clocked in")).toBeTruthy();
		expect(urls(calls, "/api/kiosk/clock")[0]?.body).toEqual({
			employeeId: anna.id,
			badge: BADGE,
			badgeInput: "camera",
			action: "clock_in",
			operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
		});
		// The camera stayed off through the turn and its confirmation.
		expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
		// Only decoded text was ever sent: no frame, image or file.
		for (const call of calls)
			expect(call.raw === undefined || typeof call.raw === "string").toBe(true);
		expect(JSON.stringify(calls.map((call) => call.body))).not.toMatch(/data:image|base64/);
		expect(JSON.stringify(window.localStorage)).not.toContain(BADGE);

		await advance(10_500);
		expect(await screen.findByRole("button", { name: SCAN })).toBeTruthy();
		expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
	});

	it("identifies once: further frames of the same or another badge switch no one and do nothing", async () => {
		const camera = stubCamera();
		const calls = stubFetch(kioskRoutes());
		await openHome();
		await startScan();
		decoder.frames.push(BADGE, BADGE, OTHER_BADGE, OTHER_BADGE);

		await screen.findByRole("heading", { name: "Anna Berger" });
		await advance(2_000);

		expect(screen.getByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status")).toHaveLength(1);
		expect(urls(calls, "/api/kiosk/clock")).toEqual([]);
		expect(camera.running()).toBe(false);
	});

	it("says a code is no kiosk badge and keeps looking, never opening it", async () => {
		const camera = stubCamera();
		const calls = stubFetch(kioskRoutes());
		await openHome();
		await startScan();

		decoder.frames.push("https://example.test/en/kiosk?code=ABCDE-FGHJK");
		expect(
			await screen.findByText("This code is not a kiosk badge. Hold up your kiosk badge."),
		).toBeTruthy();
		expect(camera.running()).toBe(true);
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
		expect(`${window.location.pathname}${window.location.search}`).toBe("/en/kiosk");
		expect(navigation.replace).not.toHaveBeenCalled();

		decoder.frames.push(BADGE);
		expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
	});

	it("stops the camera on cancel and shows the names again", async () => {
		const camera = stubCamera();
		const calls = stubFetch(kioskRoutes());
		await openHome();
		await startScan();

		fireEvent.click(screen.getByRole("button", { name: CANCEL }));

		expect(await screen.findByRole("button", { name: /Anna Berger/ })).toBeTruthy();
		expect(camera.running()).toBe(false);
		const reads = decoder.reads;
		decoder.frames.push(BADGE);
		await advance(2_000);
		expect(decoder.reads).toBe(reads);
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
	});

	it("stops the camera after the kiosk's inactivity timeout and returns home", async () => {
		const camera = stubCamera();
		stubFetch(kioskRoutes());
		await openHome();
		await startScan();

		await advance(29_000);
		expect(camera.running()).toBe(true);
		await advance(1_500);

		expect(await screen.findByRole("button", { name: /Anna Berger/ })).toBeTruthy();
		expect(camera.running()).toBe(false);
	});

	it("stops the camera when the kiosk page is hidden or goes away", async () => {
		const camera = stubCamera();
		stubFetch(kioskRoutes());
		await openHome();
		await startScan();

		const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(await screen.findByRole("button", { name: /Anna Berger/ })).toBeTruthy();
		expect(camera.running()).toBe(false);
		hidden.mockRestore();

		await startScan();
		expect(camera.running()).toBe(true);
		cleanup();
		expect(camera.running()).toBe(false);
	});

	it("stops a camera that only opens after the scan was cancelled", async () => {
		let open: (stream: MediaStream) => void = () => undefined;
		const camera = stubCamera(
			() =>
				new Promise<MediaStream>((resolve) => {
					open = resolve;
				}),
		);
		stubFetch(kioskRoutes());
		await openHome();
		await startScan();

		fireEvent.click(screen.getByRole("button", { name: CANCEL }));
		await screen.findByRole("button", { name: /Anna Berger/ });
		await act(async () => {
			open(camera.stream());
		});

		expect(camera.tracks).toHaveLength(1);
		expect(camera.running()).toBe(false);
	});

	it.each([
		[
			"NotAllowedError",
			"The kiosk may not use the camera. Allow camera access for this page in the browser, or tap your name to use your PIN.",
		],
		["NotFoundError", "This kiosk has no camera that can scan. Tap your name to use your PIN."],
		[
			"NotReadableError",
			"The camera could not be started. Try again, or tap your name to use your PIN.",
		],
	])(
		"explains a camera that fails with %s and keeps the name-and-PIN way",
		async (name, message) => {
			stubCamera(async () => {
				throw cameraError(name);
			});
			const calls = stubFetch(kioskRoutes());
			await openHome();

			fireEvent.click(screen.getByRole("button", { name: SCAN }));

			expect((await screen.findByRole("alert")).textContent).toBe(message);
			fireEvent.click(screen.getByRole("button", { name: /Anna Berger/ }));
			expect(await screen.findByText("Enter your kiosk PIN")).toBeTruthy();
			expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
		},
	);

	it.each([
		["no camera access in this browser", { mediaDevices: false, decoder: true }],
		["no live QR reading in this browser", { mediaDevices: true, decoder: false }],
	])(
		"says live scanning is not supported with %s, without opening a camera",
		async (_case, setup) => {
			const camera = setup.mediaDevices ? stubCamera() : null;
			decoder.available = setup.decoder;
			stubFetch(kioskRoutes());
			await openHome();

			fireEvent.click(screen.getByRole("button", { name: SCAN }));

			expect((await screen.findByRole("alert")).textContent).toBe(
				"This browser cannot scan badges with the camera. Tap your name to use your PIN.",
			);
			if (camera) expect(camera.getUserMedia).not.toHaveBeenCalled();
			expect(screen.getByRole("button", { name: /Anna Berger/ })).toBeTruthy();
		},
	);

	it("says the camera stopped when its track ends while scanning", async () => {
		const camera = stubCamera();
		stubFetch(kioskRoutes());
		await openHome();
		await startScan();

		act(() => camera.tracks[0]?.end());

		expect((await screen.findByRole("alert")).textContent).toMatch(
			/The camera could not be started/,
		);
		expect(camera.running()).toBe(false);
	});

	it("opens no camera offline and says badge clocking needs a connection", async () => {
		const camera = stubCamera();
		const calls = stubFetch(kioskRoutes());
		await openHome();
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
		act(() => {
			window.dispatchEvent(new Event("offline"));
		});

		fireEvent.click(screen.getByRole("button", { name: SCAN }));

		expect(
			await screen.findByText("Badge clocking needs a connection. Nothing was recorded."),
		).toBeTruthy();
		expect(camera.getUserMedia).not.toHaveBeenCalled();
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
		expect(urls(calls, "/api/kiosk/commands")).toEqual([]);
	});

	describe("each input on its own switch", () => {
		it("offers no Scan badge while the camera input is off, and the scanner keeps working", async () => {
			const camera = stubCamera();
			const calls = stubFetch(
				kioskRoutes({}, { ...kiosk, badgeScannerEnabled: true, badgeCameraEnabled: false }),
			);
			await openHome();

			expect(screen.queryByRole("button", { name: SCAN })).toBeNull();
			expect(screen.getByText("Or scan your kiosk badge at the scanner.")).toBeTruthy();
			scanKeys(BADGE);

			expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
			expect(urls(calls, "/api/kiosk/employee-status").map((call) => call.body)).toEqual([
				{ badge: BADGE },
			]);
			expect(camera.getUserMedia).not.toHaveBeenCalled();
		});

		it("listens to no scanner at a camera-only kiosk, so typing in the search box stays typing", async () => {
			stubCamera();
			const calls = stubFetch(kioskRoutes());
			await openHome();
			expect(screen.queryByText("Or scan your kiosk badge at the scanner.")).toBeNull();

			scanKeys(BADGE);
			await advance(500);

			expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
			expect(screen.getByRole("button", { name: /Anna Berger/ })).toBeTruthy();
		});

		it("swallows a scanner burst while the camera is looking, at a kiosk with both inputs", async () => {
			const camera = stubCamera();
			const calls = stubFetch(kioskRoutes({}, { ...kiosk, badgeScannerEnabled: true }));
			await openHome();
			await startScan();

			scanKeys(OTHER_BADGE);
			await advance(500);

			expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
			expect(screen.getByRole("heading", { name: LOOKING })).toBeTruthy();
			expect(camera.running()).toBe(true);
		});

		it("closes the camera when an admin switches the camera input off meanwhile", async () => {
			const camera = stubCamera();
			let device = kiosk;
			stubFetch(kioskRoutes({ "/api/kiosk/session": () => Response.json({ kiosk: device }) }));
			await openHome();
			await startScan();

			device = { ...kiosk, badgeCameraEnabled: false };
			// The kiosk's next contact (its heartbeat) learns the change, while someone
			// keeps the scan screen from timing out.
			for (const ms of [25_000, 25_000]) {
				await advance(ms);
				fireEvent.pointerDown(screen.getByRole("heading", { name: LOOKING }));
			}
			await advance(11_000);

			expect(await screen.findByRole("button", { name: /Anna Berger/ })).toBeTruthy();
			expect(screen.queryByRole("button", { name: SCAN })).toBeNull();
			expect(camera.running()).toBe(false);
		});
	});

	it("resolves a camera turn's lost reply without the badge and without opening the camera", async () => {
		const camera = stubCamera();
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": () => {
					throw new TypeError("Failed to fetch");
				},
				"/api/kiosk/clock/outcome": () =>
					Response.json({ outcome: "not_recorded" } satisfies KioskClockAttemptOutcome),
			}),
		);
		await openHome();
		await startScan();
		decoder.frames.push(BADGE);
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		expect(
			await screen.findByRole("heading", { name: "Checking whether your action was recorded" }),
		).toBeTruthy();
		const stored = window.localStorage.getItem(UNCERTAIN_KEY) ?? "";
		expect(JSON.parse(stored)).toMatchObject({ via: "badge", employee: anna });
		expect(stored).not.toContain(BADGE);
		await advance(3_500);

		expect(
			await screen.findByText(
				"Your action was not recorded. Scan your badge again to choose it again.",
			),
		).toBeTruthy();
		expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
		expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
		expect(camera.running()).toBe(false);
	});
});
