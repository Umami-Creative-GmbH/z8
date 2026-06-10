"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { type EmployeeClockStatus, UserAvatar } from "@/components/user-avatar";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { normalizePronouns } from "@/lib/employee-identity";
import { ContractTypeCell } from "./contract-type-cell";
import { EmployeeHeader } from "./employee-header";
import type { EmployeeDirectoryRow } from "./employee-action-types";
import { StatusCell } from "./status-cell";
import { TranslatedColumnHeader } from "./translated-column-header";
import { ViewDetailsCell } from "./view-details-cell";

export const columns: ColumnDef<EmployeeDirectoryRow>[] = [
	{
		id: "employeeName",
		accessorFn: (row) => buildAuthUserDisplayName(row.user),
		header: ({ column }) => (
			<EmployeeHeader
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				sort={column.getIsSorted()}
			/>
		),
		cell: ({ row }) => {
			const employee = row.original as EmployeeDirectoryRow & { clockStatus?: EmployeeClockStatus };
			const name = buildAuthUserDisplayName(row.original.user);
			const pronouns = normalizePronouns(row.original.pronouns);
			const displayName = pronouns ? `${name} (${pronouns})` : name;

			return (
				<div className="flex min-w-0 items-center gap-3">
					<UserAvatar
						image={row.original.user.image}
						seed={row.original.user.id}
						name={displayName}
						clockStatus={employee.clockStatus ?? "unknown"}
						size="sm"
					/>
					<div className="min-w-0">
						<div className="truncate font-medium">{displayName}</div>
						<div className="truncate text-sm text-muted-foreground">{row.original.user.email}</div>
					</div>
				</div>
			);
		},
	},
	{
		accessorKey: "employeeNumber",
		header: () => (
			<TranslatedColumnHeader
				nameKey="settings.employees.directory.table.employeeNumber"
				fallback="Employee Number"
			/>
		),
		cell: ({ row }) => row.original.employeeNumber || "—",
	},
	{
		accessorKey: "position",
		header: () => (
			<TranslatedColumnHeader nameKey="settings.employees.directory.table.position" fallback="Position" />
		),
		cell: ({ row }) => row.original.position || "—",
	},
	{
		accessorKey: "team.name",
		header: () => (
			<TranslatedColumnHeader nameKey="settings.employees.directory.table.team" fallback="Team" />
		),
		cell: ({ row }) => row.original.team?.name || "—",
	},
	{
		accessorKey: "role",
		header: () => (
			<TranslatedColumnHeader nameKey="settings.employees.directory.table.role" fallback="Role" />
		),
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
		accessorKey: "contractType",
		header: () => (
			<TranslatedColumnHeader
				nameKey="settings.employees.directory.table.contract"
				fallback="Contract"
			/>
		),
		cell: ({ row }) => <ContractTypeCell contractType={row.original.contractType} />,
	},
	{
		accessorKey: "isActive",
		header: () => (
			<TranslatedColumnHeader nameKey="settings.employees.directory.table.status" fallback="Status" />
		),
		cell: ({ row }) => <StatusCell employee={row.original} />,
	},
	{
		id: "actions",
		header: () => (
			<TranslatedColumnHeader
				nameKey="settings.employees.directory.table.actions"
				fallback="Actions"
				className="sr-only"
			/>
		),
		cell: ({ row }) => <ViewDetailsCell employee={row.original} />,
	},
];
