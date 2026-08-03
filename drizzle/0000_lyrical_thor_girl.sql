CREATE TABLE "auth_sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorization_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"user_id" uuid NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text NOT NULL,
	"nonce" text NOT NULL,
	"code_challenge" text NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "authorization_consents" (
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"resources" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authorization_consents_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "authorization_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"interaction_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"code_challenge" text NOT NULL,
	"user_id" uuid,
	"authenticated_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"metadata" jsonb NOT NULL,
	"secret_hash" text,
	"resources" jsonb NOT NULL,
	"require_consent" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resource_servers" (
	"audience" text PRIMARY KEY NOT NULL,
	"scopes" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upstream_auth_requests" (
	"state" text PRIMARY KEY NOT NULL,
	"authorization_request_id" uuid NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permissions_user_id_permission_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upstream_issuer" text NOT NULL,
	"upstream_subject" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"picture" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_request_id_authorization_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."authorization_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_client_id_oidc_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oidc_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_consents" ADD CONSTRAINT "authorization_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_consents" ADD CONSTRAINT "authorization_consents_client_id_oidc_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oidc_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_requests" ADD CONSTRAINT "authorization_requests_client_id_oidc_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oidc_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_requests" ADD CONSTRAINT "authorization_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_client_id_oidc_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oidc_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_auth_requests" ADD CONSTRAINT "upstream_auth_requests_authorization_request_id_authorization_requests_id_fk" FOREIGN KEY ("authorization_request_id") REFERENCES "public"."authorization_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "authorization_codes_expires_at_idx" ON "authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "authorization_requests_expires_at_idx" ON "authorization_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "upstream_auth_requests_expires_at_idx" ON "upstream_auth_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_upstream_identity_unique" ON "users" USING btree ("upstream_issuer","upstream_subject");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");