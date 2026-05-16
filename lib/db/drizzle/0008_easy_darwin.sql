CREATE TABLE "driver_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"action" text NOT NULL,
	"admin_email" text NOT NULL,
	"resulting_status" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
