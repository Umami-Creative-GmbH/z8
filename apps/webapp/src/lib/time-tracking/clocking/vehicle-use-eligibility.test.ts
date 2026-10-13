import { describe, expect, it } from "vitest";
import { acceptsClockVehicleUse } from "./vehicle-use-eligibility";

const subject = { employeeId: "f1122000-0000-4000-8000-000000000001" };

describe("which clock commands record vehicle use", () => {
	it("records the employee's own clocking by the user or at a kiosk", () => {
		expect(acceptsClockVehicleUse({ principal: { kind: "user", userId: "u" }, subject })).toBe(
			true,
		);
		expect(
			acceptsClockVehicleUse({
				principal: {
					kind: "kiosk",
					kioskId: "k",
					userId: "u",
					pin: { organizationId: "o", kioskId: "k", employeeId: subject.employeeId },
				},
				subject,
			}),
		).toBe(true);
	});

	it("never records it on behalf, at a departure or at an automatic clock-out", () => {
		expect(
			acceptsClockVehicleUse({
				principal: { kind: "user", userId: "manager" },
				subject: { ...subject, onBehalf: true },
			}),
		).toBe(false);
		expect(
			acceptsClockVehicleUse({
				principal: { kind: "departure", departureId: "d", userId: "hr" },
				subject,
			}),
		).toBe(false);
		expect(
			acceptsClockVehicleUse({
				principal: {
					kind: "automatic_clock_out",
					userId: "u",
					operationId: "o",
					workPeriodId: "w",
				},
				subject,
			}),
		).toBe(false);
	});
});
