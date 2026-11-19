import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsListSkeleton() {
	return (
		<Card aria-busy="true">
			<CardHeader className="space-y-2">
				<Skeleton className="h-6 w-40" />
				<Skeleton className="h-4 w-28" />
			</CardHeader>
			<CardContent className="space-y-4">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
			</CardContent>
		</Card>
	);
}
