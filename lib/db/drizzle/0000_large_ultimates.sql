CREATE TABLE "driver_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"driver_payout_amount" real,
	"dispatched_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"en_route_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"drives_member_vehicle" boolean DEFAULT false NOT NULL,
	"carries_passenger" boolean DEFAULT false NOT NULL,
	"response_deadline" timestamp with time zone NOT NULL,
	"member_vehicle_description" text,
	"member_vehicle_plate" text,
	"dispatch_attempt" integer DEFAULT 1 NOT NULL,
	"payout_status" text,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"amount" real NOT NULL,
	"net_payout" real,
	"platform_fee" real,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"scheduled_date" timestamp with time zone,
	"stripe_transfer_id" text,
	"card_last4" text,
	"bank_last4" text,
	"failed_reason" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"profile_photo_url" text,
	"license_document_path" text,
	"insurance_document_path" text,
	"background_check_passed" boolean DEFAULT false NOT NULL,
	"partner_id" uuid,
	"is_online" boolean DEFAULT false NOT NULL,
	"can_drive_member_vehicle" boolean DEFAULT false NOT NULL,
	"total_rides_completed" integer DEFAULT 0 NOT NULL,
	"average_rating" real DEFAULT 5 NOT NULL,
	"completion_rate" real DEFAULT 1 NOT NULL,
	"stripe_account_id" text,
	"current_lat" real,
	"current_lng" real,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario" text NOT NULL,
	"tier" text NOT NULL,
	"status" text DEFAULT 'pending_dispatch' NOT NULL,
	"member_id" text,
	"pickup_address" text NOT NULL,
	"pickup_lat" real NOT NULL,
	"pickup_lng" real NOT NULL,
	"dropoff_address" text NOT NULL,
	"dropoff_lat" real NOT NULL,
	"dropoff_lng" real NOT NULL,
	"estimated_fare" real NOT NULL,
	"actual_fare" real,
	"estimated_distance_miles" real NOT NULL,
	"actual_distance_miles" real,
	"tip_amount" real,
	"member_rating" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"member_vehicle_year" integer,
	"member_vehicle_make" text,
	"member_vehicle_model" text,
	"member_vehicle_color" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_assignments_one_pending_per_ride_role" ON "driver_assignments" USING btree ("ride_id","role") WHERE "driver_assignments"."status" = 'pending';