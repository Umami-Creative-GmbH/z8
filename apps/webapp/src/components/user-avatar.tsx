"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { generateAvatarDataUri, getInitials, type UserAvatarGender } from "@/lib/avatar";
import { cn } from "@/lib/utils";

const sizeConfig = {
	xs: { class: "size-6", pixels: 24, spinner: "size-3", badge: "size-2" },
	sm: { class: "size-8", pixels: 32, spinner: "size-3", badge: "size-2.5" },
	md: { class: "size-10", pixels: 40, spinner: "size-4", badge: "size-3" },
	lg: { class: "size-16", pixels: 64, spinner: "size-5", badge: "size-4" },
	xl: { class: "size-24", pixels: 96, spinner: "size-6", badge: "size-5" },
} as const;

const shapeConfig = {
	circle: "rounded-full",
	rounded: "rounded-lg",
} as const;

export type UserAvatarSize = keyof typeof sizeConfig;
export type UserAvatarShape = keyof typeof shapeConfig;
export type EmployeeClockStatus = "clocked-in" | "clocked-out" | "unknown";

function getClockStatusBadge(
	clockStatus: EmployeeClockStatus | undefined,
	t: ReturnType<typeof useTranslate>["t"],
) {
	if (clockStatus === "clocked-in") {
		return { label: t("common:presence.clockedIn", "Clocked in"), className: "bg-emerald-500" };
	}

	if (clockStatus === "clocked-out") {
		return { label: t("common:presence.clockedOut", "Clocked out"), className: "bg-red-500" };
	}

	return null;
}

export interface UserAvatarProps {
	/** User's uploaded image URL */
	image?: string | null;
	/** Seed for DiceBear fallback (use user.id for determinism) */
	seed: string;
	/** User's display name for alt text */
	name?: string | null;
	gender?: UserAvatarGender | null;
	/** Predefined size variant */
	size?: UserAvatarSize;
	/** Shape variant */
	shape?: UserAvatarShape;
	/** Additional classes for Avatar root */
	className?: string;
	/** Border styling (for stacked avatars) */
	bordered?: boolean;
	/** Employee clock status indicator */
	clockStatus?: EmployeeClockStatus;
	/** Whether to render a known employee clock status indicator */
	showClockStatus?: boolean;
}

/**
 * Universal user avatar component with DiceBear Lorelei fallback
 *
 * Fallback chain:
 * 1. User-uploaded image (user.image)
 * 2. DiceBear generated avatar (deterministic based on seed/user.id)
 * 3. Loading spinner (shown briefly during image load)
 */
export function UserAvatar({
	image,
	seed,
	name,
	gender,
	size = "sm",
	shape = "circle",
	className,
	bordered = false,
	clockStatus,
	showClockStatus = true,
}: UserAvatarProps) {
	const { t } = useTranslate();
	const [isLoading, setIsLoading] = useState(true);
	const { class: sizeClass, pixels, spinner: spinnerClass, badge: badgeClass } = sizeConfig[size];
	const shapeClass = shapeConfig[shape];
	const clockStatusBadge = showClockStatus ? getClockStatusBadge(clockStatus, t) : null;

	// Generate DiceBear fallback - memoized for performance
	// Using 2x pixels for retina displays
	const dicebearAvatar = useMemo(
		() => generateAvatarDataUri({ seed, size: pixels * 2, gender }),
		[seed, pixels, gender],
	);

	const initials = useMemo(() => getInitials(name), [name]);
	const alt = name || t("common:userAvatar.alt", "User avatar");

	// Use uploaded image if available, otherwise DiceBear
	const primarySrc = image || dicebearAvatar;

	return (
		<span className="relative inline-flex shrink-0">
			<Avatar
				className={cn(sizeClass, shapeClass, bordered && "border-2 border-background", className)}
			>
				<AvatarImage
					src={primarySrc}
					alt={alt}
					onLoad={() => setIsLoading(false)}
					onError={() => setIsLoading(false)}
				/>
				<AvatarFallback className={cn(shapeClass, "bg-muted")}>
					{isLoading ? (
						<IconLoader2 className={cn(spinnerClass, "animate-spin text-muted-foreground")} />
					) : (
						initials
					)}
				</AvatarFallback>
			</Avatar>
			{clockStatusBadge ? (
				<output
					aria-label={clockStatusBadge.label}
					className={cn(
						"absolute right-0 bottom-0 rounded-full border-2 border-background",
						badgeClass,
						clockStatusBadge.className,
					)}
				/>
			) : null}
		</span>
	);
}
