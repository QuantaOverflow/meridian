ALTER TABLE "sources" ADD COLUMN "last_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_error" text;