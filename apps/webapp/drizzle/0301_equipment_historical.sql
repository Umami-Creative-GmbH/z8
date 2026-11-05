ALTER TABLE "equipment_handover" ADD COLUMN "historical" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "equipment_handover" ALTER COLUMN "actual_date" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "equipment_handover" ADD CONSTRAINT "equipment_handover_actual_date_check" CHECK ("actual_date" IS NOT NULL OR ("historical" AND "kind" = 'issue'));
--> statement-breakpoint
ALTER TABLE "equipment_handover" ADD CONSTRAINT "equipment_handover_historical_check" CHECK (NOT "historical" OR "kind" = 'issue');
