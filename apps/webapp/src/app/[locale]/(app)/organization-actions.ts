"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { auth } from "@/lib/auth";

async function isSlugTaken(slug: string): Promise<boolean> {
	const existingOrg = await db.query.organization.findFirst({
		where: eq(organization.slug, slug),
	});
	return !!existingOrg;
}

/**
 * Check if an organization slug is available (not already taken)
 */
export async function checkSlugAvailability(slug: string): Promise<boolean> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		throw new Error("Unauthorized");
	}

	return !(await isSlugTaken(slug));
}

/**
 * Generate a unique slug based on a name
 * If the base slug is taken, appends numbers until unique
 */
export async function generateUniqueSlug(baseName: string): Promise<string> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		throw new Error("Unauthorized");
	}

	const baseSlug = baseName
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	let slug = baseSlug;
	let counter = 2;

	while (await isSlugTaken(slug)) {
		slug = `${baseSlug}-${counter}`;
		counter++;
	}

	return slug;
}
