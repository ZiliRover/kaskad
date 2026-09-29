CREATE TABLE "app_likes" (
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_likes_app_id_user_id_pk" PRIMARY KEY("app_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "listed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "cover" text;--> statement-breakpoint
ALTER TABLE "app_likes" ADD CONSTRAINT "app_likes_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_likes" ADD CONSTRAINT "app_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_likes_app_idx" ON "app_likes" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "apps_listed_idx" ON "apps" USING btree ("listed","created_at");