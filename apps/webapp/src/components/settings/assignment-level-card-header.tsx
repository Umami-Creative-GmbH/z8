import type { Icon } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AssignmentLevelCardHeaderProps {
	icon: Icon;
	title: string;
	description: string;
	/** Shown as a badge after the title when it is above zero. */
	count?: number;
	/** Section heading level under the page h1. Defaults to h2. */
	headingLevel?: "h2" | "h3";
}

/** The header of one assignment-level card (organization, team or employee) in a settings policy assignment manager. */
export function AssignmentLevelCardHeader({
	icon: LevelIcon,
	title,
	description,
	count,
	headingLevel = "h2",
}: AssignmentLevelCardHeaderProps) {
	return (
		<CardHeader>
			<div className="flex min-w-0 items-center gap-2">
				<LevelIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<div className="min-w-0">
					<CardTitle as={headingLevel} className="text-base">
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
