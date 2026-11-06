"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { normalizePronouns } from "@/lib/employee-identity";
import { cn } from "@/lib/utils";
import type { OrgExplorerPerson } from "./org-explorer-types";

/** How many team chips a card shows before it sums up the rest as "+N". */
const VISIBLE_TEAM_CHIPS = 2;

export function personDisplayName(
	person: Pick<OrgExplorerPerson, "name" | "pronouns">,
) {
	const pronouns = normalizePronouns(person.pronouns);
	return pronouns ? `${person.name} (${pronouns})` : person.name;
}

export function PersonAvatar({
	person,
	size = "sm",
}: {
	person: Pick<OrgExplorerPerson, "employeeId" | "userId" | "name" | "image">;
	size?: "sm" | "md";
}) {
	return (
		<UserAvatar
			className="border border-border bg-primary/10"
			clockStatus="unknown"
			image={person.image}
			name={person.name}
			seed={person.userId || person.employeeId}
			size={size}
		/>
	);
}

/** A person's avatar, name and position in a row, as a button that opens their details. */
export function PersonButton({
	person,
	onSelect,
	children,
	className,
}: {
	person: OrgExplorerPerson;
	onSelect: (employeeId: string) => void;
	children?: React.ReactNode;
	className?: string;
}) {
	return (
		<button
			className={cn(
				"flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
			onClick={() => onSelect(person.employeeId)}
			type="button"
		>
			<PersonAvatar person={person} />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium">
					{personDisplayName(person)}
				</span>
				{person.position ? (
					<span className="truncate text-xs text-muted-foreground">
						{person.position}
					</span>
				) : null}
			</span>
			{children}
		</button>
	);
}

/** Team chips, the primary team first, with the rest summed up as "+N". */
export function TeamChips({
	person,
	teamNamesById,
}: {
	person: OrgExplorerPerson;
	teamNamesById: ReadonlyMap<string, string>;
}) {
	const { t } = useTranslate();
	const names = person.teamIds.flatMap((teamId) => {
		const name = teamNamesById.get(teamId);
		return name ? [{ teamId, name }] : [];
	});
	if (names.length === 0) return null;
	const hidden = names.length - VISIBLE_TEAM_CHIPS;

	return (
		<div className="flex min-w-0 flex-wrap gap-1">
			{names.slice(0, VISIBLE_TEAM_CHIPS).map(({ teamId, name }) => (
				<Badge
					className={cn(
						"max-w-[140px] truncate",
						teamId === person.primaryTeamId
							? "border-primary/20 bg-primary/10 text-primary"
							: "text-muted-foreground",
					)}
					data-testid="team-chip"
					key={teamId}
					title={name}
					variant="outline"
				>
					{name}
				</Badge>
			))}
			{hidden > 0 ? (
				<Badge
					className="text-muted-foreground"
					data-testid="team-chip"
					title={names
						.slice(VISIBLE_TEAM_CHIPS)
						.map(({ name }) => name)
						.join(", ")}
					variant="outline"
				>
					{t("organization.explorer.moreTeams", "+{count}", { count: hidden })}
				</Badge>
			) : null}
		</div>
	);
}
