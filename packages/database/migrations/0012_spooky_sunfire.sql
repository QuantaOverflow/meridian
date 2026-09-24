DROP INDEX "brief_runs_workflow_id_idx";--> statement-breakpoint
ALTER TABLE "articles" DROP COLUMN "used_browser";--> statement-breakpoint
ALTER TABLE "brief_runs" DROP COLUMN "trace_id";--> statement-breakpoint
ALTER TABLE "brief_runs" DROP COLUMN "triggered_by";--> statement-breakpoint
ALTER TABLE "brief_stories" DROP COLUMN "intel_report_r2_key";--> statement-breakpoint
ALTER TABLE "reports" DROP COLUMN "total_sources";