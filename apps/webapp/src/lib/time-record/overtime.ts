type ComputeOvertimeDeltaInput = {
	actualMinutes: number;
	expectedMinutes: number;
};

export function computeOvertimeDelta({
	actualMinutes,
	expectedMinutes,
}: ComputeOvertimeDeltaInput): number {
	return Math.max(0, actualMinutes - expectedMinutes);
}
