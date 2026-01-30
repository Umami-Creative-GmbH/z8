import { cache } from "react";
import { getAuthContext, getOnboardingStatus, getUserOrganizations } from "./auth-helpers";

/**
 * Request-scoped caching for frequently used queries.
 * React.cache() deduplicates calls within a single request,
 * ensuring each query runs only once regardless of how many
 * components call it.
 *
 * Usage: Replace direct calls with cached versions in server components.
 * Example: const ctx = await getCachedAuthContext();
 */

// Auth context - used by many components to check permissions
export const getCachedAuthContext = cache(getAuthContext);

// Onboarding status - used for redirect checks
export const getCachedOnboardingStatus = cache(getOnboardingStatus);

// User organizations - used in org switcher and layout
export const getCachedUserOrganizations = cache(getUserOrganizations);
