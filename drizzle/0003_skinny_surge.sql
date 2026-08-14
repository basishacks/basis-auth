ALTER TABLE "users" ADD COLUMN "provider" text NOT NULL DEFAULT 'basischina-microsoft';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
DROP INDEX "users_upstream_identity_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "users_upstream_identity_unique" ON "users" USING btree ("provider","upstream_issuer","upstream_subject");
