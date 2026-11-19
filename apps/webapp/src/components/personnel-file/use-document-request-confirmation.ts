"use client";

import { useLayoutEffect, useRef } from "react";
import type { DocumentRequestView } from "@/lib/personnel-file/document-request.types";

interface DocumentRequestSubmission {
	arrival: symbol;
	requestId: string;
	expectedVersion: number;
}

export const documentRequestSubmissionMeta: {
	submission: DocumentRequestSubmission | null;
} = { submission: null };

/** Client task lifetime only. The action still resolves live authority and locks its version. */
export function useDocumentRequestConfirmation(
	request: Pick<DocumentRequestView, "id" | "version"> | null,
	open: boolean,
) {
	const arrival = useRef<symbol | null>(null);
	const pending = useRef<DocumentRequestSubmission | null>(null);
	const requestId = request?.id;
	const version = request?.version;
	useLayoutEffect(() => {
		arrival.current =
			open && requestId && version !== undefined ? Symbol("request confirmation") : null;
		pending.current = null;
		return () => {
			arrival.current = null;
			pending.current = null;
		};
	}, [open, requestId, version]);

	function reserve() {
		if (!open || !request || !arrival.current || pending.current) return null;
		const submission = {
			arrival: arrival.current,
			requestId: request.id,
			expectedVersion: request.version,
		};
		pending.current = submission;
		return submission;
	}

	function isCurrent(submission: DocumentRequestSubmission) {
		return pending.current === submission && arrival.current === submission.arrival;
	}

	function release(submission: DocumentRequestSubmission) {
		if (pending.current === submission) pending.current = null;
	}

	return { reserve, isCurrent, release, isPending: () => pending.current !== null };
}
