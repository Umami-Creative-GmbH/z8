import type { AnyColumn } from "drizzle-orm/column";
import type { SQL } from "drizzle-orm";

export type AccessiblePredicate = SQL<unknown> | null;

export type DrizzleFieldMap = Record<string, AnyColumn>;
