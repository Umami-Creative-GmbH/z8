import { absenceCategoryColor } from "./category-color";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CategoryBadgeProps {
	name: string;
	type: string;
	color?: string | null;
	className?: string;
}

export function CategoryBadge({ name, type, color, className }: CategoryBadgeProps) {
	const badgeColor = absenceCategoryColor(type, color);

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
