"use client";

import { IconArrowsSort } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@/navigation";
import type { EmployeeWithRelations } from "./actions";

export const columns: ColumnDef<EmployeeWithRelations>[] = [
	{
		accessorKey: "user.name",
		header: ({ column }) => (
			<Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
				Employee
				<IconArrowsSort className="ml-2 size-4" />
			</Button>
		),
		cell: ({ row }) => (
			<div className="flex items-center gap-3">
				<UserAvatar
					image={row.original.user.image}
					seed={row.original.user.id}
					name={row.original.user.name}
					size="sm"
				/>
				<div>
					<div className="font-medium">{row.original.user.name}</div>
					<div className="text-sm text-muted-foreground">{row.original.user.email}</div>
				</div>
			</div>
		),
	},
	{
		accessorKey: "position",
		header: "Position",
		cell: ({ row }) => row.original.position || "—",
	},
	{
		accessorKey: "team.name",
		header: "Team",
		cell: ({ row }) => row.original.team?.name || "—",
	},
	{
		accessorKey: "role",
		header: "Role",
		cell: ({ row }) => (
			<Badge
				variant={
					row.original.role === "admin"
						? "default"
						: row.original.role === "manager"
							? "secondary"
							: "outline"
				}
			>
				{row.original.role}
			</Badge>
		),
	},
	{
		accessorKey: "isActive",
		header: "Status",
		cell: ({ row }) => (
			<Badge variant={row.original.isActive ? "default" : "secondary"}>
				{row.original.isActive ? "Active" : "Inactive"}
			</Badge>
		),
	},
	{
		id: "actions",
		header: () => <span className="sr-only">Actions</span>,
		cell: ({ row }) => (
			<div className="text-right">
				<Button variant="ghost" size="sm" asChild>
					<Link href={`/settings/employees/${row.original.id}`}>View Details</Link>
				</Button>
			</div>
		),
	},
];
