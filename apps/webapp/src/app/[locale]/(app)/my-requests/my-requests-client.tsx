"use client";

import type { SelfServiceRequestResult } from "@/lib/self-service-requests/types";

interface MyRequestsClientProps {
	initialResult: SelfServiceRequestResult;
}

export function MyRequestsClient({ initialResult }: MyRequestsClientProps) {
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<h1 className="text-2xl font-semibold tracking-tight">My Requests</h1>
				<p className="text-sm text-muted-foreground">
					Track pending requests, required fixes, and recent decisions.
				</p>
			</div>
			<div className="px-4 lg:px-6">
				<p className="text-sm text-muted-foreground">
					{initialResult.counts.total} requests loaded.
				</p>
			</div>
		</div>
	);
}
