-- Officer notification when an employee uploads a document into their own
-- personnel file (#867). An added enum value is not usable in the transaction
-- that adds it, so nothing else uses it here.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_employee_upload';
