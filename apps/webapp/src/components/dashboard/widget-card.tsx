import { IconLoader2 } from "@tabler/icons-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

interface WidgetCardProps {
	title: string;
	description: string;
	icon: React.ReactNode;
	loading?: boolean;
	children?: React.ReactNode;
	action?: React.ReactNode;
}

export function WidgetCard({
	title,
	description,
	icon,
	loading,
	children,
	action,
}: WidgetCardProps) {
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
				{action ? (
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="flex items-center gap-2">
								{icon}
								{title}
							</CardTitle>
							<CardDescription>{description}</CardDescription>
						</div>
						{action}
					</div>
				) : (
					<>
						<CardTitle className="flex items-center gap-2">
							{icon}
							{title}
						</CardTitle>
						<CardDescription>{description}</CardDescription>
					</>
				)}
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}
