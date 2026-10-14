/** A file size in B, KB, MB or GB, in `locale` (personnel file documents, personal data exports). */
export function formatFileSize(bytes: number, locale: string): string {
	const units = ["B", "KB", "MB", "GB"] as const;
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}
