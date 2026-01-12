/**
 * Seed Registry
 *
 * Register all seed functions here. They will be executed in order.
 * Each seeder should be idempotent (safe to run multiple times).
 */

import { seedTimeRegulationPresets } from "./time-regulation-presets";

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
		name: "time-regulation-presets",
		description: "Seed time regulation presets (German, EU, French, UK, Swiss, Austrian labor laws)",
		run: seedTimeRegulationPresets,
	},
	// Add future seeders here:
	// {
	//   name: "example-seeder",
	//   description: "Description of what this seeder does",
	//   run: seedExampleData,
	// },
];
