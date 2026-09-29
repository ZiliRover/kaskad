CREATE TABLE "graph_invites" (
	"graph_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_invites_graph_id_email_pk" PRIMARY KEY("graph_id","email")
);
--> statement-breakpoint
CREATE TABLE "graph_members" (
	"graph_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_members_graph_id_user_id_pk" PRIMARY KEY("graph_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "graph_invites" ADD CONSTRAINT "graph_invites_graph_id_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_members" ADD CONSTRAINT "graph_members_graph_id_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_members" ADD CONSTRAINT "graph_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "graph_invites_email_idx" ON "graph_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "graph_members_user_idx" ON "graph_members" USING btree ("user_id");