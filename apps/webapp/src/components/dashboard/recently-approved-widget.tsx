"use client";

import { IconCheck } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "@/lib/datetime/luxon-utils";
import { pluralize } from "@/lib/utils";
import { Link } from "@/navigation";
import { getRecentlyApprovedRequests } from "./actions";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

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
	const {
		data: requests,
		loading,
		refreshing,
		refetch,
	} = useWidgetData<RecentlyApproved[]>(() => getRecentlyApprovedRequests(10), {
		errorMessage: "Failed to load recently approved requests",
	});

	if (!loading && (!requests || requests.length === 0)) return null;

	return (
		<WidgetCard
			title="Recently Approved"
			description={
				requests
					? `Last ${requests.length} approved ${pluralize(requests.length, "request")}`
					: "Latest approved requests"
			}
			icon={<IconCheck className="size-4 text-muted-foreground" />}
			loading={loading}
			refreshing={refreshing}
			onRefresh={refetch}
		>
			{requests && (
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
										Approved by {request.approverEmployee?.user.name || "Unknown"}
										{" • "}
										{format(new Date(request.updatedAt), "MMM d, yyyy")}
									</div>
								</div>
								<Badge
									variant={request.type === "absence" ? "default" : "secondary"}
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
			)}
		</WidgetCard>
	);
}
