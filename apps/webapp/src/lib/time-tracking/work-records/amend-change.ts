/**
 * The amend change of work records (ADR 0010, #1225): new times and a work
 * attribution patch for one completed work period, applied to the work period
 * and its canonical work record together. Types only, no I/O and no
 * server-only imports.
 *
 * Later slices extend it here: #1226 adopts endpoints that already exist as
 * recorded time entries (a second `AmendedEndpoint` variant), #1227 adds the
 * approval state to the same change.
 */
import type { TimeEntryAppendOperation } from "@/db/schema/time-entry-append";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { TimeEntryTimezoneCapture } from "../timezone-capture";
import type { NewEntryProvenance, WorkRecordExpected } from "./change";
import type { WorkAttributionPart, WorkAttributionPatch } from "./work-attribution";

/** A new endpoint: a correction entry at the instant, captured in the zone it was resolved in. */
export type AmendedEndpoint = {
	at: Instant;
	capture: TimeEntryTimezoneCapture;
};

/**
 * New times. Each named endpoint is appended as a correction entry that
 * replaces the current one; an endpoint left out, or named at its current
 * instant, stays.
 */
export type AmendedTimes = {
	clockIn?: AmendedEndpoint;
	clockOut?: AmendedEndpoint;
	/** The notes every correction entry carries. */
	notes: string | null;
	/** Who and what records the correction entries; each endpoint has its own capture. */
	entries: Omit<NewEntryProvenance, "capture">;
	/** The append position's record of the operation that appended the corrections. */
	appendOperation: TimeEntryAppendOperation;
};

/**
 * A work attribution patch as callers name it. The project is named by its id
 * only: work records reads the project and applies its billable default when
 * the project changes and `billable` is left out (#900). Every other key
 * follows `WorkAttributionPatch`: left out keeps, null clears, and a task left
 * out follows the project (#873).
 */
export type AmendAttributionPatch = Omit<WorkAttributionPatch, "project"> & {
	project?: string | null;
};

/**
 * Amend completed work: change its times, its work attribution or both, in
 * one revision step with one send-back. Callers keep their own policy (change
 * policy, eligibility, review guard, a range rule for the new times) and name
 * only what changes. A change of nothing is refused as `unchanged`.
 */
export type AmendWorkRecord = {
	kind: "amend";
	organizationId: string;
	employeeId: string;
	expected: WorkRecordExpected;
	times?: AmendedTimes;
	attribution?: AmendAttributionPatch;
	/** The user making the change; null for a job or the system. */
	actorUserId: string | null;
};

/** What an amendment changed. */
export type AmendmentChanges = {
	clockIn: boolean;
	clockOut: boolean;
	/** The parts of the work attribution that changed, in `WorkAttribution` order. */
	attribution: WorkAttributionPart[];
};
