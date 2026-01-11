import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

/**
 * Loading skeleton for settings index page with cards
 */
export function SettingsIndexSkeleton() {
	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl">
				<Skeleton className="h-9 w-32 mb-2" />
				<Skeleton className="h-5 w-96 mb-8" />

				<div className="grid gap-4 md:grid-cols-2">
					{[1, 2, 3].map((i) => (
						<Card key={i}>
							<CardHeader>
								<div className="flex items-start justify-between">
									<div className="flex-1">
										<Skeleton className="h-6 w-24 mb-2" />
										<Skeleton className="h-4 w-full" />
									</div>
									<Skeleton className="size-10 rounded-lg" />
								</div>
							</CardHeader>
							<CardContent>
								<Skeleton className="h-9 w-full" />
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</div>
	);
}

/**
 * Loading skeleton for profile settings page
 */
export function ProfileSettingsSkeleton() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-2xl">
				<div className="mb-6">
					<Skeleton className="h-8 w-48 mb-2" />
					<Skeleton className="h-4 w-96" />
				</div>

				<div className="space-y-6">
					{/* Profile Form Skeleton */}
					<Card>
						<CardHeader>
							<Skeleton className="h-6 w-32" />
						</CardHeader>
						<CardContent className="space-y-6">
							{/* Avatar */}
							<div className="flex items-center gap-4">
								<Skeleton className="size-24 rounded-full" />
								<div className="space-y-2">
									<Skeleton className="h-9 w-32" />
									<Skeleton className="h-4 w-48" />
								</div>
							</div>

							{/* Form fields */}
							<div className="space-y-4">
								<div className="space-y-2">
									<Skeleton className="h-4 w-16" />
									<Skeleton className="h-10 w-full" />
								</div>
								<div className="space-y-2">
									<Skeleton className="h-4 w-16" />
									<Skeleton className="h-10 w-full" />
								</div>
								<Skeleton className="h-9 w-24" />
							</div>
						</CardContent>
					</Card>

					{/* Session Management Skeleton */}
					<Card>
						<CardHeader>
							<Skeleton className="h-6 w-40" />
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								{[1, 2].map((i) => (
									<div key={i} className="flex items-center justify-between p-3 border rounded-lg">
										<div className="space-y-2 flex-1">
											<Skeleton className="h-4 w-32" />
											<Skeleton className="h-3 w-48" />
										</div>
										<Skeleton className="h-9 w-20" />
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}

/**
 * Loading skeleton for vacation policy page
 */
export function VacationPolicySkeleton() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<Skeleton className="h-8 w-48 mb-2" />
					<Skeleton className="h-4 w-96" />
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<Card className="lg:col-span-3">
					<CardHeader>
						<div className="flex items-center justify-between">
							<Skeleton className="h-6 w-64" />
							<Skeleton className="h-9 w-32" />
						</div>
					</CardHeader>
					<CardContent>
						<div className="grid gap-4 md:grid-cols-2">
							{[1, 2, 3, 4].map((i) => (
								<div key={i} className="space-y-2">
									<Skeleton className="h-4 w-32" />
									<Skeleton className="h-8 w-24" />
								</div>
							))}
						</div>
					</CardContent>
				</Card>

				{/* Quick Actions Cards */}
				{[1, 2, 3].map((i) => (
					<Card key={i}>
						<CardHeader>
							<Skeleton className="h-6 w-40" />
							<Skeleton className="h-4 w-full" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-9 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}

/**
 * Loading skeleton for employee allowances table
 */
export function EmployeeAllowancesSkeleton() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<Skeleton className="h-8 w-48 mb-2" />
					<Skeleton className="h-4 w-96" />
				</div>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<Skeleton className="h-6 w-32 mb-2" />
							<Skeleton className="h-4 w-64" />
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>
										<Skeleton className="h-4 w-20" />
									</TableHead>
									<TableHead>
										<Skeleton className="h-4 w-16" />
									</TableHead>
									<TableHead>
										<Skeleton className="h-4 w-24" />
									</TableHead>
									<TableHead className="text-right">
										<Skeleton className="h-4 w-24 ml-auto" />
									</TableHead>
									<TableHead className="text-right">
										<Skeleton className="h-4 w-24 ml-auto" />
									</TableHead>
									<TableHead className="text-right">
										<Skeleton className="h-4 w-20 ml-auto" />
									</TableHead>
									<TableHead className="text-right">
										<Skeleton className="h-4 w-24 ml-auto" />
									</TableHead>
									<TableHead className="text-right">
										<Skeleton className="h-4 w-28 ml-auto" />
									</TableHead>
									<TableHead className="text-right">
										<Skeleton className="h-4 w-16 ml-auto" />
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{[1, 2, 3, 4, 5].map((i) => (
									<TableRow key={i}>
										<TableCell>
											<div className="flex items-center gap-3">
												<Skeleton className="size-10 rounded-full" />
												<div className="space-y-1">
													<Skeleton className="h-4 w-32" />
													<Skeleton className="h-3 w-48" />
												</div>
											</div>
										</TableCell>
										<TableCell>
											<Skeleton className="h-4 w-20" />
										</TableCell>
										<TableCell>
											<Skeleton className="h-4 w-24" />
										</TableCell>
										<TableCell className="text-right">
											<Skeleton className="h-4 w-12 ml-auto" />
										</TableCell>
										<TableCell className="text-right">
											<Skeleton className="h-4 w-12 ml-auto" />
										</TableCell>
										<TableCell className="text-right">
											<Skeleton className="h-4 w-12 ml-auto" />
										</TableCell>
										<TableCell className="text-right">
											<Skeleton className="h-4 w-12 ml-auto" />
										</TableCell>
										<TableCell className="text-right">
											<Skeleton className="h-4 w-12 ml-auto" />
										</TableCell>
										<TableCell className="text-right">
											<Skeleton className="h-8 w-16 ml-auto" />
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

/**
 * Loading skeleton for holidays management page
 */
export function HolidaysSkeleton() {
	return (
		<div className="flex-1 items-center justify-center p-6">
			<div className="mx-auto max-w-4xl">
				<div className="mb-6">
					<Skeleton className="h-8 w-48 mb-2" />
					<Skeleton className="h-4 w-96" />
				</div>

				<div className="space-y-4">
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<Skeleton className="h-6 w-32" />
								<Skeleton className="h-9 w-32" />
							</div>
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								{[1, 2, 3, 4].map((i) => (
									<div key={i} className="flex items-center justify-between p-4 border rounded-lg">
										<div className="space-y-2 flex-1">
											<Skeleton className="h-5 w-40" />
											<Skeleton className="h-4 w-32" />
										</div>
										<div className="flex gap-2">
											<Skeleton className="h-8 w-8" />
											<Skeleton className="h-8 w-8" />
										</div>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}

/**
 * Loading skeleton for adjustment history page
 */
export function AdjustmentHistorySkeleton() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<Skeleton className="h-8 w-48 mb-2" />
					<Skeleton className="h-4 w-96" />
				</div>
			</div>

			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-64" />
				</CardHeader>
				<CardContent>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									{["Employee", "Team", "Adjustment", "Reason", "Adjusted By", "Date"].map(
										(header) => (
											<TableHead key={header}>
												<Skeleton className="h-4 w-20" />
											</TableHead>
										),
									)}
								</TableRow>
							</TableHeader>
							<TableBody>
								{[1, 2, 3, 4].map((i) => (
									<TableRow key={i}>
										<TableCell>
											<div className="flex items-center gap-3">
												<Skeleton className="size-10 rounded-full" />
												<Skeleton className="h-4 w-32" />
											</div>
										</TableCell>
										<TableCell>
											<Skeleton className="h-4 w-20" />
										</TableCell>
										<TableCell>
											<Skeleton className="h-5 w-16" />
										</TableCell>
										<TableCell>
											<Skeleton className="h-4 w-48" />
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<Skeleton className="size-6 rounded-full" />
												<Skeleton className="h-4 w-24" />
											</div>
										</TableCell>
										<TableCell>
											<Skeleton className="h-4 w-24" />
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
