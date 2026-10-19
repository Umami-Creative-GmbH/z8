/**
 * Project and work category at an online kiosk clock-out (#887): what the
 * employee chose for each field, as the step's form holds it, and the request
 * fields it sends. Client-safe.
 */
import type {
	KioskAttribution,
	KioskAttributionField,
	KioskAttributionOption,
	KioskAttributionValue,
} from "@/lib/time-tracking/kiosk/protocol";
import type { KioskPanelAction } from "./kiosk-employee-panel";

/** Keeps the work's attribution: the default, sent as nothing. */
export const KEEP_CURRENT_CHOICE = "keep";
/** Clears the work's attribution, sent as `null`. */
export const NO_ATTRIBUTION_CHOICE = "none";

/** One field's choice: keep the current one, none, or an offered ID that replaces it. */
export type KioskAttributionChoice =
	| typeof KEEP_CURRENT_CHOICE
	| typeof NO_ATTRIBUTION_CHOICE
	| (string & {});

export type KioskAttributionValues = {
	project: KioskAttributionChoice;
	workCategory: KioskAttributionChoice;
};

export const KEEP_ATTRIBUTION: KioskAttributionValues = {
	project: KEEP_CURRENT_CHOICE,
	workCategory: KEEP_CURRENT_CHOICE,
};

/** The step's answer, with the choices it was asked from. */
export type AttributionAnswer = { ask: KioskAttribution; values: KioskAttributionValues };

/** What an action asks first (#887): only an online clock-out of live work with something to decide. */
export function attributionAskOf(
	action: KioskPanelAction,
	attribution: KioskAttribution | undefined,
): KioskAttribution | null {
	if (action !== "clock_out" || !attribution) return null;
	return attribution.project || attribution.workCategory ? attribution : null;
}

function requestValueOf(choice: KioskAttributionChoice): KioskAttributionValue | undefined {
	if (choice === KEEP_CURRENT_CHOICE) return undefined;
	return choice === NO_ATTRIBUTION_CHOICE ? null : choice;
}

/** The clock-out's fields for the choices (`KioskAttributionValue`): a kept field is left out. */
export function kioskAttributionRequest(
	values: KioskAttributionValues,
): Partial<Record<keyof KioskAttributionValues, KioskAttributionValue>> {
	const project = requestValueOf(values.project);
	const workCategory = requestValueOf(values.workCategory);
	return {
		...(project !== undefined ? { project } : {}),
		...(workCategory !== undefined ? { workCategory } : {}),
	};
}

/**
 * One field's choices in the order the kiosk shows them: keep the current one
 * (`keeps` names it), the other offered ones, then none (no option). Without a
 * current one, keeping is the same as none and is shown as none.
 */
export function attributionChoicesOf(field: KioskAttributionField): {
	value: KioskAttributionChoice;
	option: KioskAttributionOption | null;
	keeps: boolean;
}[] {
	const { current } = field;
	const others = field.options
		.filter((option) => option.id !== current?.id)
		.map((option) => ({ value: option.id, option, keeps: false }));
	return current
		? [
				{ value: KEEP_CURRENT_CHOICE, option: current, keeps: true },
				...others,
				{ value: NO_ATTRIBUTION_CHOICE, option: null, keeps: false },
			]
		: [...others, { value: KEEP_CURRENT_CHOICE, option: null, keeps: false }];
}
