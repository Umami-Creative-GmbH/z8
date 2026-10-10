import { z } from "zod";

/** Shared field schemas of the Public API responses (#763). */

/** A record id. Response-only, so it is documented, not re-validated. */
export const idSchema = () => z.string().meta({ format: "uuid" });

/** A local calendar date: never converted to or from an instant. */
export const localDateSchema = () => z.iso.date().describe("A local calendar date, YYYY-MM-DD.");

/** A UTC instant, ISO 8601 with `Z`. */
export const instantSchema = () =>
	z.iso.datetime().describe("A UTC instant, ISO 8601 with `Z`, such as 2026-10-01T06:00:00.000Z.");
