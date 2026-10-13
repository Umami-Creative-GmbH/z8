import { describe, expect, test } from "vitest";
import { upsertEmploymentHistorySchema } from "./employment-history";

const validEmploymentHistoryInput = {
	validFrom: new Date("2026-01-01T00:00:00.000Z"),
	contractType: "fixed" as const,
	weeklyContractMinutes: 2400,
	hourlyRate: null,
};

describe("upsertEmploymentHistorySchema", () => {
	test("accepts and coerces ISO date strings", () => {
		const result = upsertEmploymentHistorySchema.parse({
			...validEmploymentHistoryInput,
			validFrom: "2026-01-01T00:00:00.000Z",
			probationStartsOn: "2026-01-01T00:00:00.000Z",
			probationEndsOn: "2026-06-01T00:00:00.000Z",
		});

		expect(result.validFrom).toEqual(new Date("2026-01-01T00:00:00.000Z"));
		expect(result.probationStartsOn).toEqual(new Date("2026-01-01T00:00:00.000Z"));
		expect(result.probationEndsOn).toEqual(new Date("2026-06-01T00:00:00.000Z"));
	});

	test("rejects malformed hourly rates for hourly contracts", () => {
		const result = upsertEmploymentHistorySchema.safeParse({
			...validEmploymentHistoryInput,
			contractType: "hourly",
			hourlyRate: "10abc",
		});

		expect(result.success).toBe(false);
	});

	test("accepts valid hourly rates for hourly contracts", () => {
		const result = upsertEmploymentHistorySchema.safeParse({
			...validEmploymentHistoryInput,
			contractType: "hourly",
			hourlyRate: "10.50",
		});

		expect(result.success).toBe(true);
	});

	test("reads the hourly wage as a number", () => {
		const result = upsertEmploymentHistorySchema.parse({
			...validEmploymentHistoryInput,
			contractType: "hourly",
			hourlyRate: "28.50",
		});

		expect(result.hourlyRate).toBe(28.5);
	});

	test("accepts a numeric hourly wage", () => {
		const result = upsertEmploymentHistorySchema.parse({
			...validEmploymentHistoryInput,
			contractType: "hourly",
			hourlyRate: 31,
		});

		expect(result.hourlyRate).toBe(31);
	});

	test("refuses an empty-string wage", () => {
		const result = upsertEmploymentHistorySchema.safeParse({
			...validEmploymentHistoryInput,
			hourlyRate: "",
		});

		expect(result.success).toBe(false);
	});

	test("refuses a wage with more than two decimal places", () => {
		const result = upsertEmploymentHistorySchema.safeParse({
			...validEmploymentHistoryInput,
			contractType: "hourly",
			hourlyRate: 10.555,
		});

		expect(result.success).toBe(false);
	});

	test("stores no wage on fixed terms, whatever the client sends", () => {
		const result = upsertEmploymentHistorySchema.parse({
			...validEmploymentHistoryInput,
			contractType: "fixed",
			hourlyRate: "25.00",
		});

		expect(result.hourlyRate).toBeNull();
	});

	test("accepts null hourly rates for fixed contracts", () => {
		const result = upsertEmploymentHistorySchema.safeParse({
			...validEmploymentHistoryInput,
			hourlyRate: null,
		});

		expect(result.success).toBe(true);
	});
});
