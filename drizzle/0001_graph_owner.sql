ALTER TABLE "graphs" ADD COLUMN "owner_id" text;--> statement-breakpoint
CREATE INDEX "graphs_owner_idx" ON "graphs" USING btree ("owner_id","updated_at");