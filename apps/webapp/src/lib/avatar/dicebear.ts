import { Avatar } from "@dicebear/core";
import lorelei from "@dicebear/styles/lorelei.json" with { type: "json" };

export type UserAvatarGender = "male" | "female" | "other";

export interface DiceBearAvatarOptions {
	seed: string;
	size?: number;
	gender?: UserAvatarGender | null;
}

function getDiceBearSex(gender: UserAvatarGender | null | undefined): ["male"] | ["female"] | undefined {
	if (gender === "male") return ["male"];
	if (gender === "female") return ["female"];
	return undefined;
}

/**
 * Generate a DiceBear Lorelei avatar as a data URI
 * Uses deterministic seed (user.id recommended) for consistent avatars
 */
export function generateAvatarDataUri({ seed, size = 128, gender }: DiceBearAvatarOptions): string {
	const sex = getDiceBearSex(gender);
	const avatar = new Avatar(lorelei, {
		seed,
		size,
		backgroundColor: ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf"],
		backgroundColorFill: "solid",
		borderRadius: 50, // Circular avatar
		...(sex ? { sex } : {}),
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
