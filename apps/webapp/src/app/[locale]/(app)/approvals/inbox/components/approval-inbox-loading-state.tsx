"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ApprovalInboxLoadingState() {
	const { t } = useTranslate();
	const loadingLabel = t("approvals:approvals.loadingInbox", "Loading approval inbox");

	return (
		<div
			aria-busy="true"
			aria-label={loadingLabel}
			className="@container/main page-frame flex flex-1 flex-col gap-6"
			role="status"
		>
			<div className="flex items-center justify-between">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-48" />
					<Skeleton aria-hidden="true" className="h-4 w-72 max-w-full" />
				</div>
				<Skeleton aria-hidden="true" className="hidden h-9 w-36 sm:block" />
			</div>
			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<Card>
					<CardHeader className="space-y-2">
						<Skeleton aria-hidden="true" className="h-6 w-36" />
						<Skeleton aria-hidden="true" className="h-4 w-64 max-w-full" />
					</CardHeader>
					<CardContent className="space-y-4">
						<div
							aria-hidden="true"
							className="flex flex-wrap gap-2 border-b pb-4"
							data-testid="approval-toolbar-loading"
						>
							<Skeleton className="h-9 w-48" />
							<Skeleton className="h-9 w-28" />
							<Skeleton className="h-9 w-24" />
						</div>
						<div aria-hidden="true" className="space-y-2" data-testid="approval-table-loading">
							<Skeleton className="h-8 w-full" />
							{["first", "second", "third", "fourth", "fifth"].map((row) => (
								<Skeleton className="h-12 w-full" key={row} />
							))}
						</div>
					</CardContent>
				</Card>
				<div aria-hidden="true" data-testid="approval-detail-loading">
					<Card className="h-full">
						<CardHeader className="space-y-3">
							<Skeleton className="h-6 w-32" />
							<Skeleton className="h-4 w-full" />
						</CardHeader>
						<CardContent className="space-y-4">
							<Skeleton className="h-20 w-full" />
							<Skeleton className="h-16 w-full" />
							<div className="flex gap-2">
								<Skeleton className="h-9 flex-1" />
								<Skeleton className="h-9 flex-1" />
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
