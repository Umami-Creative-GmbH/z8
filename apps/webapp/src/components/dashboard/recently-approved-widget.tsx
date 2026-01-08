"use client";

import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { getRecentlyApprovedRequests } from "./actions";

type RecentlyApproved = {
	id: string;
	type: "absence" | "time_correction";
	updatedAt: Date;
	requestedByEmployee: {
		user: {
			name: string | null;
		};
	};
	approverEmployee: {
		user: {
			name: string | null;
		};
	} | null;
};

export function RecentlyApprovedWidget() {
	const [requests, setRequests] = useState<RecentlyApproved[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function loadData() {
			try {
				const result = await getRecentlyApprovedRequests(10);
				if (result.success && result.data) {
					setRequests(result.data);
				}
			} catch (error) {
				toast.error("Failed to load recently approved requests");
			} finally {
				setLoading(false);
			}
		}
		loadData();
	}, []);

	// Auto-hide when no recent approvals
	if (!loading && requests.length === 0) {
		return null;
	}

	if (loading) {
		return (
			<Card className="overflow-hidden gap-0 py-0">
				<CardHeader className="bg-gradient-to-br from-green-500/10 via-emerald-500/10 to-teal-500/10 py-4">
					<CardTitle className="flex items-center gap-2">
						<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 text-white">
							<IconCheck className="size-4" />
						</div>
						Recently Approved
					</CardTitle>
					<CardDescription className="mt-1.5">
						Latest approved requests
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
			<CardHeader className="bg-gradient-to-br from-green-500/10 via-emerald-500/10 to-teal-500/10 py-4">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 text-white">
								<IconCheck className="size-4" />
							</div>
							Recently Approved
						</CardTitle>
						<CardDescription className="mt-1.5">
							Last {requests.length} approved request
							{requests.length !== 1 ? "s" : ""}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="py-4">
				<div className="space-y-3">
					<div className="space-y-2">
						{requests.slice(0, 5).map((request) => (
							<div
								key={request.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="flex-1">
									<div className="font-medium">
										{request.requestedByEmployee.user.name || "Unknown"}
									</div>
									<div className="text-xs text-muted-foreground">
										Approved by{" "}
										{request.approverEmployee?.user.name || "Unknown"}
										{" • "}
										{format(new Date(request.updatedAt), "MMM d, yyyy")}
									</div>
								</div>
								<Badge
									variant={
										request.type === "absence" ? "default" : "secondary"
									}
									className="ml-3"
								>
									{request.type === "absence" ? "Absence" : "Time Correction"}
								</Badge>
							</div>
						))}
					</div>

					{requests.length > 5 && (
						<div className="text-xs text-center text-muted-foreground">
							and {requests.length - 5} more...
						</div>
					)}

					<Button className="w-full" variant="outline" asChild>
						<Link href="/approvals">View All Approvals</Link>
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
