-- #277: bot clock-out receipts. Additive and inactive: bots write receipts only for
-- organizations whose append control is active, like web clock-out (#274).
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_writer_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("completed_work_operation"."writer" IN ('web_clock_out', 'direct_http', 'bot_clock_out'));
