CREATE TABLE "brief_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"story_id" integer NOT NULL,
	"tier" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', "title"), 'A') || setweight(to_tsvector('english', "body"), 'B')) STORED NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "brief_blocks_story_id_unique" UNIQUE("story_id"),
	CONSTRAINT "brief_blocks_report_position_unique" UNIQUE("report_id","position")
);
--> statement-breakpoint
ALTER TABLE "brief_blocks" ADD CONSTRAINT "brief_blocks_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_blocks" ADD CONSTRAINT "brief_blocks_story_id_brief_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."brief_stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brief_blocks_search_idx" ON "brief_blocks" USING gin ("search");