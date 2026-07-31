"use server";

import {
	editSameDayTimeEntry as editSameDayTimeEntryInternal,
	requestTimeCorrectionEffect as requestTimeCorrectionEffectInternal,
	requestTimeEntryDeletion as requestTimeEntryDeletionInternal,
} from "@/lib/approvals/server/time-correction-submission";
import type {
	CorrectionRequest,
	SameDayEditRequest,
	TimeEntryDeletionRequest,
} from "./types";

export async function editSameDayTimeEntry(data: SameDayEditRequest) {
	return editSameDayTimeEntryInternal(data);
}

export async function requestTimeCorrectionEffect(data: CorrectionRequest) {
	return requestTimeCorrectionEffectInternal(data);
}

export async function requestTimeEntryDeletion(data: TimeEntryDeletionRequest) {
	return requestTimeEntryDeletionInternal(data);
}

export const requestTimeCorrection = requestTimeCorrectionEffect;
