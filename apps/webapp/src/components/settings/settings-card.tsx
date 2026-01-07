import { IconArrowRight } from "@tabler/icons-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/navigation";

interface SettingsCardProps {
	title: string;
	description: string;
	href: string;
	icon: React.ComponentType<{ className?: string }>;
}

export function SettingsCard({ title, description, href, icon: Icon }: SettingsCardProps) {
	return (
		<Link href={href} className="block group">
			<Card className="transition-all hover:shadow-md hover:border-primary/50 cursor-pointer">
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<CardTitle className="text-lg">{title}</CardTitle>
								<IconArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
							</div>
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
