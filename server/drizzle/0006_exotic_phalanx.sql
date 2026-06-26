CREATE TABLE "skill_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"skill" text NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"evidence" text,
	"source_interview_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_claims" ADD CONSTRAINT "skill_claims_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_claims" ADD CONSTRAINT "skill_claims_source_interview_id_interviews_id_fk" FOREIGN KEY ("source_interview_id") REFERENCES "public"."interviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_claims_profile_skill_idx" ON "skill_claims" USING btree ("profile_id","skill");