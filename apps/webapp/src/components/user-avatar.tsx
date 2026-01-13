"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { generateAvatarDataUri, getInitials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

const sizeConfig = {
	xs: { class: "size-6", pixels: 24, spinner: "size-3" },
	sm: { class: "size-8", pixels: 32, spinner: "size-3" },
	md: { class: "size-10", pixels: 40, spinner: "size-4" },
	lg: { class: "size-16", pixels: 64, spinner: "size-5" },
	xl: { class: "size-24", pixels: 96, spinner: "size-6" },
} as const;

const shapeConfig = {
	circle: "rounded-full",
	rounded: "rounded-lg",
} as const;

export type UserAvatarSize = keyof typeof sizeConfig;
export type UserAvatarShape = keyof typeof shapeConfig;

export interface UserAvatarProps {
	/** User's uploaded image URL */
	image?: string | null;
	/** Seed for DiceBear fallback (use user.id for determinism) */
	seed: string;
	/** User's display name for alt text */
	name?: string | null;
	/** Predefined size variant */
	size?: UserAvatarSize;
	/** Shape variant */
	shape?: UserAvatarShape;
	/** Additional classes for Avatar root */
	className?: string;
	/** Border styling (for stacked avatars) */
	bordered?: boolean;
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
	size = "sm",
	shape = "circle",
	className,
	bordered = false,
}: UserAvatarProps) {
	const [isLoading, setIsLoading] = useState(true);
	const { class: sizeClass, pixels, spinner: spinnerClass } = sizeConfig[size];
	const shapeClass = shapeConfig[shape];

	// Generate DiceBear fallback - memoized for performance
	// Using 2x pixels for retina displays
	const dicebearAvatar = useMemo(
		() => generateAvatarDataUri({ seed, size: pixels * 2 }),
		[seed, pixels],
	);

	const initials = useMemo(() => getInitials(name), [name]);
	const alt = name || "User avatar";

	// Use uploaded image if available, otherwise DiceBear
	const primarySrc = image || dicebearAvatar;

	return (
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
	);
}
