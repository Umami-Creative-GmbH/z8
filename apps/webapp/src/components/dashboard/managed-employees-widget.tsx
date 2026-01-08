"use client";

import { IconLoader2, IconUserCheck, IconUsers } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Link } from "@/navigation";
import { getManagedEmployees } from "./actions";

export function ManagedEmployeesWidget() {
	const [employees, setEmployees] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [currentEmployee, setCurrentEmployee] = useState<any>(null);
	const [isManager, setIsManager] = useState(false);

	useEffect(() => {
		async function loadData() {
			const current = await getCurrentEmployee();
			if (!current) {
				setLoading(false);
				return;
			}
			setCurrentEmployee(current);

			// Check if current employee is a manager or admin
			const result = await getManagedEmployees(current.id);
			if (result.success && result.data) {
				setEmployees(result.data);
				setIsManager(result.data.length > 0 || current.role === "admin");
			} else if (result.error) {
				toast.error(result.error);
			}

			setLoading(false);
		}

		loadData();
	}, []);

	// Don't show widget if not a manager
	if (!loading && !isManager) {
		return null;
	}

	if (loading) {
		return (
			<Card className="overflow-hidden gap-0 py-0">
				<CardHeader className="bg-gradient-to-br from-rose-500/10 via-red-500/10 to-orange-500/10 py-4">
					<CardTitle className="flex items-center gap-2">
						<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-red-500 text-white">
							<IconUsers className="size-4" />
						</div>
						Your Team
					</CardTitle>
					<CardDescription className="mt-1.5">
						Employees you manage
					</CardDescription>
				</CardHeader>
				<CardContent className="py-4">
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="overflow-hidden gap-0 py-0">
			<CardHeader className="bg-gradient-to-br from-rose-500/10 via-red-500/10 to-orange-500/10 py-4">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-red-500 text-white">
								<IconUsers className="size-4" />
							</div>
							Your Team
						</CardTitle>
						<CardDescription className="mt-1.5">
							Employees you manage ({employees.length})
						</CardDescription>
					</div>
					<Button variant="ghost" size="sm" asChild>
						<Link href="/settings/employees">View All</Link>
					</Button>
				</div>
			</CardHeader>
			<CardContent className="py-4">
				{employees.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-center">
						<IconUserCheck className="mb-4 size-12 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							You don't manage any employees yet
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{employees.slice(0, 5).map((emp) => (
							<div
								key={emp.id}
								className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
							>
								<div className="flex items-center gap-3">
									<Avatar className="size-10">
										<AvatarImage src={emp.user.image || undefined} />
										<AvatarFallback>
											{emp.user.name
												.split(" ")
												.map((n: string) => n[0])
												.join("")
												.toUpperCase()}
										</AvatarFallback>
									</Avatar>
									<div>
										<div className="font-medium">{emp.user.name}</div>
										<div className="text-sm text-muted-foreground">
											{emp.position || emp.user.email}
										</div>
									</div>
								</div>
								<div className="flex items-center gap-2">
									{emp.team && (
										<Badge variant="secondary">{emp.team.name}</Badge>
									)}
									<Button variant="ghost" size="sm" asChild>
										<Link href={`/settings/employees/${emp.id}`}>
											View
										</Link>
									</Button>
								</div>
							</div>
						))}

						{employees.length > 5 && (
							<div className="pt-2 text-center">
								<Button variant="outline" size="sm" asChild>
									<Link href="/settings/employees">
										View all {employees.length} employees
									</Link>
								</Button>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
