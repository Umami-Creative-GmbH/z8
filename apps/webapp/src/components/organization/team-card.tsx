"use client";

import { IconDots, IconEdit, IconShieldCheck, IconTrash, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import type { team } from "@/db/schema";
import { Link } from "@/navigation";

interface TeamCardProps {
	team: typeof team.$inferSelect & { _count?: { employees: number } };
	employees?: Array<{
		user: { id: string; name: string; image: string | null };
	}>;
	primaryManager?: { name: string; position?: string | null } | null;
	canManageMembers: boolean;
	canManageSettings: boolean;
	onEdit?: () => void;
	onDelete?: () => void;
	onManageMembers?: () => void;
}

const EMPTY_EMPLOYEES: NonNullable<TeamCardProps["employees"]> = [];

export function TeamCard({
	team,
	employees = EMPTY_EMPLOYEES,
	primaryManager = null,
	canManageMembers,
	canManageSettings,
	onEdit,
	onDelete,
	onManageMembers,
}: TeamCardProps) {
	const { t } = useTranslate();
	const memberCount = team._count?.employees || employees.length || 0;

	// Show first 3 employees
	const displayedEmployees = employees.slice(0, 3);
	const remainingCount = Math.max(0, memberCount - 3);

	return (
		<Card className="h-full">
			<CardHeader>
				<div className="flex items-start justify-between gap-2">
					<div className="flex-1 min-w-0">
						<CardTitle className="text-lg">
							<h2 className="truncate" title={team.name}>
								{/* The detail page admits the same people who can manage the team. */}
								{canManageMembers || canManageSettings ? (
									<Link
										href={`/settings/teams/${team.id}`}
										className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										{team.name}
									</Link>
								) : (
									team.name
								)}
							</h2>
						</CardTitle>
						{team.description && (
							<CardDescription className="mt-1 line-clamp-2">{team.description}</CardDescription>
						)}
					</div>
					{canManageMembers || canManageSettings ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									aria-label={t("organization.teams.card.actionsFor", "Actions for {name}", {
										name: team.name,
									})}
								>
									<IconDots className="size-4" aria-hidden="true" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{canManageMembers && (
									<DropdownMenuItem onClick={onManageMembers}>
										<IconUsers className="mr-2 size-4" aria-hidden="true" />
										{t("organization.teams.card.manageMembers", "Manage Members")}
									</DropdownMenuItem>
								)}
								{canManageSettings && (
									<>
										{canManageMembers && <DropdownMenuSeparator />}
										<DropdownMenuItem onClick={onEdit}>
											<IconEdit className="mr-2 size-4" aria-hidden="true" />
											{t("organization.teams.card.editTeam", "Edit Team")}
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem className="text-destructive" onClick={onDelete}>
											<IconTrash className="mr-2 size-4" aria-hidden="true" />
											{t("organization.teams.card.deleteTeam", "Delete Team")}
										</DropdownMenuItem>
									</>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
						<IconShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<div className="min-w-0">
							<div className="font-medium">
								{t("organization.teams.card.fallbackManager", "Fallback manager")}
							</div>
							<div className="truncate text-muted-foreground">
								{primaryManager
									? `${primaryManager.name}${primaryManager.position ? ` - ${primaryManager.position}` : ""}`
									: t("organization.teams.card.notAssigned", "Not assigned")}
							</div>
						</div>
					</div>

					{/* Member Count */}
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconUsers className="size-4" aria-hidden="true" />
						<span className="tabular-nums">
							{t(
								"organization.members.count",
								"{count, plural, one {# member} other {# members}}",
								{
									count: memberCount,
								},
							)}
						</span>
					</div>

					{/* Avatar Stack */}
					{memberCount > 0 && (
						<div className="flex items-center gap-2">
							<div className="flex -gap-x-2">
								{displayedEmployees.map((emp) => (
									<UserAvatar
										key={emp.user.id}
										seed={emp.user.id}
										image={emp.user.image}
										name={emp.user.name}
										size="sm"
										bordered
										clockStatus="unknown"
									/>
								))}
								{remainingCount > 0 && (
									<div className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium">
										+{remainingCount}
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
