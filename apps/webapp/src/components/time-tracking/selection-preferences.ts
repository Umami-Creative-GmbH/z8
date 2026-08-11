const LAST_PROJECT_KEY = "z8-last-project-id";
const LAST_WORK_CATEGORY_KEY = "z8-last-work-category-id";

function readSelection(key: string): string | undefined {
	if (typeof window === "undefined") return undefined;
	return localStorage.getItem(key) ?? undefined;
}

function writeSelection(key: string, value: string | undefined): void {
	if (value === undefined) {
		localStorage.removeItem(key);
		return;
	}

	localStorage.setItem(key, value);
}

export function readLastProjectId(): string | undefined {
	return readSelection(LAST_PROJECT_KEY);
}

export function writeLastProjectId(value: string | undefined): void {
	writeSelection(LAST_PROJECT_KEY, value);
}

export function readLastWorkCategoryId(): string | undefined {
	return readSelection(LAST_WORK_CATEGORY_KEY);
}

export function writeLastWorkCategoryId(value: string | undefined): void {
	writeSelection(LAST_WORK_CATEGORY_KEY, value);
}
