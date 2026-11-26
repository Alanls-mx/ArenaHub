CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateTable
CREATE TABLE "schedule_units" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "schedule_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_occupancies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "period" tstzrange GENERATED ALWAYS AS (tstzrange("start_at", "end_at", '[)')) STORED,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "schedule_occupancies_valid_interval" CHECK ("end_at" > "start_at"),
    CONSTRAINT "schedule_occupancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schedule_units_organization_id_id_key" ON "schedule_units"("organization_id", "id");

-- CreateIndex
CREATE INDEX "schedule_occupancies_organization_id_start_at_idx" ON "schedule_occupancies"("organization_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_occupancies_organization_id_id_key" ON "schedule_occupancies"("organization_id", "id");

ALTER TABLE "schedule_occupancies"
  ADD CONSTRAINT "schedule_occupancies_unit_fk"
  FOREIGN KEY ("organization_id", "unit_id")
  REFERENCES "schedule_units" ("organization_id", "id");

ALTER TABLE "schedule_occupancies"
  ADD CONSTRAINT "schedule_no_overlap"
  EXCLUDE USING gist ("unit_id" WITH =, "period" WITH &&) WHERE ("active");
