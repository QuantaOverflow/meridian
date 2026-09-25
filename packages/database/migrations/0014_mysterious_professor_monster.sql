DROP TABLE "newsletter" CASCADE;--> statement-breakpoint
ALTER TABLE "reports" DROP COLUMN "total_articles";--> statement-breakpoint
ALTER TABLE "reports" DROP COLUMN "clustering_params";--> statement-breakpoint
ALTER TABLE "reports" DROP COLUMN "model_author";--> statement-breakpoint
ALTER TABLE "story_clusters" DROP COLUMN "created_at";