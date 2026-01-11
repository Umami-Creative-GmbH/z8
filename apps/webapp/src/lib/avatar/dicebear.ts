import { lorelei } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";

export interface DiceBearAvatarOptions {
	seed: string;
	size?: number;
}

/**
 * Generate a DiceBear Lorelei avatar as a data URI
 * Uses deterministic seed (user.id recommended) for consistent avatars
 */
export function generateAvatarDataUri({ seed, size = 128 }: DiceBearAvatarOptions): string {
	const avatar = createAvatar(lorelei, {
		seed,
		size,
		backgroundColor: ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf"],
		backgroundType: ["solid"],
		radius: 50, // Circular avatar
	});

	return avatar.toDataUri();
}

/**
 * Extract initials from a name for accessibility/alt text
 * Returns up to 2 characters
 */
export function getInitials(name: string | null | undefined): string {
	if (!name) return "?";
	return name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}
