import type { WorkBalanceStatus } from "./types";

export function formatSignedWorkBalance(balanceMinutes: number): string {
	if (balanceMinutes === 0) return "0:00h";
	const sign = balanceMinutes > 0 ? "+" : "-";
	const absoluteMinutes = Math.abs(balanceMinutes);
	const hours = Math.floor(absoluteMinutes / 60);
	const minutes = absoluteMinutes % 60;
	return `${sign}${hours}:${String(minutes).padStart(2, "0")}h`;
}

export function getWorkBalanceStatus(balanceMinutes: number): WorkBalanceStatus {
	if (balanceMinutes > 0) return "positive";
	if (balanceMinutes < 0) return "negative";
	return "neutral";
}
