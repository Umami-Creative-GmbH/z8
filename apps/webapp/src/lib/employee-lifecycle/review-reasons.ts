/**
 * Review reason for a later approval stage routed only to the departed person
 * when the departure has no replacement. A replacement assigned on such a
 * review is what stage activation uses when the stage starts. Client-safe.
 */
export const FUTURE_STAGE_REVIEW_REASON = "future_stage_without_replacement";
