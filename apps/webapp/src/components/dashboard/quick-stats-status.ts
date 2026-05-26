type QuickStatsStatus = "on-track" | "good-pace" | "behind";

function getQuickStatsStatus({
	actual,
	expectedToDate,
}: {
	actual: number;
	expectedToDate: number;
}): QuickStatsStatus {
	if (expectedToDate <= 0) return "good-pace";

	const percentage = (actual / expectedToDate) * 100;
	if (percentage >= 90) return "on-track";
	if (percentage < 75) return "behind";
	return "good-pace";
}

export type { QuickStatsStatus };
export { getQuickStatsStatus };
