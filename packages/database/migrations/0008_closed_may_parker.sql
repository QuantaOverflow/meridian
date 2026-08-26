CREATE TABLE "story_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brief_stories" ADD COLUMN "centroid" vector(384);--> statement-breakpoint
ALTER TABLE "brief_stories" ADD COLUMN "story_cluster_id" integer;--> statement-breakpoint
ALTER TABLE "brief_stories" ADD CONSTRAINT "brief_stories_story_cluster_id_story_clusters_id_fk" FOREIGN KEY ("story_cluster_id") REFERENCES "public"."story_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brief_stories_cluster_id_idx" ON "brief_stories" USING btree ("story_cluster_id");