const STORAGE_KEY_PREFIX = "z8_tour_";
export const CURRENT_TOUR_VERSION = 1;

interface TourPersistenceData {
	completed: boolean;
	completedAt: string;
	version: number;
}

function getStorageKey(userId: string): string {
	return `${STORAGE_KEY_PREFIX}v${CURRENT_TOUR_VERSION}_${userId}`;
}

export function isTourCompleted(userId: string): boolean {
	try {
		const raw = localStorage.getItem(getStorageKey(userId));
		if (!raw) return false;
		const data: TourPersistenceData = JSON.parse(raw);
		return data.completed;
	} catch {
		return false;
	}
}

export function markTourCompleted(userId: string): void {
	const data: TourPersistenceData = {
		completed: true,
		completedAt: new Date().toISOString(),
		version: CURRENT_TOUR_VERSION,
	};
	try {
		localStorage.setItem(getStorageKey(userId), JSON.stringify(data));
	} catch {
		// localStorage may be unavailable
	}
}
