CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"token_credit" integer NOT NULL,
	"note" text,
	"revoked" boolean DEFAULT false NOT NULL,
	"redeemed_by" integer,
	"redeemed_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free-intro' NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;