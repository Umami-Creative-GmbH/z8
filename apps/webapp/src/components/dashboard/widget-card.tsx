import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { use } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetCardVariantContext } from "./widget-card-variant";
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
	const strip = use(WidgetCardVariantContext) === "strip";
	const heading = (
		<CardTitle>
			<h2 className="flex items-center gap-2 text-base font-semibold">
				<span className="shrink-0" aria-hidden="true">
					{icon}
				</span>
				{title}
			</h2>
		</CardTitle>
	);
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
				className={cn("size-4", refreshing && "animate-spin motion-reduce:animate-none")}
			/>
		</Button>
	) : null;
	const descriptionNode = description ? (
		<CardDescription className={strip ? "sr-only" : "mt-1 text-sm"}>{description}</CardDescription>
	) : null;

	return (
		<Card className={cn("py-5 shadow-none", strip ? "h-full gap-3" : "gap-4")}>
			<CardHeader className="px-5">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0 flex-1">
						{heading}
						{descriptionNode}
					</div>
					{loading ? null : (
						<div className="-my-1.5 flex items-center gap-2">
							{RefreshButton}
							{action}
						</div>
					)}
				</div>
			</CardHeader>
			<CardContent className="px-5">
				{loading ? (
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-8 animate-spin motion-reduce:animate-none text-muted-foreground" />
					</div>
				) : (
					children
				)}
			</CardContent>
		</Card>
	);
}
