"use client";

import { IconArrowsSort } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@/navigation";
import type { EmployeeWithRelations } from "./actions";

// Hoisted static JSX elements (rendering-hoist-jsx)
const SortIcon = <IconArrowsSort className="ml-2 size-4" aria-hidden="true" />;

function EmployeeHeader({ onClick }: { onClick: () => void }) {
	const { t } = useTranslate();

	return (
		<Button variant="ghost" onClick={onClick}>
			{t("settings.employees.directory.table.employee", "Employee")}
			{SortIcon}
		</Button>
	);
}

function PositionHeader() {
	const { t } = useTranslate();

	return <span>{t("settings.employees.directory.table.position", "Position")}</span>;
}

function TeamHeader() {
	const { t } = useTranslate();

	return <span>{t("settings.employees.directory.table.team", "Team")}</span>;
}

function RoleHeader() {
	const { t } = useTranslate();

	return <span>{t("settings.employees.directory.table.role", "Role")}</span>;
}

function ContractHeader() {
	const { t } = useTranslate();

	return <span>{t("settings.employees.directory.table.contract", "Contract")}</span>;
}

function StatusHeader() {
	const { t } = useTranslate();

	return <span>{t("settings.employees.directory.table.status", "Status")}</span>;
}

function ActionsHeader() {
	const { t } = useTranslate();

	return (
		<span className="sr-only">{t("settings.employees.directory.table.actions", "Actions")}</span>
	);
}

function ContractTypeCell({
	contractType,
}: {
	contractType: EmployeeWithRelations["contractType"];
}) {
	const { t } = useTranslate();

	return (
		<Badge
			variant="outline"
			className={
				contractType === "hourly"
					? "border-orange-500 text-orange-600 dark:text-orange-400"
					: "border-purple-500 text-purple-600 dark:text-purple-400"
			}
		>
			{contractType === "hourly"
				? t("settings.employees.directory.contract.hourly", "Hourly")
				: t("settings.employees.directory.contract.fixed", "Fixed")}
		</Badge>
	);
}

function StatusCell({ isActive }: { isActive: boolean }) {
	const { t } = useTranslate();

	return (
		<Badge variant={isActive ? "default" : "secondary"}>
			{isActive
				? t("settings.employees.directory.statuses.active", "Active")
				: t("settings.employees.directory.statuses.inactive", "Inactive")}
		</Badge>
	);
}

function ViewDetailsCell({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();

	return (
		<div className="text-right">
			<Button variant="ghost" size="sm" asChild>
				<Link href={`/settings/employees/${employeeId}`}>
					{t("settings.employees.directory.actions.viewDetails", "View Details")}
				</Link>
			</Button>
		</div>
	);
}

export const columns: ColumnDef<EmployeeWithRelations>[] = [
	{
		accessorKey: "user.name",
		header: ({ column }) => (
			<EmployeeHeader onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} />
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
		header: () => <PositionHeader />,
		cell: ({ row }) => row.original.position || "—",
	},
	{
		accessorKey: "team.name",
		header: () => <TeamHeader />,
		cell: ({ row }) => row.original.team?.name || "—",
	},
	{
		accessorKey: "role",
		header: () => <RoleHeader />,
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
		header: () => <ContractHeader />,
		cell: ({ row }) => <ContractTypeCell contractType={row.original.contractType} />,
	},
	{
		accessorKey: "isActive",
		header: () => <StatusHeader />,
		cell: ({ row }) => <StatusCell isActive={row.original.isActive} />,
	},
	{
		id: "actions",
		header: () => <ActionsHeader />,
		cell: ({ row }) => <ViewDetailsCell employeeId={row.original.id} />,
	},
];
