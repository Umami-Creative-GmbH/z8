import { absenceCategoryColor } from "@/components/absences/category-badge";
import type { PayrollPeriodAbsence } from "@/lib/payroll-period/types";

/** One absence category of the PDF legend: its short code and calendar colour. */
export interface PayrollPdfAbsenceCategory {
	categoryId: string;
	categoryName: string;
	code: string;
	color: string;
	/** Black or white, whichever reads on `color`. */
	textColor: string;
}

/**
 * The categories of the period's absences in name order, each with a code of at most
 * two characters that is unique in the PDF: the initials of a multi-word name
 * ("Sick leave" -> "SL"), else its first two letters ("Vacation" -> "VA").
 */
export function payrollPdfAbsenceCategories(
	absences: readonly Pick<
		PayrollPeriodAbsence,
		"categoryId" | "categoryName" | "categoryType" | "categoryColor"
	>[],
): PayrollPdfAbsenceCategory[] {
	const categories = new Map<string, (typeof absences)[number]>();
	for (const absence of absences) {
		if (!categories.has(absence.categoryId)) categories.set(absence.categoryId, absence);
	}
	const taken = new Set<string>();
	return [...categories.values()]
		.toSorted(
			(left, right) =>
				left.categoryName.localeCompare(right.categoryName) ||
				left.categoryId.localeCompare(right.categoryId),
		)
		.map((category) => {
			const code = uniqueCode(category.categoryName, taken);
			taken.add(code);
			const color = absenceCategoryColor(category.categoryType, category.categoryColor);
			return {
				categoryId: category.categoryId,
				categoryName: category.categoryName,
				code,
				color,
				textColor: readableTextColor(color),
			};
		});
}

function uniqueCode(name: string, taken: ReadonlySet<string>): string {
	const words = name
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toUpperCase()
		.split(/[^A-Z0-9]+/)
		.filter(Boolean);
	const letters = words.join("");
	const preferred =
		words.length > 1 ? `${words[0]?.[0]}${words[1]?.[0]}` : (words[0] ?? "").slice(0, 2);
	if (preferred && !taken.has(preferred)) return preferred;
	for (const second of letters.slice(1)) {
		const candidate = `${letters[0]}${second}`;
		if (!taken.has(candidate)) return candidate;
	}
	const first = letters[0] ?? "#";
	for (let number = 1; ; number++) {
		const candidate = number < 10 ? `${first}${number}` : String(number);
		if (!taken.has(candidate)) return candidate;
	}
}

/** Black text on light colours, white on dark ones; white when the colour is not hex. */
function readableTextColor(color: string): string {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
	if (!hex) return "#FFFFFF";
	const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
	const [red, green, blue] = [0, 2, 4].map(
		(offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255,
	);
	const luminance = 0.299 * (red ?? 0) + 0.587 * (green ?? 0) + 0.114 * (blue ?? 0);
	return luminance > 0.6 ? "#0F172A" : "#FFFFFF";
}
