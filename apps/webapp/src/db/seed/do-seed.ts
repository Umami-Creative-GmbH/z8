#!/usr/bin/env bun
/**
 * Database Seeding CLI
 *
 * Usage:
 *   bun run db:seed              # Run all seeders
 *   bun run db:seed --list       # List available seeders
 *   bun run db:seed --only=name  # Run specific seeder by name
 *   bun run db:seed --help       # Show help
 *
 * Production usage:
 *   bun --bun run src/db/seed/do-seed.ts
 *
 * Environment:
 *   Requires POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
 *   (via .env or environment)
 */

// Load environment variables first
import "dotenv/config";

import { seeders } from "./index";

const COLORS = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
	blue: "\x1b[34m",
};

function log(message: string, color: keyof typeof COLORS = "reset") {
	console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function printHelp() {
	log("\n📦 Database Seeding CLI", "bright");
	log("─".repeat(50), "dim");
	log("\nUsage:", "cyan");
	log("  bun run db:seed              Run all seeders");
	log("  bun run db:seed --list       List available seeders");
	log("  bun run db:seed --only=name  Run specific seeder by name");
	log("  bun run db:seed --help       Show this help");
	log("\nAvailable seeders:", "cyan");
	for (const seeder of seeders) {
		log(`  ${seeder.name}`, "green");
		log(`    ${seeder.description}`, "dim");
	}
	log("\nEnvironment:", "cyan");
	log("  POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD");
	log("  (via .env or environment)\n");
}

function printList() {
	log("\n📋 Available Seeders", "bright");
	log("─".repeat(50), "dim");
	for (const seeder of seeders) {
		log(`\n  ${seeder.name}`, "green");
		log(`  ${seeder.description}`, "dim");
	}
	log("");
}

async function runSeeder(seeder: (typeof seeders)[number]) {
	const startTime = Date.now();
	log(`\n▶ Running: ${seeder.name}`, "cyan");
	log(`  ${seeder.description}`, "dim");

	try {
		await seeder.run();
		const duration = Date.now() - startTime;
		log(`✓ Completed: ${seeder.name} (${duration}ms)`, "green");
		return { success: true, name: seeder.name, duration };
	} catch (error) {
		const duration = Date.now() - startTime;
		log(`✗ Failed: ${seeder.name} (${duration}ms)`, "red");
		console.error(error);
		return { success: false, name: seeder.name, duration, error };
	}
}

async function main() {
	const args = process.argv.slice(2);

	// Check for help flag
	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(0);
	}

	// Check for list flag
	if (args.includes("--list") || args.includes("-l")) {
		printList();
		process.exit(0);
	}

	// Check for required database environment variables
	const requiredEnvVars = ["POSTGRES_HOST", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"];
	const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

	if (missingVars.length > 0) {
		log("\n❌ Error: Missing required environment variables:", "red");
		for (const v of missingVars) {
			log(`   - ${v}`, "dim");
		}
		log("\n   Make sure your .env file exists and contains these variables\n", "dim");
		process.exit(1);
	}

	// Check for --only flag
	const onlyArg = args.find((arg) => arg.startsWith("--only="));
	const onlyName = onlyArg?.split("=")[1];

	let seedersToRun = seeders;

	if (onlyName) {
		const seeder = seeders.find((s) => s.name === onlyName);
		if (!seeder) {
			log(`\n❌ Error: Seeder "${onlyName}" not found`, "red");
			log("\nAvailable seeders:", "cyan");
			for (const s of seeders) {
				log(`  - ${s.name}`, "dim");
			}
			log("");
			process.exit(1);
		}
		seedersToRun = [seeder];
	}

	// Run seeders
	log("\n🌱 Database Seeding", "bright");
	log("─".repeat(50), "dim");
	log(`Database: ${process.env.POSTGRES_DB}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT || 5432}`, "dim");
	log(`Seeders to run: ${seedersToRun.length}`, "dim");

	const results: Array<{ success: boolean; name: string; duration: number; error?: unknown }> = [];
	const totalStartTime = Date.now();

	for (const seeder of seedersToRun) {
		const result = await runSeeder(seeder);
		results.push(result);

		// Stop on first failure
		if (!result.success) {
			break;
		}
	}

	const totalDuration = Date.now() - totalStartTime;
	const successful = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	// Summary
	log("\n" + "─".repeat(50), "dim");
	log("📊 Summary", "bright");
	log(`   Total: ${results.length} seeder(s)`, "dim");
	log(`   ✓ Successful: ${successful}`, successful > 0 ? "green" : "dim");
	if (failed > 0) {
		log(`   ✗ Failed: ${failed}`, "red");
	}
	log(`   ⏱ Duration: ${totalDuration}ms`, "dim");
	log("");

	process.exit(failed > 0 ? 1 : 0);
}

// Run main function
main().catch((error) => {
	log("\n❌ Unexpected error during seeding:", "red");
	console.error(error);
	process.exit(1);
});
