import { afterEach, describe, expect, it, vi } from "vitest";
import { birthdaySchema, birthdaySchemaOptional } from "./zod-adapters";

afterEach(() => {
	vi.useRealTimers();
});

describe("birthday schemas", () => {
	it("evaluate the current UTC date for every parse without reloading the module", () => {
		vi.useFakeTimers();
		vi.setSystemTime("2026-07-29T23:59:59.000Z");
		const birthday = new Date("2026-07-30T00:00:00.000Z");

		expect(birthdaySchema.safeParse(birthday).success).toBe(false);
		expect(birthdaySchemaOptional.safeParse(birthday).success).toBe(false);

		vi.setSystemTime("2026-07-30T00:00:01.000Z");

		expect(birthdaySchema.safeParse(birthday).success).toBe(true);
		expect(birthdaySchemaOptional.safeParse(birthday).success).toBe(true);
	});
});
