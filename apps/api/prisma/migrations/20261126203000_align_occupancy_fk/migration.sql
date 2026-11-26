ALTER TABLE "schedule_occupancies"
  DROP CONSTRAINT "schedule_occupancies_unit_fk";

ALTER TABLE "schedule_occupancies"
  ADD CONSTRAINT "schedule_occupancies_organization_id_unit_id_fkey"
  FOREIGN KEY ("organization_id", "unit_id")
  REFERENCES "schedule_units" ("organization_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
