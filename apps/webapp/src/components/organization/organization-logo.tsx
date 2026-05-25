"use client";

import { IconBuilding } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const sizeClass = {
	xs: "size-6",
	sm: "size-8",
	md: "size-16",
} as const;

const sizePixels = {
	xs: 24,
	sm: 32,
	md: 64,
} as const;

const iconClass = {
	xs: "size-4",
	sm: "size-4",
	md: "size-8",
} as const;

type OrganizationLogoSize = keyof typeof sizeClass;

interface OrganizationLogoProps {
	logo?: string | null;
	name: string;
	size?: OrganizationLogoSize;
	className?: string;
	fallbackClassName?: string;
}

export function OrganizationLogo({
	logo,
	name,
	size = "md",
	className,
	fallbackClassName,
}: OrganizationLogoProps) {
	const [imageFailed, setImageFailed] = useState(false);

	useEffect(() => {
		setImageFailed(false);
	}, [logo]);

	const showLogo = Boolean(logo) && !imageFailed;

	return (
		<Avatar className={cn(sizeClass[size], "rounded-lg", className)}>
			{showLogo ? (
				<img
					src={logo ?? undefined}
					alt={name}
					width={sizePixels[size]}
					height={sizePixels[size]}
					className="aspect-square size-full object-cover"
					onError={() => setImageFailed(true)}
				/>
			) : (
				<AvatarFallback
					className={cn("rounded-lg bg-primary/10 text-primary", fallbackClassName)}
					data-testid="organization-logo-fallback"
				>
					<IconBuilding className={cn(iconClass[size], "text-current")} />
				</AvatarFallback>
			)}
		</Avatar>
	);
}
