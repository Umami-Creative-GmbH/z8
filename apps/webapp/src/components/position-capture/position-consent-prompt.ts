/**
 * The consent question on a clock action (#826): a clock action asks, the one
 * mounted dialog host shows the current position notice, and the answer
 * resolves the clock action's wait. With no host mounted the question is
 * answered "dismissed" at once, so a clock action never waits for a dialog that
 * cannot appear.
 */
export type PositionConsentAnswer = "agreed" | "declined" | "dismissed";

export type PositionConsentQuestion = {
	notice: { id: string; version: number; purposeStatement: string };
	/** The retention that applies now; never longer than the notice's own. */
	retentionDays: number;
};

type Pending = {
	question: PositionConsentQuestion;
	answered: Promise<PositionConsentAnswer>;
	resolve: (answer: PositionConsentAnswer) => void;
};

let pending: Pending | null = null;
let hosts = 0;
const listeners = new Set<() => void>();

function notify() {
	for (const listener of listeners) listener();
}

/** Shows the notice and waits for the answer; one question at a time. */
export function askForPositionConsent(
	question: PositionConsentQuestion,
): Promise<PositionConsentAnswer> {
	if (hosts === 0) return Promise.resolve("dismissed");
	if (pending) return pending.answered;
	let resolve: (answer: PositionConsentAnswer) => void = () => {};
	const answered = new Promise<PositionConsentAnswer>((done) => {
		resolve = done;
	});
	pending = { question, answered, resolve };
	notify();
	return answered;
}

/** The host's answer to the open question. */
export function answerPositionConsent(answer: PositionConsentAnswer) {
	const current = pending;
	if (!current) return;
	pending = null;
	notify();
	current.resolve(answer);
}

export function currentPositionConsentQuestion(): PositionConsentQuestion | null {
	return pending?.question ?? null;
}

export function subscribePositionConsentQuestion(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Registers a mounted dialog host; the returned function unregisters it. */
export function registerPositionConsentHost() {
	hosts += 1;
	return () => {
		hosts -= 1;
		// A host that leaves never strands a clock action.
		if (hosts === 0) answerPositionConsent("dismissed");
	};
}
