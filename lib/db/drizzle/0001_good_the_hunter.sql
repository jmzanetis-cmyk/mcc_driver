CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ride_along_drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"zip_code" text,
	"max_distance_miles" integer DEFAULT 20 NOT NULL,
	"license_number" text,
	"license_state" text,
	"license_expiry" text,
	"license_document_path" text,
	"insurance_document_path" text,
	"insurance_expiry" text,
	"background_check_status" text DEFAULT 'pending' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"profile_photo_path" text,
	"agreement_signed_at" timestamp with time zone,
	"rating" real DEFAULT 5 NOT NULL,
	"total_jobs" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "ride_along_drivers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_unique_idx" ON "admin_users" USING btree ("email");