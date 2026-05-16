CREATE TABLE "tandem_job_declines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tandem_job_id" uuid NOT NULL,
	"ride_along_driver_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "can_do_rideshare" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "can_do_delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ride_along_drivers" ADD COLUMN "zip_lat" real;--> statement-breakpoint
ALTER TABLE "ride_along_drivers" ADD COLUMN "zip_lng" real;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "service_type" text DEFAULT 'concierge' NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "package_description" text;--> statement-breakpoint
ALTER TABLE "tandem_jobs" ADD COLUMN "match_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tandem_jobs" ADD COLUMN "matched_ride_along_driver_id" uuid;--> statement-breakpoint
ALTER TABLE "tandem_job_declines" ADD CONSTRAINT "tandem_job_declines_tandem_job_id_tandem_jobs_id_fk" FOREIGN KEY ("tandem_job_id") REFERENCES "public"."tandem_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tandem_job_declines" ADD CONSTRAINT "tandem_job_declines_ride_along_driver_id_ride_along_drivers_id_fk" FOREIGN KEY ("ride_along_driver_id") REFERENCES "public"."ride_along_drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tandem_job_declines_job_driver_unique" ON "tandem_job_declines" USING btree ("tandem_job_id","ride_along_driver_id");--> statement-breakpoint
ALTER TABLE "tandem_jobs" ADD CONSTRAINT "tandem_jobs_matched_ride_along_driver_id_ride_along_drivers_id_fk" FOREIGN KEY ("matched_ride_along_driver_id") REFERENCES "public"."ride_along_drivers"("id") ON DELETE no action ON UPDATE no action;