CREATE TABLE "company_packs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"company" text NOT NULL,
	"roles" text DEFAULT '[]' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"source" text DEFAULT 'generated' NOT NULL,
	"model" text,
	"searched" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_packs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "company_packs" ADD CONSTRAINT "company_packs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_packs_status_idx" ON "company_packs" USING btree ("status");