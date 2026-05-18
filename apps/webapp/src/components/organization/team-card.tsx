"use client";

import { IconDots, IconEdit, IconShieldCheck, IconTrash, IconUsers } from "@tabler/icons-react";
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

export function TeamCard({
	team,
	employees = [],
	primaryManager = null,
	canManageMembers,
	canManageSettings,
	onEdit,
	onDelete,
	onManageMembers,
}: TeamCardProps) {
	const memberCount = team._count?.employees || employees.length || 0;

	// Show first 3 employees
	const displayedEmployees = employees.slice(0, 3);
	const remainingCount = Math.max(0, memberCount - 3);

	return (
		<Card className="hover:shadow-md transition-shadow">
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="flex-1 min-w-0">
						<CardTitle className="text-lg truncate">{team.name}</CardTitle>
						{team.description && (
							<CardDescription className="mt-1 line-clamp-2">{team.description}</CardDescription>
						)}
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="sm">
								<IconDots className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{canManageMembers && (
								<DropdownMenuItem onClick={onManageMembers}>
									<IconUsers className="mr-2 size-4" />
									Manage Members
								</DropdownMenuItem>
							)}
							{canManageSettings && (
								<>
									{canManageMembers && <DropdownMenuSeparator />}
									<DropdownMenuItem onClick={onEdit}>
										<IconEdit className="mr-2 size-4" />
										Edit Team
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem className="text-destructive" onClick={onDelete}>
										<IconTrash className="mr-2 size-4" />
										Delete Team
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
						<IconShieldCheck className="mt-0.5 size-4 text-muted-foreground" />
						<div className="min-w-0">
							<div className="font-medium">Fallback manager</div>
							<div className="truncate text-muted-foreground">
								{primaryManager
									? `${primaryManager.name}${primaryManager.position ? ` - ${primaryManager.position}` : ""}`
									: "Not assigned"}
							</div>
						</div>
					</div>

					{/* Member Count */}
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconUsers className="size-4" />
						<span>
							{memberCount} {memberCount === 1 ? "member" : "members"}
						</span>
					</div>

					{/* Avatar Stack */}
					{memberCount > 0 && (
						<div className="flex items-center gap-2">
							<div className="flex -space-x-2">
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
