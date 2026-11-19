"use client";

import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getEmployeeGroups } from "@/app/[locale]/(app)/settings/approval-policies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

const employeeGroupQueryKey = (organizationId: string) =>
	["approval-policy-employee-groups", organizationId] as const;

type EmployeeGroupData = Extract<
	Awaited<ReturnType<typeof getEmployeeGroups>>,
	{ success: true }
>["data"][number];

interface EmployeeGroupManagementProps {
	organizationId: string;
}

function groupMemberCount(group: EmployeeGroupData) {
	return group.members.length;
}

export function EmployeeGroupManagement({ organizationId }: EmployeeGroupManagementProps) {
	const { t } = useTranslate();
	const { data, isLoading, isError, isRefetching, refetch } = useQuery({
		queryKey: employeeGroupQueryKey(organizationId),
		queryFn: async () => {
			const result = await getEmployeeGroups();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const groups = data || [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.employeeGroups.title", "Employee Groups")}</CardTitle>
				<CardDescription>
					{t(
						"settings.employeeGroups.description",
						"Reusable employee cohorts for policies that need group-specific approval chains.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="py-6 text-sm text-muted-foreground" role="status">
						{t("settings.employeeGroups.loading", "Loading employee groups…")}
					</div>
				) : isError ? (
					<div className="flex flex-wrap items-center gap-3 py-6">
						<p className="text-sm text-destructive" role="alert">
							{t("settings.employeeGroups.loadFailed", "Employee groups could not be loaded.")}
						</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => refetch()}
							disabled={isRefetching}
						>
							{isRefetching ? (
								<IconLoader2
									className="mr-2 size-4 motion-safe:animate-spin"
									aria-hidden="true"
								/>
							) : (
								<IconRefresh className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("common.retry", "Retry")}
						</Button>
					</div>
				) : groups.length === 0 ? (
					<div className="py-6 text-sm text-muted-foreground">
						{t(
							"settings.employeeGroups.empty",
							"No employee groups configured yet. Groups can be used as policy conditions once created.",
						)}
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="min-w-0">{t("common.name", "Name")}</TableHead>
								<TableHead className="min-w-0">{t("common.description", "Description")}</TableHead>
								<TableHead>{t("settings.employeeGroups.members", "Members")}</TableHead>
								<TableHead>{t("settings.employeeGroups.status", "Status")}</TableHead>
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
									<TableCell className="tabular-nums">{groupMemberCount(group)}</TableCell>
									<TableCell>
										<Badge variant={group.isActive ? "default" : "outline"}>
											{group.isActive
												? t("settings.employeeGroups.status.active", "Active")
												: t("settings.employeeGroups.status.inactive", "Inactive")}
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
