const DEFAULT_COLORS: Record<string, string> = {
	vacation: "#3b82f6", // blue
	sick: "#f59e0b", // amber
	personal: "#8b5cf6", // violet
	unpaid: "#6b7280", // gray
	parental: "#ec4899", // pink
	bereavement: "#1f2937", // dark gray
	home_office: "#10b981", // emerald
	time_off_in_lieu: "#14b8a6", // teal
	custom: "#06b6d4", // cyan
};

/** A category's own colour, else the default colour of its type. */
export function absenceCategoryColor(type: string | null, color?: string | null): string {
	return color || (type ? DEFAULT_COLORS[type] : undefined) || DEFAULT_COLORS.custom;
}
