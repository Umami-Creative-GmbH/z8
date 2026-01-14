"use client";

import { IconUserCheck, IconUsers } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@/navigation";
import { getManagedEmployees } from "./actions";
import { WidgetCard } from "./widget-card";

type ManagedEmployee = {
	id: string;
	position: string | null;
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
	team: {
		name: string;
	} | null;
};

export function ManagedEmployeesWidget() {
	const [employees, setEmployees] = useState<ManagedEmployee[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [isManager, setIsManager] = useState(false);

	const loadData = useCallback(async (isRefresh = false) => {
		if (isRefresh) {
			setRefreshing(true);
		}

		const current = await getCurrentEmployee();
		if (!current) {
			setLoading(false);
			setRefreshing(false);
			return;
		}

		const result = await getManagedEmployees(current.id);
		if (result.success) {
			setEmployees(result.data);
			setIsManager(result.data.length > 0 || current.role === "admin");
		} else {
			toast.error(result.error);
		}

		setLoading(false);
		setRefreshing(false);
	}, []);

	useEffect(() => {
		loadData(false);
	}, [loadData]);

	const refetch = useCallback(() => {
		loadData(true);
	}, [loadData]);

	if (!loading && !isManager) return null;

	return (
		<WidgetCard
			title="Your Team"
			description={`Employees you manage (${employees.length})`}
			icon={<IconUsers className="size-4 text-muted-foreground" />}
			loading={loading}
			refreshing={refreshing}
			onRefresh={refetch}
			action={
				<Button variant="ghost" size="sm" asChild>
					<Link href="/settings/employees">View All</Link>
				</Button>
			}
		>
			{employees.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-8 text-center">
					<IconUserCheck className="mb-4 size-12 text-muted-foreground" />
					<p className="text-sm text-muted-foreground">You don't manage any employees yet</p>
				</div>
			) : (
				<div className="space-y-3">
					{employees.slice(0, 5).map((emp) => (
						<div
							key={emp.id}
							className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
						>
							<div className="flex items-center gap-3">
								<UserAvatar
									image={emp.user.image}
									seed={emp.user.id}
									name={emp.user.name}
									size="md"
								/>
								<div>
									<div className="font-medium">{emp.user.name}</div>
									<div className="text-sm text-muted-foreground">
										{emp.position || emp.user.email}
									</div>
								</div>
							</div>
							<div className="flex items-center gap-2">
								{emp.team && <Badge variant="secondary">{emp.team.name}</Badge>}
								<Button variant="ghost" size="sm" asChild>
									<Link href={`/settings/employees/${emp.id}`}>View</Link>
								</Button>
							</div>
						</div>
					))}

					{employees.length > 5 && (
						<div className="pt-2 text-center">
							<Button variant="outline" size="sm" asChild>
								<Link href="/settings/employees">View all {employees.length} employees</Link>
							</Button>
						</div>
					)}
				</div>
			)}
		</WidgetCard>
	);
}
