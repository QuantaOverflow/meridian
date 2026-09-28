ALTER TABLE "reports" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
-- 回填：定时（cron）跑出的历史期对读者可见，发布时刻取保存时刻；手动期保持 null。
UPDATE "reports" SET "published_at" = "reports"."created_at"
FROM "brief_runs"
WHERE "brief_runs"."report_id" = "reports"."id"
  AND "brief_runs"."params"->>'triggeredBy' = 'cron';
