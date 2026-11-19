"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import type {
	FeatureFlag,
	SettingsIconName,
} from "@/components/settings/settings-config";
import { SettingsFeatureOffNotice } from "@/components/settings/settings-feature-off-notice";
import { SETTINGS_ICON_MAP } from "@/components/settings/settings-icons";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";

interface SettingsCardProps {
	title: string;
	description: string;
	href: string;
	icon: SettingsIconName;
	disabled?: boolean;
	loading?: boolean;
	/** The organization feature this setting needs; explains a disabled card. */
	requiredFeature?: FeatureFlag;
	/** The viewer reaches Organization settings, where features are switched on. */
	canChangeFeatures?: boolean;
}

export function SettingsCard({
	title,
	description,
	href,
	icon,
	disabled,
	loading,
	requiredFeature,
	canChangeFeatures = false,
}: SettingsCardProps) {
	const { t } = useTranslate();
	const Icon = SETTINGS_ICON_MAP[icon];

	if (loading) {
		return (
			<Card className="h-full" aria-busy="true">
				<SettingsCardHeader
					title={title}
					description={description}
					icon={
						<div className="shrink-0 rounded-lg bg-muted p-2">
							<IconLoader2
								className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
								aria-hidden="true"
							/>
						</div>
					}
				/>
			</Card>
		);
	}

	if (disabled) {
		// The organization has this feature switched off, so the card is not a link;
		// the way to switch it on is the card's only interactive element.
		return (
			<Card className="h-full bg-muted/30 shadow-none">
				<SettingsCardHeader
					title={title}
					titleClassName="text-muted-foreground"
					badge={
						<Badge variant="outline" className="shrink-0 text-xs">
							{t("settings.notifications.status.disabled", "Disabled")}
						</Badge>
					}
					description={description}
					footer={
						requiredFeature ? (
							<SettingsFeatureOffNotice
								feature={requiredFeature}
								settingTitle={title}
								canChangeFeatures={canChangeFeatures}
								className="mt-3"
							/>
						) : null
					}
					icon={
						<div className="shrink-0 rounded-lg bg-muted p-2">
							<Icon className="size-6 text-muted-foreground" aria-hidden="true" />
						</div>
					}
				/>
			</Card>
		);
	}

	return (
		<Link
			href={href}
			className="group block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
		>
			<Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30 group-focus-visible:border-ring">
				<SettingsCardHeader
					title={title}
					description={description}
					icon={
						<div className="shrink-0 rounded-lg bg-primary/10 p-2 transition-colors group-hover:bg-primary/20">
							<Icon className="size-6 text-primary" aria-hidden="true" />
						</div>
					}
				/>
			</Card>
		</Link>
	);
}

function SettingsCardHeader({
	title,
	titleClassName,
	badge,
	description,
	footer,
	icon,
}: {
	title: string;
	titleClassName?: string;
	badge?: ReactNode;
	description: string;
	footer?: ReactNode;
	icon: ReactNode;
}) {
	return (
		<CardHeader>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className={cn("text-lg", titleClassName)}>{title}</CardTitle>
						{badge}
					</div>
					<CardDescription className="mt-1.5">{description}</CardDescription>
					{footer}
				</div>
				{icon}
			</div>
		</CardHeader>
	);
}
