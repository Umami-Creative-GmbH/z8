import type { SVGProps } from "react";
import { AppleIcon, GitHubIcon, GoogleIcon, LinkedInIcon } from "@/components/icons/provider-icons";

/**
 * Social OAuth provider identifiers
 */
export type SocialProviderId = "google" | "github" | "linkedin" | "apple";

/**
 * Social provider configuration
 */
export interface SocialProvider {
	/** Unique provider identifier */
	id: SocialProviderId;
	/** Display name */
	name: string;
	/** Icon component */
	icon: React.ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * List of supported social OAuth providers
 * Icons are from @/components/icons/provider-icons
 */
export const SOCIAL_PROVIDERS: readonly SocialProvider[] = [
	{ id: "google", name: "Google", icon: GoogleIcon },
	{ id: "github", name: "GitHub", icon: GitHubIcon },
	{ id: "linkedin", name: "LinkedIn", icon: LinkedInIcon },
	{ id: "apple", name: "Apple", icon: AppleIcon },
] as const;

/**
 * Get provider configuration by ID
 * @param id Provider identifier
 * @returns Provider configuration or undefined if not found
 */
export function getProviderById(id: string): SocialProvider | undefined {
	return SOCIAL_PROVIDERS.find((provider) => provider.id === id);
}

/**
 * Get provider display name by ID
 * @param id Provider identifier
 * @returns Provider name or the ID if not found
 */
export function getProviderName(id: string): string {
	return getProviderById(id)?.name ?? id;
}
