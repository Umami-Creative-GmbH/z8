import { describe, expect, it } from "vitest";
import { decideProjectBillableDefault } from "./project-billable-default";

describe("decideProjectBillableDefault", () => {
	it("switches the default on for a project with a customer", () => {
		expect(
			decideProjectBillableDefault({ requested: true, current: false, customerId: "customer-1" }),
		).toEqual({ ok: true, billableDefault: true });
	});

	it("refuses to switch the default on without a customer", () => {
		expect(
			decideProjectBillableDefault({ requested: true, current: false, customerId: null }),
		).toEqual({ ok: false, reason: "customer_required" });
	});

	it("keeps the stored default when the change does not mention it", () => {
		expect(
			decideProjectBillableDefault({
				requested: undefined,
				current: true,
				customerId: "customer-1",
			}),
		).toEqual({ ok: true, billableDefault: true });
	});

	it("switches the default off when the project loses its customer", () => {
		expect(
			decideProjectBillableDefault({ requested: undefined, current: true, customerId: null }),
		).toEqual({ ok: true, billableDefault: false });
	});

	it("switches the default off on request", () => {
		expect(
			decideProjectBillableDefault({ requested: false, current: true, customerId: "customer-1" }),
		).toEqual({ ok: true, billableDefault: false });
	});
});
