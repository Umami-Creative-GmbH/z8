import { describe, expect, it } from "vitest";
import { clockodoEntryBillability } from "./clockodo-billability";

const customerProject = { projectId: "project_customer", customerId: "customer_1" };
const internalProject = { projectId: "project_internal", customerId: null };

describe("clockodoEntryBillability (#907)", () => {
	it.each([
		[0, false, null],
		[1, true, null],
		[2, true, "already_billed"],
	] as const)("maps Clockodo billable %s on a customer's project", (value, billable, note) => {
		expect(
			clockodoEntryBillability({
				billable: value,
				clockodoProjectId: 7,
				mappedProject: customerProject,
			}),
		).toEqual({
			attribution: { projectId: "project_customer", billable },
			billability: { providerValue: value, billable, note },
		});
	});

	it.each([
		[0, null],
		[1, "no_customer"],
		[2, "no_customer"],
	] as const)(
		"imports Clockodo billable %s on a project without a customer as non-billable",
		(value, note) => {
			expect(
				clockodoEntryBillability({
					billable: value,
					clockodoProjectId: 7,
					mappedProject: internalProject,
				}),
			).toEqual({
				attribution: { projectId: "project_internal", billable: false },
				billability: { providerValue: value, billable: false, note },
			});
		},
	);

	it.each([
		[0, null],
		[1, "unmapped_project"],
		[2, "unmapped_project"],
	] as const)(
		"imports Clockodo billable %s on an unmapped project without a project",
		(value, note) => {
			expect(
				clockodoEntryBillability({ billable: value, clockodoProjectId: 7, mappedProject: null }),
			).toEqual({
				attribution: null,
				billability: { providerValue: value, billable: false, note },
			});
		},
	);

	it.each([
		[0, null],
		[1, "no_project"],
	] as const)(
		"imports Clockodo billable %s without a Clockodo project as non-billable",
		(value, note) => {
			expect(
				clockodoEntryBillability({ billable: value, clockodoProjectId: null, mappedProject: null }),
			).toEqual({
				attribution: null,
				billability: { providerValue: value, billable: false, note },
			});
		},
	);

	it.each([
		[undefined, null],
		[3, 3],
		["1", null],
	])("treats an unknown Clockodo billable value %s as non-billable", (value, providerValue) => {
		expect(
			clockodoEntryBillability({
				billable: value,
				clockodoProjectId: 7,
				mappedProject: customerProject,
			}),
		).toEqual({
			attribution: { projectId: "project_customer", billable: false },
			billability: { providerValue, billable: false, note: null },
		});
	});
});
