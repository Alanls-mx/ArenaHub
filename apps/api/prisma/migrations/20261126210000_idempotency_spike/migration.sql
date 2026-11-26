CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "key" UUID NOT NULL,
  "method" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "path_params" JSONB NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_status" INTEGER NOT NULL,
  "response_body" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "idempotency_response_status_check" CHECK ("response_status" BETWEEN 200 AND 499),
  CONSTRAINT "idempotency_expiry_check" CHECK ("expires_at" > "created_at")
);
CREATE UNIQUE INDEX "idempotency_records_organization_id_user_id_key_key"
  ON "idempotency_records"("organization_id", "user_id", "key");
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");
