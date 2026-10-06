import { describe, expect, it } from "vitest";
import { itemReimbursementAmount } from "../item-amount";

const receipt = {
	amount: "89.90",
	currency: "EUR",
	paidBy: "employee" as const,
};

describe("itemReimbursementAmount", () => {
	it("counts an employee-paid receipt at its original amount in the reimbursement currency", () => {
		expect(itemReimbursementAmount(receipt, "EUR")).toEqual({
			counted: true,
			paidBy: "employee",
			currency: "EUR",
			units: BigInt(8990),
			amount: "89.90",
		});
	});

	it("keeps a company-paid receipt apart from the employee entitlement", () => {
		expect(itemReimbursementAmount({ ...receipt, paidBy: "company" }, "EUR")).toMatchObject({
			counted: true,
			paidBy: "company",
			units: BigInt(8990),
		});
	});

	it("does not count an item without amount, payer or the reimbursement currency", () => {
		expect(itemReimbursementAmount({ ...receipt, amount: null }, "EUR")).toEqual({
			counted: false,
			reason: "amount",
		});
		expect(itemReimbursementAmount({ ...receipt, currency: null }, "EUR")).toEqual({
			counted: false,
			reason: "amount",
		});
		expect(itemReimbursementAmount({ ...receipt, paidBy: null }, "EUR")).toEqual({
			counted: false,
			reason: "payer",
		});
		// No conversion is guessed for a foreign receipt.
		expect(itemReimbursementAmount({ ...receipt, currency: "USD" }, "EUR")).toEqual({
			counted: false,
			reason: "currency",
		});
	});

	it("never counts a zero, negative, oversized or malformed amount", () => {
		for (const amount of ["0.00", "-5.00", "100000000000.00", "1.005", "12,50", "abc"]) {
			expect(itemReimbursementAmount({ ...receipt, amount }, "EUR")).toEqual({
				counted: false,
				reason: "amount",
			});
		}
		expect(itemReimbursementAmount({ ...receipt, amount: "999999999.99" }, "EUR")).toMatchObject({
			counted: true,
		});
	});

	describe("mileage items (#606)", () => {
		const mileage = {
			type: "mileage" as const,
			amount: null,
			currency: null,
			paidBy: "employee" as const,
		};

		it("count at the server-calculated amount, ignoring any entered amount", () => {
			expect(
				itemReimbursementAmount(
					{ ...mileage, amount: "999.00", currency: "EUR", mileage: { amount: "18.45", currency: "EUR" } },
					"EUR",
				),
			).toEqual({
				counted: true,
				paidBy: "employee",
				currency: "EUR",
				units: BigInt(1845),
				amount: "18.45",
			});
		});

		it("are not counted until a policy prices them in the reimbursement currency", () => {
			expect(itemReimbursementAmount({ ...mileage, mileage: null }, "EUR")).toEqual({
				counted: false,
				reason: "amount",
			});
			expect(
				itemReimbursementAmount({ ...mileage, mileage: { amount: null, currency: null } }, "EUR"),
			).toEqual({ counted: false, reason: "amount" });
			expect(
				itemReimbursementAmount({ ...mileage, mileage: { amount: "18.45", currency: "CHF" } }, "EUR"),
			).toEqual({ counted: false, reason: "currency" });
		});
	});
});
