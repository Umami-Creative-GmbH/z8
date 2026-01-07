import { IconClockHour4 } from "@tabler/icons-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getAdjustmentHistory } from "../actions";

async function AdjustmentHistoryContent() {
	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="view adjustment history" />
			</div>
		);
	}

	// Check if user has admin role
	const { getAuthContext } = await import("@/lib/auth-helpers");
	const authContext = await getAuthContext();

	if (!authContext?.employee || authContext.employee.role !== "admin") {
		redirect("/");
	}

	const currentYear = new Date().getFullYear();
	const { data: adjustments } = await getAdjustmentHistory(
		authContext.employee.organizationId,
		currentYear,
	);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Adjustment History</h1>
					<p className="text-sm text-muted-foreground">
						Audit trail of all manual vacation allowance adjustments
					</p>
				</div>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Adjustments for {currentYear}</CardTitle>
							<CardDescription>
								All manual adjustments to employee vacation allowances
							</CardDescription>
						</div>
						<Badge variant="secondary">{adjustments.length} adjustments</Badge>
					</div>
				</CardHeader>
				<CardContent>
					{adjustments.length === 0 ? (
						<div className="rounded-lg border border-dashed p-8 text-center">
							<IconClockHour4 className="mx-auto size-10 text-muted-foreground" />
							<h3 className="mt-4 text-lg font-semibold">No adjustments yet</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Manual adjustments to employee vacation allowances will appear here.
							</p>
						</div>
					) : (
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Employee</TableHead>
										<TableHead>Team</TableHead>
										<TableHead className="text-right">Adjustment</TableHead>
										<TableHead>Reason</TableHead>
										<TableHead>Adjusted By</TableHead>
										<TableHead>Date</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{adjustments.map((adjustment) => {
										const adjustmentDays = parseFloat(adjustment.adjustmentDays || "0");

										return (
											<TableRow key={adjustment.id}>
												<TableCell>
													<div className="flex items-center gap-3">
														<Avatar className="size-8">
															<AvatarImage src={adjustment.employee.user.image || undefined} />
															<AvatarFallback>
																{adjustment.employee.user.name
																	.split(" ")
																	.map((n) => n[0])
																	.join("")
																	.toUpperCase()}
															</AvatarFallback>
														</Avatar>
														<div>
															<div className="font-medium">{adjustment.employee.user.name}</div>
															<div className="text-xs text-muted-foreground">
																{adjustment.employee.user.email}
															</div>
														</div>
													</div>
												</TableCell>
												<TableCell>{adjustment.employee.team?.name || "—"}</TableCell>
												<TableCell className="text-right">
													<Badge
														variant={adjustmentDays > 0 ? "default" : "destructive"}
														className="font-mono"
													>
														{adjustmentDays > 0 ? "+" : ""}
														{adjustmentDays} days
													</Badge>
												</TableCell>
												<TableCell className="max-w-[300px]">
													<div className="truncate text-sm">{adjustment.adjustmentReason}</div>
												</TableCell>
												<TableCell>
													{adjustment.adjuster ? (
														<div className="flex items-center gap-2">
															<Avatar className="size-6">
																<AvatarImage src={adjustment.adjuster.user.image || undefined} />
																<AvatarFallback className="text-xs">
																	{adjustment.adjuster.user.name
																		.split(" ")
																		.map((n) => n[0])
																		.join("")
																		.toUpperCase()}
																</AvatarFallback>
															</Avatar>
															<span className="text-sm">{adjustment.adjuster.user.name}</span>
														</div>
													) : (
														<span className="text-sm text-muted-foreground">—</span>
													)}
												</TableCell>
												<TableCell>
													{adjustment.adjustedAt ? (
														<span className="text-sm text-muted-foreground">
															{new Date(adjustment.adjustedAt).toLocaleDateString("en-US", {
																month: "short",
																day: "numeric",
																year: "numeric",
																hour: "numeric",
																minute: "2-digit",
															})}
														</span>
													) : (
														<span className="text-sm text-muted-foreground">—</span>
													)}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function AdjustmentHistoryLoading() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="space-y-2">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-4 w-96" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-96" />
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function AdjustmentHistoryPage() {
	return (
		<Suspense fallback={<AdjustmentHistoryLoading />}>
			<AdjustmentHistoryContent />
		</Suspense>
	);
}
