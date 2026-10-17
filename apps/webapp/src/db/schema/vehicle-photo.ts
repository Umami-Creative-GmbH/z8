import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";
import { organizationVehicle } from "./vehicle";

/** The durable object ledger outlives vehicle deletion and failed/abandoned uploads. */
export const organizationVehiclePhotoUpload = pgTable(
	"organization_vehicle_photo_upload",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		vehicleId: uuid("vehicle_id").notNull(),
		uploadedBy: text("uploaded_by").references(() => user.id, {
			onDelete: "set null",
		}),
		uploadOrder: integer("upload_order").notNull(),
		storageKey: text("storage_key").notNull(),
		storageBucket: text("storage_bucket"),
		storageVersionId: text("storage_version_id"),
		status: text("status")
			.$type<"pending" | "attached" | "cleanup_required" | "cleaned">()
			.notNull()
			.default("pending"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		attempts: integer("attempts").notNull().default(0),
		lastError: text("last_error"),
	},
	(t) => [
		unique("vehicle_photo_upload_storage_unique").on(t.storageKey),
		unique("vehicle_photo_upload_identity_unique").on(
			t.id,
			t.vehicleId,
			t.organizationId,
		),
		unique("vehicle_photo_upload_order_unique").on(
			t.organizationId,
			t.vehicleId,
			t.uploadOrder,
		),
		index("vehicle_photo_upload_cleanup_idx").on(t.status, t.nextAttemptAt),
		check(
			"vehicle_photo_upload_status_check",
			sql`${t.status} in ('pending','attached','cleanup_required','cleaned')`,
		),
	],
);

export const organizationVehiclePhoto = pgTable(
	"organization_vehicle_photo",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		vehicleId: uuid("vehicle_id").notNull(),
		uploadedBy: text("uploaded_by").references(() => user.id, {
			onDelete: "set null",
		}),
		uploadOrder: integer("upload_order").notNull(),
		storageKey: text("storage_key").notNull(),
		storageBucket: text("storage_bucket").notNull(),
		storageVersionId: text("storage_version_id"),
		width: integer("width").notNull(),
		height: integer("height").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		foreignKey({
			name: "vehicle_photo_vehicle_fk",
			columns: [t.vehicleId, t.organizationId],
			foreignColumns: [
				organizationVehicle.id,
				organizationVehicle.organizationId,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "vehicle_photo_upload_fk",
			columns: [t.id, t.vehicleId, t.organizationId],
			foreignColumns: [
				organizationVehiclePhotoUpload.id,
				organizationVehiclePhotoUpload.vehicleId,
				organizationVehiclePhotoUpload.organizationId,
			],
		}),
		unique("vehicle_photo_order_unique").on(
			t.organizationId,
			t.vehicleId,
			t.uploadOrder,
		),
		unique("vehicle_photo_storage_unique").on(t.storageKey),
		check(
			"vehicle_photo_dimensions_check",
			sql`${t.width} between 1 and 2560 and ${t.height} between 1 and 2560 and ${t.sizeBytes}>0`,
		),
	],
);
