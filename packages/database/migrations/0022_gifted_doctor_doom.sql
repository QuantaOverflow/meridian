ALTER TABLE "brief_blocks" ADD COLUMN "entities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "brief_blocks" ADD COLUMN "entity_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "brief_blocks_entities_idx" ON "brief_blocks" USING gin ("entities");