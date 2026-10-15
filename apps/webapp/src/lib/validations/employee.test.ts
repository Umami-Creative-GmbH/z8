import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createEmployeeSchema,
	personalInformationSchema,
	pronounsSchema,
	updateEmployeeInvitationDraftSchema,
	updateEmployeeSchema,
} from "./employee";

afterEach(() => {
	vi.useRealTimers();
});

describe("pronounsSchema", () => {
	it("accepts and normalizes a trimmed 50-character value", () => {
		const value = `${"x".repeat(50)}   `;

		expect(pronounsSchema.parse(value)).toBe("x".repeat(50));
	});

	it("rejects values longer than 50 characters after trimming", () => {
		expect(() => pronounsSchema.parse("x".repeat(51))).toThrow(
			"Pronouns must be 50 characters or less",
		);
	});
});

describe("personnel number on employee and invitation draft saves", () => {
	it.each([
		["employee", updateEmployeeSchema],
		["invitation draft", updateEmployeeInvitationDraftSchema],
	] as const)("stores the trimmed number for an %s, keeping its case", (_label, schema) => {
		const result = schema.safeParse({ employeeNumber: " E-42 " });

		expect(result.success).toBe(true);
		expect(result.data?.employeeNumber).toBe("E-42");
	});

	it.each([
		["employee", updateEmployeeSchema],
		["invitation draft", updateEmployeeInvitationDraftSchema],
	] as const)("stores no number for an empty or blank %s field", (_label, schema) => {
		expect(schema.safeParse({ employeeNumber: "" }).data?.employeeNumber).toBeNull();
		expect(schema.safeParse({ employeeNumber: "   " }).data?.employeeNumber).toBeNull();
		expect(schema.safeParse({ employeeNumber: null }).data?.employeeNumber).toBeNull();
	});

	it("leaves the number untouched when a save does not carry it", () => {
		const result = updateEmployeeSchema.safeParse({ position: "Engineer" });

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ position: "Engineer" });
	});

	it("allows 50 characters after trimming and refuses more", () => {
		expect(updateEmployeeSchema.safeParse({ employeeNumber: ` ${"x".repeat(50)} ` }).success).toBe(
			true,
		);
		expect(updateEmployeeSchema.safeParse({ employeeNumber: "x".repeat(51) }).success).toBe(false);
	});
});

describe("employee birthday validation", () => {
	it("evaluates today when each schema invocation runs", () => {
		vi.useFakeTimers();
		vi.setSystemTime("2026-07-29T23:59:59.000Z");

		const birthday = new Date("2026-07-30T00:00:00.000Z");
		const createInput = {
			userId: "9d71d7c5-7ea7-4953-85f8-2943de780d24",
			organizationId: "org-1",
			role: "employee" as const,
			birthday,
		};

		expect(personalInformationSchema.safeParse({ birthday }).success).toBe(
			false,
		);
		expect(createEmployeeSchema.safeParse(createInput).success).toBe(false);
		expect(updateEmployeeSchema.safeParse({ birthday }).success).toBe(false);

		vi.setSystemTime("2026-07-30T00:00:01.000Z");

		expect(personalInformationSchema.safeParse({ birthday }).success).toBe(
			true,
		);
		expect(createEmployeeSchema.safeParse(createInput).success).toBe(true);
		expect(updateEmployeeSchema.safeParse({ birthday }).success).toBe(true);
	});
});
