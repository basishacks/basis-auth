ALTER TABLE "users" ADD COLUMN "picture_content_type" text;--> statement-breakpoint
UPDATE "users" SET "picture_content_type" = substring("picture" from '^data:([^;]+);base64,')
WHERE "picture" ~ '^data:[^;]+;base64,';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "picture" SET DATA TYPE bytea USING CASE
  WHEN "picture" ~ '^data:image/[^;]+;base64,'
    THEN decode(regexp_replace("picture", '^data:image/[^;]+;base64,', ''), 'base64')
  ELSE NULL
END;
