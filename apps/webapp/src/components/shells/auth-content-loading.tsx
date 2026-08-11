import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalizedLoadingLabel } from "./localized-loading-label";

export function AuthContentLoading() {
	return (
		<div
			aria-busy="true"
			className="flex w-full items-center justify-center p-4"
			role="status"
		>
			<LocalizedLoadingLabel
				translationKey="common:loading.authentication"
				fallback="Loading authentication"
			/>
			<Card className="w-full max-w-sm">
				<CardHeader>
					<Skeleton aria-hidden="true" className="h-7 w-2/3" />
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="space-y-2">
						<Skeleton aria-hidden="true" className="h-4 w-20" />
						<Skeleton aria-hidden="true" className="h-10 w-full" />
					</div>
					<div className="space-y-2">
						<Skeleton aria-hidden="true" className="h-4 w-20" />
						<Skeleton aria-hidden="true" className="h-10 w-full" />
					</div>
					<Skeleton aria-hidden="true" className="h-10 w-full" />
				</CardContent>
			</Card>
		</div>
	);
}
