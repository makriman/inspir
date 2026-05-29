CREATE TABLE "app_translations" (
	"namespace" text NOT NULL,
	"language" text NOT NULL,
	"source_hash" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_translations_namespace_language_pk" PRIMARY KEY("namespace","language")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "date_of_birth_source" text;--> statement-breakpoint
CREATE INDEX "app_translations_language_idx" ON "app_translations" USING btree ("language");