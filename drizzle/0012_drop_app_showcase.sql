ALTER TABLE "app_likes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "app_likes" CASCADE;--> statement-breakpoint
DROP INDEX "apps_listed_idx";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "listed";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "cover";