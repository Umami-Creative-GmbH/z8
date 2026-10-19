import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_CARDS = [1, 2, 3];

/** The loading placeholder of a settings policy assignment manager: three assignment-level cards. */
export function AssignmentManagerSkeleton() {
	return (
		<div className="space-y-6">
			{SKELETON_CARDS.map((i) => (
				<Card key={i}>
					<CardHeader>
						<Skeleton className="h-6 w-40" />
						<Skeleton className="h-4 w-64" />
					</CardHeader>
					<CardContent>
						<Skeleton className="h-16 w-full" />
					</CardContent>
				</Card>
			))}
		</div>
	);
}
