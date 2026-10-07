/**
 * Reference rate providers and acknowledgements (#608). Kept free of imports:
 * the database schema references these, and every runtime image that loads
 * the schema would otherwise need the reference-rate logic's dependencies.
 * `reference-rate.ts` re-exports them.
 */

export const REFERENCE_RATE_PROVIDERS = ["ecb"] as const;
export type ReferenceRateProvider = (typeof REFERENCE_RATE_PROVIDERS)[number];

/**
 * Versioned statements an administrator acknowledges when approving a source
 * (0133). `ecb_information_only_v1`: the ECB publishes its euro reference
 * rates for information only, for a limited set of currencies and only on
 * TARGET working days, and the organization chooses to reimburse with them.
 * Changing the wording shown means adding a new version, never editing one.
 */
export const REFERENCE_RATE_ACKNOWLEDGEMENTS = ["ecb_information_only_v1"] as const;
export type ReferenceRateAcknowledgement = (typeof REFERENCE_RATE_ACKNOWLEDGEMENTS)[number];
