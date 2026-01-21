/**
 * Seed Registry
 *
 * Register all seed functions here. They will be executed in order.
 * Each seeder should be idempotent (safe to run multiple times).
 */

import { seedWorkPolicyPresets } from "./work-policy-presets";

export interface Seeder {
	name: string;
	description: string;
	run: () => Promise<void>;
}

/**
 * All registered seeders - executed in order
 */
export const seeders: Seeder[] = [
	{
		name: "work-policy-presets",
		description: "Seed labor law presets (DE, EU, FR, GB, CH, AT)",
		run: seedWorkPolicyPresets,
	},
];
