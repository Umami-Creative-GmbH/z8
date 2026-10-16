CREATE TABLE "organization_vehicle_photo_upload" (
 "id" uuid PRIMARY KEY NOT NULL,
 "organization_id" text NOT NULL,
 "vehicle_id" uuid NOT NULL,
 "uploaded_by" text REFERENCES "user"("id") ON DELETE SET NULL,
 "upload_order" integer NOT NULL,
 "storage_key" text NOT NULL CONSTRAINT "vehicle_photo_upload_storage_unique" UNIQUE,
 "storage_bucket" text,
 "storage_version_id" text,
 "status" text DEFAULT 'pending' NOT NULL CONSTRAINT "vehicle_photo_upload_status_check" CHECK (status IN ('pending','attached','cleanup_required','cleaned')),
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
 "attempts" integer DEFAULT 0 NOT NULL,
 "last_error" text,
 CONSTRAINT "vehicle_photo_upload_identity_unique" UNIQUE (id,vehicle_id,organization_id),
 CONSTRAINT "vehicle_photo_upload_order_unique" UNIQUE (organization_id,vehicle_id,upload_order)
);
--> statement-breakpoint
CREATE INDEX "vehicle_photo_upload_cleanup_idx" ON "organization_vehicle_photo_upload" (status,next_attempt_at);
--> statement-breakpoint
CREATE TABLE "organization_vehicle_photo" (
 "id" uuid PRIMARY KEY NOT NULL,
 "organization_id" text NOT NULL,
 "vehicle_id" uuid NOT NULL,
 "uploaded_by" text REFERENCES "user"("id") ON DELETE SET NULL,
 "upload_order" integer NOT NULL,
 "storage_key" text NOT NULL UNIQUE,
 "storage_bucket" text NOT NULL,
 "storage_version_id" text,
 "width" integer NOT NULL,
 "height" integer NOT NULL,
 "size_bytes" integer NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "vehicle_photo_vehicle_fk" FOREIGN KEY (vehicle_id,organization_id) REFERENCES "organization_vehicle"(id,organization_id) ON DELETE CASCADE,
 CONSTRAINT "vehicle_photo_upload_fk" FOREIGN KEY (id,vehicle_id,organization_id) REFERENCES "organization_vehicle_photo_upload"(id,vehicle_id,organization_id),
 CONSTRAINT "vehicle_photo_order_unique" UNIQUE(organization_id,vehicle_id,upload_order),
 CONSTRAINT "vehicle_photo_dimensions_check" CHECK (width BETWEEN 1 AND 2560 AND height BETWEEN 1 AND 2560 AND size_bytes>0)
);

--> statement-breakpoint
-- The ledger deliberately has no vehicle/organization FK: its cleanup survives
-- cascades. The trigger also covers future individual-photo removal.
CREATE FUNCTION organization_vehicle_photo_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE organization_vehicle_photo_upload SET status='cleanup_required',next_attempt_at=now() WHERE id=OLD.id AND organization_id=OLD.organization_id;
 RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_vehicle_photo_cleanup AFTER DELETE ON organization_vehicle_photo FOR EACH ROW EXECUTE FUNCTION organization_vehicle_photo_cleanup();
