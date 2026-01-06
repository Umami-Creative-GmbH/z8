import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CategoryBadgeProps {
	name: string;
	type: string;
	color?: string | null;
	className?: string;
}

const DEFAULT_COLORS: Record<string, string> = {
	vacation: "#3b82f6", // blue
	sick: "#f59e0b", // amber
	personal: "#8b5cf6", // violet
	unpaid: "#6b7280", // gray
	parental: "#ec4899", // pink
	bereavement: "#1f2937", // dark gray
	home_office: "#10b981", // emerald
	custom: "#06b6d4", // cyan
};

export function CategoryBadge({ name, type, color, className }: CategoryBadgeProps) {
	const badgeColor = color || DEFAULT_COLORS[type] || DEFAULT_COLORS.custom;

	return (
		<Badge
			variant="outline"
			className={cn("font-normal", className)}
			style={{
				borderColor: badgeColor,
				color: badgeColor,
			}}
		>
			{name}
		</Badge>
	);
}
