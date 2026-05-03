"use client";

import { useQuery } from "@tanstack/react-query";
import { getEmployeeGroups } from "@/app/[locale]/(app)/settings/approval-policies/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export const employeeGroupQueryKey = (organizationId: string) =>
	["approval-policy-employee-groups", organizationId] as const;

type EmployeeGroupData = Awaited<ReturnType<typeof getEmployeeGroups>>[number];

interface EmployeeGroupManagementProps {
	organizationId: string;
}

function groupMemberCount(group: EmployeeGroupData) {
	return group.members.length;
}

export function EmployeeGroupManagement({ organizationId }: EmployeeGroupManagementProps) {
	const { data, isLoading, isError } = useQuery({
		queryKey: employeeGroupQueryKey(organizationId),
		queryFn: getEmployeeGroups,
	});
	const groups = data || [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Employee Groups</CardTitle>
				<CardDescription>
					Reusable employee cohorts for policies that need group-specific approval chains.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="py-6 text-sm text-muted-foreground">Loading employee groups…</div>
				) : isError ? (
					<div className="py-6 text-sm text-destructive" role="status">
						Employee groups could not be loaded.
					</div>
				) : groups.length === 0 ? (
					<div className="py-6 text-sm text-muted-foreground">
						No employee groups configured yet. Groups can be used as policy conditions once created.
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="min-w-0">Name</TableHead>
								<TableHead className="min-w-0">Description</TableHead>
								<TableHead>Members</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{groups.map((group) => (
								<TableRow key={group.id}>
									<TableCell className="min-w-0 max-w-[16rem] font-medium">
										<div className="truncate" title={group.name}>
											{group.name}
										</div>
									</TableCell>
									<TableCell className="min-w-0 max-w-[24rem]">
										<div className="break-words" title={group.description || undefined}>
											{group.description || "-"}
										</div>
									</TableCell>
									<TableCell>{groupMemberCount(group)}</TableCell>
									<TableCell>
										<Badge variant={group.isActive ? "default" : "outline"}>
											{group.isActive ? "Active" : "Inactive"}
										</Badge>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
