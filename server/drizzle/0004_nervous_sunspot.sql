CREATE TABLE "prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_key" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"author" text DEFAULT 'seed' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "prompts_key_idx" ON "prompts" USING btree ("prompt_key");