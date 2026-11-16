import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
		expect(personalInformationSchema.safeParse({ birthday }).success).toBe(
			false,
		);
		expect(updateEmployeeSchema.safeParse({ birthday }).success).toBe(false);

		vi.setSystemTime("2026-07-30T00:00:01.000Z");

		expect(personalInformationSchema.safeParse({ birthday }).success).toBe(
			true,
		);
		expect(updateEmployeeSchema.safeParse({ birthday }).success).toBe(true);
	});

	it("refuses a birthday before 1900 on employees and invitation drafts (#1579)", () => {
		const beforeEarliest = new Date("1899-12-31T00:00:00.000Z");
		const earliest = new Date("1900-01-01T00:00:00.000Z");

		for (const schema of [updateEmployeeSchema, updateEmployeeInvitationDraftSchema]) {
			expect(schema.safeParse({ birthday: beforeEarliest }).success).toBe(false);
			expect(schema.safeParse({ birthday: earliest }).success).toBe(true);
		}
	});

	it("lets an admin clear the birthday (#1579)", () => {
		for (const schema of [updateEmployeeSchema, updateEmployeeInvitationDraftSchema]) {
			const result = schema.safeParse({ birthday: null });
			expect(result.success).toBe(true);
			expect(result.data).toEqual({ birthday: null });
		}
	});
});
