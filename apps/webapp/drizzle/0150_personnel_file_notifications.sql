-- Employee notification when an employee document becomes shared (#865).
-- An added enum value is not usable in the transaction that adds it, so
-- nothing else uses it here.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_document_shared';
