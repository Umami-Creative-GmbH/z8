import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { createKioskOfflineCache } from "./offline-cache";
import { memoryKioskCacheStorage } from "./offline-cache.test.fixture";
import type { KioskDeviceInfo, KioskEmployeesResponse } from "./protocol";

/**
 * #1291: what an offline-mode kiosk keeps between contacts, and what it drops.
 */
const kiosk: KioskDeviceInfo = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Front door",
	locationId: "11111111-1111-4111-8111-111111111111",
	locationName: "Store",
	timezone: "Europe/Berlin",
	boardEnabled: true,
	language: "de",
	offlineMode: true,
};

const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
const ben = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Ben Özdemir" };

const listed: KioskEmployeesResponse = {
	employees: [anna, ben],
	offline: {
		learnedAt: "2026-10-16T07:45:00Z",
		states: {
			[anna.id]: { status: "clocked_in", workPeriodId: "wp-1", since: "2026-10-16T06:30:00Z" },
			[ben.id]: { status: "clocked_out" },
		},
	},
};

function cache() {
	const storage = memoryKioskCacheStorage();
	return { storage, cache: createKioskOfflineCache(() => storage) };
}

describe("kiosk offline cache (#1291)", () => {
	it("keeps the kiosk and its employees with their states and when the server read them", async () => {
		const { cache: offline } = cache();

		await offline.rememberKiosk(kiosk);
		await offline.rememberEmployees(kiosk.id, listed);

		expect(await offline.readKiosk()).toEqual(kiosk);
		expect(await offline.readEmployees(kiosk.id)).toEqual([
			{ ...anna, state: listed.offline?.states[anna.id], learnedAt: "2026-10-16T07:45:00Z" },
			{ ...ben, state: { status: "clocked_out" }, learnedAt: "2026-10-16T07:45:00Z" },
		]);
	});

	it("replaces the employees at each contact, so an unassigned employee is gone", async () => {
		const { cache: offline } = cache();
		await offline.rememberKiosk(kiosk);
		await offline.rememberEmployees(kiosk.id, listed);

		await offline.rememberEmployees(kiosk.id, {
			employees: [ben],
			offline: {
				learnedAt: "2026-10-16T08:00:00Z",
				states: { [ben.id]: { status: "clocked_out" } },
			},
		});

		expect(await offline.readEmployees(kiosk.id)).toEqual([
			{ ...ben, state: { status: "clocked_out" }, learnedAt: "2026-10-16T08:00:00Z" },
		]);
	});

	it("caches nothing for a kiosk without offline mode", async () => {
		const { cache: offline, storage } = cache();

		await offline.rememberKiosk({ ...kiosk, offlineMode: false });
		await offline.rememberEmployees(kiosk.id, { employees: listed.employees });

		expect(storage.keys()).toEqual([]);
		expect(await offline.readKiosk()).toBeNull();
		expect(await offline.readEmployees(kiosk.id)).toBeNull();
	});

	it("deletes everything once offline mode is switched off", async () => {
		const { cache: offline, storage } = cache();
		await offline.rememberKiosk(kiosk);
		await offline.rememberEmployees(kiosk.id, listed);

		await offline.rememberKiosk({ ...kiosk, offlineMode: false });

		expect(storage.keys()).toEqual([]);
	});

	it("drops the employees when a list arrives without states", async () => {
		const { cache: offline } = cache();
		await offline.rememberKiosk(kiosk);
		await offline.rememberEmployees(kiosk.id, listed);

		await offline.rememberEmployees(kiosk.id, { employees: listed.employees });

		expect(await offline.readEmployees(kiosk.id)).toBeNull();
	});

	it("never mixes up two kiosks: another kiosk's employees are not shown or kept", async () => {
		const { cache: offline } = cache();
		await offline.rememberKiosk(kiosk);
		await offline.rememberEmployees(kiosk.id, listed);
		const other = { ...kiosk, id: "33333333-3333-4333-8333-333333333333" };

		expect(await offline.readEmployees(other.id)).toBeNull();
		await offline.rememberKiosk(other);
		expect(await offline.readEmployees(kiosk.id)).toBeNull();
		expect(await offline.readKiosk()).toEqual(other);
	});

	it("forgets everything, as when the kiosk is revoked or unpaired", async () => {
		const { cache: offline, storage } = cache();
		await offline.rememberKiosk(kiosk);
		await offline.rememberEmployees(kiosk.id, listed);

		await offline.forget();

		expect(storage.keys()).toEqual([]);
	});

	describe("offline kiosk clocking (#1292)", () => {
		const offlineContact = {
			contact: { serverTime: "2026-10-16T07:45:00Z", proof: "cHJvb2Y" },
			sealingKey: {
				kid: "k1",
				alg: "ECDH-P256+HKDF-SHA256+A256GCM" as const,
				jwk: { kty: "EC" as const, crv: "P-256" as const, x: "eA", y: "eQ" },
			},
		};
		const vehicleUse = {
			mode: "asked" as const,
			vehicles: [],
			suggestedVehicleIds: [],
			lastEndKmByVehicleId: {},
			vehiclesOnOtherLiveWork: [],
			live: null,
		};

		it("keeps each employee's vehicle-use context beside their state", async () => {
			const { cache: offline } = cache();
			await offline.rememberKiosk(kiosk);

			await offline.rememberEmployees(kiosk.id, {
				...listed,
				offline: listed.offline && { ...listed.offline, vehicleUse: { [anna.id]: vehicleUse } },
			});

			const employees = await offline.readEmployees(kiosk.id);
			expect(employees?.[0]?.vehicleUse).toEqual(vehicleUse);
			expect(employees?.[1]).not.toHaveProperty("vehicleUse");
		});

		it("keeps the latest contact and sealing key for its kiosk only, and forgets them with the cache", async () => {
			const { cache: offline, storage } = cache();
			await offline.rememberKiosk(kiosk);

			await offline.rememberContact(kiosk.id, offlineContact);

			expect(await offline.readContact(kiosk.id)).toEqual(offlineContact);
			expect(await offline.readContact("33333333-3333-4333-8333-333333333333")).toBeNull();
			await offline.rememberContact(kiosk.id, undefined);
			expect(await offline.readContact(kiosk.id)).toBeNull();

			await offline.rememberContact(kiosk.id, offlineContact);
			await offline.rememberKiosk({ ...kiosk, offlineMode: false });
			expect(storage.keys()).toEqual([]);
		});

		it("holds the per-kiosk PIN attempt limit across reloads", async () => {
			const { cache: offline, storage } = cache();
			await offline.rememberKiosk(kiosk);
			const start = parseInstant("2026-10-16T08:00:00Z");
			const at = (milliseconds: number) => start.add({ milliseconds });

			for (let attempt = 0; attempt < 30; attempt += 1) {
				expect(await offline.takePinAttempt(at(attempt * 100))).toEqual({ allowed: true });
			}
			const reloaded = createKioskOfflineCache(() => storage);
			expect(await reloaded.takePinAttempt(at(5_000))).toEqual({
				allowed: false,
				retryAfterSeconds: 55,
			});
			// The first attempt leaves the minute's window.
			expect(await reloaded.takePinAttempt(at(60_001))).toEqual({ allowed: true });
		});

		it("keeps the PIN attempt limit when the device clock is set back or forward and back", async () => {
			const { cache: offline } = cache();
			await offline.rememberKiosk(kiosk);
			const start = parseInstant("2026-10-16T08:00:00Z");
			for (let attempt = 0; attempt < 30; attempt += 1) {
				await offline.takePinAttempt(start.add({ milliseconds: attempt * 100 }));
			}

			// Set back an hour: the attempts dated in the future still count.
			const earlier = start.subtract({ hours: 1 });
			expect(await offline.takePinAttempt(earlier)).toMatchObject({ allowed: false });
			// They count as made at the moment the clock was set back, for one window.
			expect(await offline.takePinAttempt(earlier.add({ seconds: 30 }))).toMatchObject({
				allowed: false,
			});
			expect(await offline.takePinAttempt(earlier.add({ seconds: 61 }))).toEqual({ allowed: true });
		});
	});

	it("reads as empty, and never throws, when the storage fails", async () => {
		const failing = createKioskOfflineCache(() => {
			throw new Error("IndexedDB blocked");
		});

		await expect(failing.rememberKiosk(kiosk)).resolves.toBeUndefined();
		await expect(failing.readKiosk()).resolves.toBeNull();
		await expect(failing.readEmployees(kiosk.id)).resolves.toBeNull();
		await expect(failing.forget()).resolves.toBeUndefined();
	});
});
