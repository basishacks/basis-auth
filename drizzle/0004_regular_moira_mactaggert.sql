ALTER TABLE "oidc_clients" ADD COLUMN "filter_mode" text;--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD COLUMN "filter_content" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;