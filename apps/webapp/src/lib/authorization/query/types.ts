import type { SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm/column";

export type AccessiblePredicate = SQL<unknown> | null;

export type DrizzleFieldMap = Record<string, AnyColumn>;
