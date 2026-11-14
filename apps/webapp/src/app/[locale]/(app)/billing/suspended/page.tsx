import { Suspense } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { SuspendedBillingContent } from "./suspended-billing-content";

export default function SuspendedBillingPage() {
	return (
		<Suspense
			fallback={
				<LoadingRegion
					className="flex flex-1 items-center justify-center px-4 py-6 sm:p-6"
					label={{ labelKey: "common.loading", labelDefault: "Loading..." }}
				>
					<Card className="my-auto w-full max-w-xl shadow-none">
						<CardHeader className="gap-4">
							<Skeleton className="size-10 rounded-lg" />
							<Skeleton className="h-5 w-1/2" />
							<Skeleton className="h-8 w-3/4" />
							<Skeleton className="h-16 w-full" />
						</CardHeader>
					</Card>
				</LoadingRegion>
			}
		>
			<SuspendedBillingContent />
		</Suspense>
	);
}
