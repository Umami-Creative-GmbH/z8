import * as imported from "temporal-polyfill";
import { Temporal as fallback } from "temporal-polyfill/implementation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestTemporalNow } from "./temporal-test-clock";

const initialGlobal = vi.hoisted(() => {
	const real = Object.getOwnPropertyDescriptor(globalThis, "Temporal");
	// A business module may first import Temporal after its test fakes Date.
	vi.setSystemTime(new Date("2026-07-29T23:59:59Z"));
	return {
		real,
		fake: Object.getOwnPropertyDescriptor(globalThis, "Temporal"),
	};
});
const actual = await vi.importActual<typeof imported>("temporal-polyfill");
const { Temporal } = imported;

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("imported Temporal test clock", () => {
	it("follows setSystemTime before the first business import while retaining real Temporal", () => {
		expect(vi.isFakeTimers()).toBe(false);
		expect(Temporal.Now.instant().toString()).toBe("2026-07-29T23:59:59Z");
		expect(Object.getOwnPropertyDescriptor(globalThis, "Temporal")).toEqual(
			initialGlobal.fake,
		);
		if (initialGlobal.real) {
			expect(actual.Temporal).toBe(initialGlobal.real.value);
		}
	});

	it("reads the advancing fake instant afresh from 5 to 6 seconds", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-29T12:00:05Z"));
		const start = Temporal.Instant.from("2026-07-29T12:00:00Z");
		expect(start.until(Temporal.Now.instant()).total("seconds")).toBe(5);
		vi.advanceTimersByTime(1000);
		expect(start.until(Temporal.Now.instant()).total("seconds")).toBe(6);
	});

	it("crosses UTC midnight with Date-only fake timers without changing global Temporal", () => {
		const globalBefore = Object.getOwnPropertyDescriptor(
			globalThis,
			"Temporal",
		);
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-07-29T23:59:59Z"));
		expect(Temporal.Now.plainDateISO("UTC").toString()).toBe("2026-07-29");
		vi.advanceTimersByTime(1000);
		expect(Temporal.Now.plainDateISO("UTC").toString()).toBe("2026-07-30");
		expect(Object.getOwnPropertyDescriptor(globalThis, "Temporal")).toEqual(
			globalBefore,
		);
	});

	it("restores real reads between fake clock sessions", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
		expect(Temporal.Now.instant().toString()).toBe("2000-01-01T00:00:00Z");
		vi.useRealTimers();
		const before = actual.Temporal.Now.instant();
		const real = Temporal.Now.instant();
		const after = actual.Temporal.Now.instant();
		expect(Temporal.Instant.compare(real, before)).toBeGreaterThanOrEqual(0);
		expect(Temporal.Instant.compare(real, after)).toBeLessThanOrEqual(0);
		vi.setSystemTime(new Date("2001-01-01T00:00:00Z"));
		expect(vi.isFakeTimers()).toBe(false);
		expect(Temporal.Now.instant().toString()).toBe("2001-01-01T00:00:00Z");
	});

	it("preserves other exports, constructor identities and descriptors", () => {
		for (const key of Reflect.ownKeys(actual)) {
			if (key !== "Temporal") {
				expect(Reflect.get(imported, key)).toBe(Reflect.get(actual, key));
			}
		}
		for (const key of Reflect.ownKeys(actual.Temporal)) {
			if (key !== "Now") {
				expect(Object.getOwnPropertyDescriptor(Temporal, key)).toEqual(
					Object.getOwnPropertyDescriptor(actual.Temporal, key),
				);
			}
		}
		expect(Temporal.Now).not.toBe(actual.Temporal.Now);
		vi.useFakeTimers();
		expect(Temporal.Now.instant()).toBeInstanceOf(actual.Temporal.Instant);
		expect(Temporal.Now.zonedDateTimeISO("UTC")).toBeInstanceOf(
			actual.Temporal.ZonedDateTime,
		);
	});

	it("isolates imported Now spies and restores them across module resets", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-07-29T12:00:00Z"));
		const actualMethod = actual.Temporal.Now.instant;
		vi.spyOn(Temporal.Now, "instant").mockReturnValue(
			Temporal.Instant.from("2000-01-01T00:00:00Z"),
		);
		expect(Temporal.Now.instant().toString()).toBe("2000-01-01T00:00:00Z");
		expect(actual.Temporal.Now.instant).toBe(actualMethod);
		vi.restoreAllMocks();
		vi.resetModules();
		const reimported = await import("temporal-polyfill");
		expect(reimported.Temporal.Now.instant().toString()).toBe(
			"2026-07-29T12:00:00Z",
		);
		expect(actual.Temporal.Now.instant).toBe(actualMethod);
		vi.useRealTimers();
		const before = actual.Temporal.Now.instant();
		const restored = reimported.Temporal.Now.instant();
		const after = actual.Temporal.Now.instant();
		expect(Temporal.Instant.compare(restored, before)).toBeGreaterThanOrEqual(
			0,
		);
		expect(Temporal.Instant.compare(restored, after)).toBeLessThanOrEqual(0);
		vi.setSystemTime(new Date("2001-01-01T00:00:00Z"));
		expect(reimported.Temporal.Now.instant().toString()).toBe(
			"2001-01-01T00:00:00Z",
		);
	});
});

