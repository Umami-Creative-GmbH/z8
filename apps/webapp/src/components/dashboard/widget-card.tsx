import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
	const { t } = useTranslate();
	const RefreshButton = onRefresh ? (
		<Button
			variant="ghost"
			size="icon"
			onClick={onRefresh}
			disabled={refreshing}
			className="size-9 text-muted-foreground"
			aria-label={t("dashboard.widgets.refresh", "Refresh")}
		>
			<IconRefresh
				className={cn(
					"size-4",
					refreshing && "animate-spin motion-reduce:animate-none",
				)}
			/>
		</Button>
	) : null;

	if (loading) {
		return (
			<Card className="gap-4 py-5 shadow-none">
				<CardHeader className="px-5">
					<CardTitle className="flex items-center gap-2">
						{icon}
						{title}
					</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-8 animate-spin motion-reduce:animate-none text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="gap-4 py-5 shadow-none">
			<CardHeader className="px-5">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0 flex-1">
						<CardTitle>
							<h2 className="text-base font-semibold">{title}</h2>
						</CardTitle>
						{description ? (
							<CardDescription className="mt-1 text-sm">
								{description}
							</CardDescription>
						) : null}
					</div>
					<div className="flex items-center gap-2">
						{RefreshButton}
						{action}
					</div>
				</div>
			</CardHeader>
			<CardContent className="px-5">{children}</CardContent>
		</Card>
	);
}
