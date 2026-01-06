export function formatDuration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

export function formatDate(dateString: string | Date): string {
	const date = new Date(dateString);
	return date.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

export function formatTime(dateString: string | Date): string {
	const date = new Date(dateString);
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function getWeekRange(date: Date): { start: Date; end: Date } {
	const current = new Date(date);
	const day = current.getDay();
	const diff = current.getDate() - day + (day === 0 ? -6 : 1); // Monday

	const start = new Date(current.setDate(diff));
	start.setHours(0, 0, 0, 0);

	const end = new Date(start);
	end.setDate(start.getDate() + 6);
	end.setHours(23, 59, 59, 999);

	return { start, end };
}

export function getMonthRange(date: Date): { start: Date; end: Date } {
	const start = new Date(date.getFullYear(), date.getMonth(), 1);
	start.setHours(0, 0, 0, 0);

	const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
	end.setHours(23, 59, 59, 999);

	return { start, end };
}

export function getTodayRange(): { start: Date; end: Date } {
	const start = new Date();
	start.setHours(0, 0, 0, 0);

	const end = new Date();
	end.setHours(23, 59, 59, 999);

	return { start, end };
}

export function calculateElapsedMinutes(startTime: Date | string): number {
	const start = new Date(startTime);
	const now = new Date();
	return Math.floor((now.getTime() - start.getTime()) / 60000);
}
