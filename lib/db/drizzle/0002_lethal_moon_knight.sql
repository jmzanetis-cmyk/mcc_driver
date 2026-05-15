CREATE TABLE "tandem_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"tandem_mode" text NOT NULL,
	"ride_along_driver_id" uuid,
	"match_status" text DEFAULT 'pending' NOT NULL,
	"member_approved" boolean,
	"ride_along_fee" real,
	"ride_along_checkin_at" timestamp with time zone,
	"provider_checkin_at" timestamp with time zone,
	"photos_json" jsonb,
	"gps_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "tandem_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "tandem_mode" text;--> statement-breakpoint
ALTER TABLE "tandem_jobs" ADD CONSTRAINT "tandem_jobs_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tandem_jobs" ADD CONSTRAINT "tandem_jobs_provider_id_drivers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tandem_jobs" ADD CONSTRAINT "tandem_jobs_ride_along_driver_id_ride_along_drivers_id_fk" FOREIGN KEY ("ride_along_driver_id") REFERENCES "public"."ride_along_drivers"("id") ON DELETE no action ON UPDATE no action;