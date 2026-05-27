CREATE TYPE "public"."brief_run_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED', 'TERMINATED_NO_STORIES');--> statement-breakpoint
CREATE TABLE "brief_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"status" "brief_run_status" DEFAULT 'RUNNING' NOT NULL,
	"triggered_by" text,
	"params" jsonb,
	"started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"finished_at" timestamp,
	"total_articles" integer,
	"clusters_found" integer,
	"stories_identified" integer,
	"intelligence_analyses" integer,
	"brief_content_length" integer,
	"report_id" integer,
	"error" text,
	CONSTRAINT "brief_runs_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
CREATE TABLE "brief_stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"cluster_id" integer,
	"title" text,
	"importance" real,
	"article_count" integer,
	"article_ids" jsonb,
	"selected_for_intel" boolean DEFAULT false NOT NULL,
	"intel_report_r2_key" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_rejections" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"cluster_id" integer,
	"reason" text,
	"article_count" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brief_runs" ADD CONSTRAINT "brief_runs_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_stories" ADD CONSTRAINT "brief_stories_workflow_id_brief_runs_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."brief_runs"("workflow_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_rejections" ADD CONSTRAINT "cluster_rejections_workflow_id_brief_runs_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."brief_runs"("workflow_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brief_runs_workflow_id_idx" ON "brief_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "brief_stories_workflow_id_idx" ON "brief_stories" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "cluster_rejections_workflow_id_idx" ON "cluster_rejections" USING btree ("workflow_id");