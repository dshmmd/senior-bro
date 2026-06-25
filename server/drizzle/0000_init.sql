CREATE TABLE "calibrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"questions" text NOT NULL,
	"result" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"mode" text DEFAULT 'text' NOT NULL,
	"kind" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"transcript" text DEFAULT '[]' NOT NULL,
	"report" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"token" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"api_key_enc" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"price_in" real DEFAULT 0 NOT NULL,
	"price_out" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"role" text NOT NULL,
	"company" text,
	"skill_pack" text,
	"technologies" text DEFAULT '[]' NOT NULL,
	"years_experience" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"level" text,
	"level_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"model_id" integer,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text,
	"role" text DEFAULT 'user' NOT NULL,
	"provider" text,
	"model" text,
	"api_key_enc" text,
	"model_id" integer,
	"token_quota" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weaknesses" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"fix" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source_interview_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
