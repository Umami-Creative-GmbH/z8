CREATE TYPE "sick_detail" AS ENUM ('child_sick', 'with_certificate', 'without_certificate', 'other');

ALTER TABLE "absence_entry" ADD COLUMN "sick_detail" "sick_detail";