describe.each([
	["runtime", actual.Temporal],
	["fallback", fallback],
] as const)("%s independent Now views", (_name, constructors) => {
	function originalFixture() {
		const precise = constructors.Instant.from("2026-03-29T00:59:59.123456789Z");
		const zoned = precise.toZonedDateTimeISO("Europe/Berlin");
		const values = {
			zonedDateTimeISO: zoned,
			plainDateTimeISO: zoned.toPlainDateTime(),
			plainDateISO: zoned.toPlainDate(),
			plainTimeISO: zoned.toPlainTime(),
		};
		const Now = {
			instant: vi.fn(() => precise),
			timeZoneId: vi.fn(() => "Europe/Berlin"),
			zonedDateTimeISO: vi.fn(() => values.zonedDateTimeISO),
			plainDateTimeISO: vi.fn(() => values.plainDateTimeISO),
			plainDateISO: vi.fn(() => values.plainDateISO),
			plainTimeISO: vi.fn(() => values.plainTimeISO),
		};
		const source: typeof Temporal = Object.create(
			Object.getPrototypeOf(constructors),
			{
				...Object.getOwnPropertyDescriptors(constructors),
				Now: { value: Now },
			},
		);
		return { source, Now, precise, values };
	}

	it("delegates each real method with full precision and its original receiver", () => {
		const { source, Now, precise, values } = originalFixture();
		const view = createTestTemporalNow(source, () => false);
		expect(view.instant()).toBe(precise);
		expect(view.instant().epochNanoseconds).toBe(1774745999123456789n);
		for (const method of [
			"zonedDateTimeISO",
			"plainDateTimeISO",
			"plainDateISO",
			"plainTimeISO",
		] as const) {
			expect(view[method]("America/New_York")).toBe(values[method]);
			expect(Now[method]).toHaveBeenCalledWith("America/New_York");
			expect(Now[method].mock.contexts[0]).toBe(Now);
		}
		expect(view.timeZoneId()).toBe("Europe/Berlin");
		expect(Now.instant.mock.contexts[0]).toBe(Now);
	});

	it("derives all fake methods using the requested or default zone across DST", () => {
		const { source, Now } = originalFixture();
		const view = createTestTemporalNow(source, () => true);
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-03-29T00:59:59Z"));
		expect(view.zonedDateTimeISO().toString()).toBe(
			"2026-03-29T01:59:59+01:00[Europe/Berlin]",
		);
		vi.advanceTimersByTime(1000);
		expect(view.zonedDateTimeISO().toString()).toBe(
			"2026-03-29T03:00:00+02:00[Europe/Berlin]",
		);
		expect(view.plainDateTimeISO().toString()).toBe("2026-03-29T03:00:00");
		expect(view.plainDateISO().toString()).toBe("2026-03-29");
		expect(view.plainTimeISO().toString()).toBe("03:00:00");
		expect(view.zonedDateTimeISO("America/New_York").toString()).toBe(
			"2026-03-28T21:00:00-04:00[America/New_York]",
		);
		expect(view.plainDateTimeISO("America/New_York").toString()).toBe(
			"2026-03-28T21:00:00",
		);
		expect(view.plainDateISO("America/New_York").toString()).toBe("2026-03-28");
		expect(view.plainTimeISO("America/New_York").toString()).toBe("21:00:00");
		expect(
			view
				.plainTimeISO(
					constructors.ZonedDateTime.from(
						"2000-01-01T00:00:00-05:00[America/New_York]",
					),
				)
				.toString(),
		).toBe("21:00:00");
		expect(view.timeZoneId()).toBe("Europe/Berlin");
		expect(Now.instant).not.toHaveBeenCalled();
	});

	it("keeps views and spies independent without mutating original descriptors", () => {
		const descriptors = Object.getOwnPropertyDescriptors(constructors.Now);
		const first = createTestTemporalNow(constructors, () => true);
		const second = createTestTemporalNow(constructors, () => true);
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-07-29T12:00:00Z"));
		vi.spyOn(first, "instant").mockReturnValue(
			constructors.Instant.from("2000-01-01T00:00:00Z"),
		);
		expect(second.instant().toString()).toBe("2026-07-29T12:00:00Z");
		expect(second.instant()).toBeInstanceOf(constructors.Instant);
		expect(Object.getOwnPropertyDescriptors(constructors.Now)).toEqual(
			descriptors,
		);
		vi.restoreAllMocks();
		expect(first.instant().toString()).toBe("2026-07-29T12:00:00Z");
	});
});
