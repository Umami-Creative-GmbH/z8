import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface WidgetCardProps {
	title: string;
	description: string;
	icon: React.ReactNode;
	loading?: boolean;
	refreshing?: boolean;
	onRefresh?: () => void;
	children?: React.ReactNode;
	action?: React.ReactNode;
}

export function WidgetCard({
	title,
	description,
	icon,
	loading,
	refreshing,
	onRefresh,
	children,
	action,
}: WidgetCardProps) {
	const RefreshButton = onRefresh ? (
		<Button
			variant="ghost"
			size="icon"
			onClick={onRefresh}
			disabled={refreshing}
			className="size-8"
			title="Refresh"
		>
			<IconRefresh className={cn("size-4", refreshing && "animate-spin")} />
		</Button>
	) : null;

	if (loading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						{icon}
						{title}
					</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							{icon}
							{title}
						</CardTitle>
						<CardDescription>{description}</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						{RefreshButton}
						{action}
					</div>
				</div>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}
