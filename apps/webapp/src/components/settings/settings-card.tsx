import { IconLoader2 } from "@tabler/icons-react";
import type { SettingsIconName } from "@/components/settings/settings-config";
import { SETTINGS_ICON_MAP } from "@/components/settings/settings-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/navigation";

interface SettingsCardProps {
	title: string;
	description: string;
	href: string;
	icon: SettingsIconName;
	disabled?: boolean;
	loading?: boolean;
}

export function SettingsCard({
	title,
	description,
	href,
	icon,
	disabled,
	loading,
}: SettingsCardProps) {
	const Icon = SETTINGS_ICON_MAP[icon];

	if (loading) {
		return (
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div className="flex-1 min-w-0">
							<CardTitle className="text-lg">{title}</CardTitle>
							<CardDescription className="mt-1.5">{description}</CardDescription>
						</div>
						<div className="rounded-lg bg-muted p-2 flex-shrink-0">
							<IconLoader2 className="size-6 text-muted-foreground animate-spin" />
						</div>
					</div>
				</CardHeader>
			</Card>
		);
	}

	if (disabled) {
		return (
			<Card className="cursor-not-allowed">
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<CardTitle className="text-lg text-muted-foreground">{title}</CardTitle>
								<Badge variant="outline" className="text-xs">
									Disabled
								</Badge>
							</div>
							<CardDescription className="mt-1.5">{description}</CardDescription>
						</div>
						<div className="rounded-lg bg-muted p-2 flex-shrink-0">
							<Icon className="size-6 text-muted-foreground" />
						</div>
					</div>
				</CardHeader>
			</Card>
		);
	}

	return (
		<Link href={href} className="block group">
			<Card className="opacity-75 hover:opacity-100 transition-all duration-300 hover:shadow-md hover:border-primary/50 cursor-pointer">
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div className="flex-1 min-w-0">
							<CardTitle className="text-lg">{title}</CardTitle>
							<CardDescription className="mt-1.5">{description}</CardDescription>
						</div>
						<div className="rounded-lg bg-primary/10 p-2 group-hover:bg-primary/20 transition-colors flex-shrink-0">
							<Icon className="size-6 text-primary" />
						</div>
					</div>
				</CardHeader>
			</Card>
		</Link>
	);
}
