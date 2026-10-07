ALTER TABLE "brief_blocks" ADD COLUMN "placement_country" text;--> statement-breakpoint
ALTER TABLE "brief_blocks" ADD COLUMN "mention_countries" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "brief_blocks_placement_country_idx" ON "brief_blocks" USING btree ("placement_country");--> statement-breakpoint
CREATE INDEX "brief_blocks_mention_countries_idx" ON "brief_blocks" USING gin ("mention_countries");