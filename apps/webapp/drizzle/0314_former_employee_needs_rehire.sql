-- #1672 (spec #1664): a former employee whose departure took effect regained a
-- membership but stays off the current roster until a rehire; whoever brought
-- them in (the inviter, or the organization's admins) is told.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'former_employee_needs_rehire';
