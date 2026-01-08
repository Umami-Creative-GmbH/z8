"use client";

import { IconAlertCircle, IconCheck, IconClock, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getPendingApprovals } from "@/app/[locale]/(app)/approvals/actions";
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
import { format } from "@/lib/datetime/luxon-utils";

export function PendingApprovalsWidget() {
	const [absenceApprovals, setAbsenceApprovals] = useState<any[]>([]);
	const [timeCorrectionApprovals, setTimeCorrectionApprovals] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function loadData() {
			try {
				const { absenceApprovals: absences, timeCorrectionApprovals: corrections } =
					await getPendingApprovals();
				setAbsenceApprovals(absences);
				setTimeCorrectionApprovals(corrections);
			} catch (error) {
				toast.error("Failed to load pending approvals");
			} finally {
				setLoading(false);
			}
		}

		loadData();
	}, []);

	const totalPending = absenceApprovals.length + timeCorrectionApprovals.length;

	// Don't show widget if no pending approvals
	if (!loading && totalPending === 0) {
		return null;
	}

	if (loading) {
		return (
			<Card className="overflow-hidden gap-0 py-0">
				<CardHeader className="bg-gradient-to-br from-orange-500/10 via-amber-500/10 to-yellow-500/10 py-4">
					<CardTitle className="flex items-center gap-2">
						<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
							<IconClock className="size-4" />
						</div>
						Pending Approvals
					</CardTitle>
					<CardDescription className="mt-1.5">
						Requests awaiting your review
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
			<CardHeader className="bg-gradient-to-br from-orange-500/10 via-amber-500/10 to-yellow-500/10 py-4">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white">
								<IconClock className="size-4" />
							</div>
							Pending Approvals
						</CardTitle>
						<CardDescription className="mt-1.5">
							{totalPending} request{totalPending !== 1 ? "s" : ""} awaiting your approval
						</CardDescription>
					</div>
					<Badge className="bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0 text-lg">
						{totalPending}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="py-4">
				<div className="space-y-3">
					{/* Absence Requests */}
					{absenceApprovals.length > 0 && (
						<div className="rounded-lg border p-4">
							<div className="mb-3 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<IconAlertCircle className="size-5 text-orange-500" />
									<span className="font-medium">Absence Requests</span>
								</div>
								<Badge variant="secondary">{absenceApprovals.length}</Badge>
							</div>
							<div className="space-y-2">
								{absenceApprovals.slice(0, 3).map((approval) => (
									<div
										key={approval.id}
										className="flex items-center justify-between text-sm"
									>
										<div>
											<div className="font-medium">{approval.employee.user.name}</div>
											<div className="text-xs text-muted-foreground">
												{format(new Date(approval.startDate), "MMM d")} -{" "}
												{format(new Date(approval.endDate), "MMM d, yyyy")}
											</div>
										</div>
										<Badge variant="outline">{approval.type}</Badge>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Time Correction Requests */}
					{timeCorrectionApprovals.length > 0 && (
						<div className="rounded-lg border p-4">
							<div className="mb-3 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<IconCheck className="size-5 text-blue-500" />
									<span className="font-medium">Time Corrections</span>
								</div>
								<Badge variant="secondary">{timeCorrectionApprovals.length}</Badge>
							</div>
							<div className="space-y-2">
								{timeCorrectionApprovals.slice(0, 3).map((approval) => (
									<div
										key={approval.id}
										className="flex items-center justify-between text-sm"
									>
										<div>
											<div className="font-medium">{approval.employee.user.name}</div>
											<div className="text-xs text-muted-foreground">
												{format(new Date(approval.date), "MMM d, yyyy")}
											</div>
										</div>
										<Badge variant="outline">Correction</Badge>
									</div>
								))}
							</div>
						</div>
					)}

					<div className="pt-2">
						<Button className="w-full" asChild>
							<Link href="/approvals">Review All Approvals</Link>
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
