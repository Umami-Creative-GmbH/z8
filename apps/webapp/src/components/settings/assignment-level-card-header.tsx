import type { Icon } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AssignmentLevelCardHeaderProps {
	icon: Icon;
	title: string;
	description: string;
	/** Shown as a badge after the title when it is above zero. */
	count?: number;
}

/** The header of one assignment-level card (organization, team or employee) in a settings policy assignment manager. */
export function AssignmentLevelCardHeader({
	icon: LevelIcon,
	title,
	description,
	count,
}: AssignmentLevelCardHeaderProps) {
	return (
		<CardHeader>
			<div className="flex items-center gap-2">
				<LevelIcon className="size-5 text-muted-foreground" />
				<div>
					<CardTitle className="text-base">
						{title}
						{count !== undefined && count > 0 ? (
							<Badge variant="secondary" className="ml-2">
								{count}
							</Badge>
						) : null}
					</CardTitle>
					<CardDescription>{description}</CardDescription>
				</div>
			</div>
		</CardHeader>
	);
}
