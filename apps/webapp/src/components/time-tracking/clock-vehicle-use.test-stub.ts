/**
 * The clock's vehicle use module with vehicle use off (#1122), for clock tests
 * that are about something else and render without a query client.
 */
export function vehicleUseOffModule() {
	const state = {
		context: null,
		mode: "off" as const,
		asks: false,
		live: null,
		liveWorkPeriodId: null,
		clockIn: { ok: true as const },
		clockOut: { ok: true as const },
		takenBreak: { ok: true as const },
		reset: () => {},
		refresh: async () => {},
	};
	return {
		useClockVehicleUse: () => state,
		warnVehicleUseLeftOut: () => {},
		ClockInVehicleUse: () => null,
		ClockOutVehicleUse: () => null,
		BreakVehicleReading: () => null,
	};
}
