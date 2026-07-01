CREATE TABLE "feature_models" (
	"feature_key" text PRIMARY KEY NOT NULL,
	"model_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_models" ADD CONSTRAINT "feature_models_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;