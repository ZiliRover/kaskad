ALTER TABLE "payments" ADD COLUMN "inv_id" bigserial NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_inv_id_uq" ON "payments" USING btree ("inv_id");