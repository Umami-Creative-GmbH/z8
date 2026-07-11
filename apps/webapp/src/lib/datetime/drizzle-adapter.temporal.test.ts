import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { instantFromDB, instantsFromDB, instantToDB } from "./drizzle-adapter";

describe("Temporal Drizzle adapter", () => {
	it("converts database dates to exact instants", () => {
		const timestamp = new Date("2024-01-15T10:30:00.123Z");

		expect(instantFromDB(timestamp)).toBeInstanceOf(Temporal.Instant);
		expect(instantFromDB(timestamp)?.toString()).toBe("2024-01-15T10:30:00.123Z");
		expect(instantsFromDB([timestamp, null])).toEqual([instantFromDB(timestamp), null]);
	});

	it("round-trips instants at database millisecond precision", () => {
		const instant = Temporal.Instant.from("2024-01-15T10:30:00.999Z");

		expect(instantToDB(instant)?.toISOString()).toBe("2024-01-15T10:30:00.999Z");
		expect(instantFromDB(instantToDB(instant))?.toString()).toBe("2024-01-15T10:30:00.999Z");
	});

	it("preserves nullable database boundaries", () => {
		expect(instantFromDB(null)).toBeNull();
		expect(instantFromDB(undefined)).toBeNull();
		expect(instantToDB(null)).toBeNull();
		expect(instantToDB(undefined)).toBeNull();
	});
});
