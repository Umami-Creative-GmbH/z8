"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { currentReportOwner as currentOwner } from "@/lib/travel-expenses/current-owner";
import type { ItemProjectChoice } from "@/lib/travel-expenses/project-attribution";
import {
	listReportProjectChoices,
	listReportProjectIssues,
	type ProjectChoiceOption,
	type ProjectChoiceRefusal,
	saveItemProjectDraft,
	saveTripProjectDraft,
} from "@/lib/travel-expenses/project-attribution-store";
import type { ReportOwner } from "@/lib/travel-expenses/report-store";

/**
 * Project attribution of the employee's own draft expenses (#605). The
 * picker and the saves share one expense-date eligibility rule; the server
 * decides eligibility, the client only names the project.
 */

const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export interface ProjectChoicesView {
	/** Zone whose calendar days the dates are. */
	timeZone: string;
	choices: ProjectChoiceOption[];
	selected: { id: string; name: string; eligible: boolean } | null;
}

const choicesSchema = z.object({
	reportId: z.uuid(),
	from: plainDate,
	to: plainDate,
	selectedProjectId: z.uuid().nullable(),
});

/** Projects the employee may choose for an expense date (`from` = `to`) or the trip's dates. */
export async function getReportProjectChoicesAction(
	input: z.input<typeof choicesSchema>,
): Promise<ServerActionResult<ProjectChoicesView>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsed = choicesSchema.safeParse(input);
		if (!parsed.success || parsed.data.to < parsed.data.from) {
			return { success: false, error: "Invalid dates" };
		}
		const result = await listReportProjectChoices(db, owner, parsed.data);
		if (result.kind === "not_found") return { success: false, error: "Expense report not found" };
		const { kind: _kind, ...view } = result;
		return { success: true, data: view };
	} catch (error) {
		logger.error({ error }, "Failed to load expense project choices");
		return { success: false, error: "Failed to load projects" };
	}
}

/**
 * Dated expenses of the employee's draft whose project (own or inherited from
 * the trip) is not proven on their own date: submission would refuse them.
 */
export async function getReportProjectIssuesAction(input: {
	reportId: string;
}): Promise<ServerActionResult<{ ineligibleItemIds: string[] }>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsed = z.object({ reportId: z.uuid() }).safeParse(input);
		if (!parsed.success) return { success: false, error: "Expense report not found" };
		const result = await listReportProjectIssues(db, owner, parsed.data.reportId);
		if (result.kind === "not_found") return { success: false, error: "Expense report not found" };
		return { success: true, data: { ineligibleItemIds: result.itemIds } };
	} catch (error) {
		logger.error({ error }, "Failed to check expense projects");
		return { success: false, error: "Failed to check projects" };
	}
}

export type SaveProjectOutcome =
	| { status: "saved"; version: number }
	/** A newer version exists; nothing was written. */
	| { status: "conflict"; version: number }
	| { status: "refused"; reason: ProjectChoiceRefusal };

const choiceSchema = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("inherit") }),
	z.object({ mode: z.literal("none") }),
	z.object({ mode: z.literal("project"), projectId: z.uuid() }),
]);

const itemSchema = z.object({
	reportId: z.uuid(),
	itemId: z.uuid(),
	expectedVersion: z.number().int().positive(),
	choice: choiceSchema,
});

export async function saveItemProjectAction(input: {
	reportId: string;
	itemId: string;
	expectedVersion: number;
	choice: ItemProjectChoice;
}): Promise<ServerActionResult<SaveProjectOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsed = itemSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid project choice" };
		const result = await saveItemProjectDraft(db, owner, parsed.data);
		switch (result.kind) {
			case "saved":
				revalidatePath("/travel-expenses");
				return { success: true, data: { status: "saved", version: result.version } };
			case "conflict":
				return { success: true, data: { status: "conflict", version: result.version } };
			case "refused":
				return { success: true, data: { status: "refused", reason: result.reason } };
			case "not_found":
				return { success: false, error: "Expense not found" };
			case "not_draft":
				return { success: false, error: "This expense can no longer be edited" };
		}
	} catch (error) {
		logger.error({ error }, "Failed to save expense project");
		return { success: false, error: "Failed to save the project" };
	}
}

const tripSchema = z.object({
	reportId: z.uuid(),
	expectedVersion: z.number().int().positive(),
	projectId: z.uuid().nullable(),
});

export async function saveTripProjectAction(input: {
	reportId: string;
	expectedVersion: number;
	projectId: string | null;
}): Promise<ServerActionResult<SaveProjectOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const parsed = tripSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid project choice" };
		const result = await saveTripProjectDraft(db, owner, parsed.data);
		switch (result.kind) {
			case "saved":
				revalidatePath("/travel-expenses");
				return { success: true, data: { status: "saved", version: result.version } };
			case "conflict":
				return { success: true, data: { status: "conflict", version: result.version } };
			case "refused":
				return { success: true, data: { status: "refused", reason: result.reason } };
			case "not_found":
				return { success: false, error: "Trip not found" };
			case "not_draft":
				return { success: false, error: "This trip can no longer be edited" };
		}
	} catch (error) {
		logger.error({ error }, "Failed to save trip project");
		return { success: false, error: "Failed to save the project" };
	}
}
