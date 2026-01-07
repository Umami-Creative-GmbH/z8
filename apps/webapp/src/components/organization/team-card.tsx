"use client";

import { IconDots, IconEdit, IconTrash, IconUsers } from "@tabler/icons-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { team } from "@/db/schema";

interface TeamCardProps {
	team: typeof team.$inferSelect & { _count?: { employees: number } };
	employees?: Array<{
		user: { name: string; image: string | null };
	}>;
	canManage: boolean;
	onEdit?: () => void;
	onDelete?: () => void;
	onManageMembers?: () => void;
}

export function TeamCard({
	team,
	employees = [],
	canManage,
	onEdit,
	onDelete,
	onManageMembers,
}: TeamCardProps) {
	const memberCount = team._count?.employees || employees.length || 0;

	const getInitials = (name: string) => {
		return name
			.split(" ")
			.map((n) => n[0])
			.join("")
			.toUpperCase()
			.slice(0, 2);
	};

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
								<IconDots className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={onManageMembers}>
								<IconUsers className="mr-2 h-4 w-4" />
								Manage Members
							</DropdownMenuItem>
							{canManage && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem onClick={onEdit}>
										<IconEdit className="mr-2 h-4 w-4" />
										Edit Team
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem className="text-destructive" onClick={onDelete}>
										<IconTrash className="mr-2 h-4 w-4" />
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
					{/* Member Count */}
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconUsers className="h-4 w-4" />
						<span>
							{memberCount} {memberCount === 1 ? "member" : "members"}
						</span>
					</div>

					{/* Avatar Stack */}
					{memberCount > 0 && (
						<div className="flex items-center gap-2">
							<div className="flex -space-x-2">
								{displayedEmployees.map((emp, idx) => (
									<Avatar key={idx} className="h-8 w-8 border-2 border-background">
										<AvatarImage src={emp.user.image || undefined} alt={emp.user.name} />
										<AvatarFallback className="text-xs">
											{getInitials(emp.user.name)}
										</AvatarFallback>
									</Avatar>
								))}
								{remainingCount > 0 && (
									<div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium">
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
