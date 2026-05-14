-- ============================================================
-- MCC Driver — AI Ops Schema Additions
-- ============================================================
-- Run AFTER the main mcc-rides schema.sql
-- Adds tables for: driver vehicles, payouts, support issues,
-- AI conversations, and AI messages.
-- ============================================================

-- ============================================================
-- DRIVER VEHICLES (separate from inline fields on drivers)
-- ============================================================
-- Drivers can register multiple vehicles. The primary vehicle
-- fields on the drivers table are for the original application;
-- this table tracks the full fleet.
-- ============================================================

CREATE TABLE IF NOT EXISTS driver_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year >= 2010),
  color TEXT NOT NULL,
  plate TEXT NOT NULL,
  vin TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  insurance_policy_number TEXT,
  insurance_carrier TEXT,
  insurance_expiry DATE,
  inspection_expiry DATE,
  registration_expiry DATE,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_driver_vehicles_driver ON driver_vehicles(driver_id);
CREATE INDEX idx_driver_vehicles_active ON driver_vehicles(driver_id, is_active);

-- ============================================================
-- DRIVER PAYOUTS
-- ============================================================
-- Tracks Stripe transfer history and payout requests.
-- For partner drivers, payouts go to partner's Stripe account.
-- For independent drivers, payouts go directly to their account.
-- ============================================================

CREATE TYPE payout_status AS ENUM (
  'pending',       -- Calculated, awaiting transfer
  'requested',     -- Driver requested early payout
  'scheduled',     -- Stripe transfer scheduled
  'processing',    -- Stripe is processing
  'completed',     -- Successfully deposited
  'failed'         -- Transfer failed
);

CREATE TABLE IF NOT EXISTS driver_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  amount DECIMAL(10,2),                  -- NULL until calculated
  period_start DATE,                     -- Pay period start
  period_end DATE,                       -- Pay period end
  rides_count INTEGER DEFAULT 0,
  tips_amount DECIMAL(10,2) DEFAULT 0,
  gross_earnings DECIMAL(10,2) DEFAULT 0,
  platform_fee DECIMAL(10,2) DEFAULT 0,
  net_payout DECIMAL(10,2) DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'standard', -- 'instant' or 'standard'
  status payout_status NOT NULL DEFAULT 'pending',
  stripe_transfer_id TEXT,
  stripe_payout_id TEXT,
  scheduled_date DATE,
  completed_at TIMESTAMPTZ,
  failed_reason TEXT,
  requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_driver_payouts_driver ON driver_payouts(driver_id);
CREATE INDEX idx_driver_payouts_status ON driver_payouts(status);
CREATE INDEX idx_driver_payouts_schedule ON driver_payouts(scheduled_date, status);

-- ============================================================
-- DRIVER SUPPORT ISSUES
-- ============================================================
-- Created by the AI assistant or by drivers directly.
-- Tracks escalations, ride disputes, and general issues.
-- ============================================================

CREATE TYPE issue_status AS ENUM (
  'open',
  'in_progress',
  'escalated',
  'resolved',
  'closed'
);

CREATE TYPE issue_priority AS ENUM (
  'low',
  'medium',
  'high',
  'urgent'
);

CREATE TABLE IF NOT EXISTS driver_support_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  ride_id UUID REFERENCES rides(id),
  issue_type TEXT NOT NULL,              -- 'fare_dispute', 'member_complaint', 'vehicle_damage', 'payout_issue', 'escalation', etc.
  description TEXT NOT NULL,
  status issue_status NOT NULL DEFAULT 'open',
  priority issue_priority NOT NULL DEFAULT 'medium',
  resolution TEXT,
  resolved_by TEXT,                      -- 'ai' or admin user id
  assigned_to TEXT,                      -- Admin user id for human escalation
  ai_conversation_id UUID,              -- Link back to the AI conversation that created it
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_support_issues_driver ON driver_support_issues(driver_id);
CREATE INDEX idx_support_issues_status ON driver_support_issues(status);
CREATE INDEX idx_support_issues_ride ON driver_support_issues(ride_id);

-- ============================================================
-- AI CONVERSATIONS
-- ============================================================
-- Tracks conversation sessions between drivers and the AI.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'support',  -- 'support', 'earnings', 'vehicle', 'verification', 'ride_issue', 'account', 'onboarding'
  status TEXT NOT NULL DEFAULT 'open',       -- 'open', 'resolved', 'escalated'
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  escalated_to UUID,                        -- References driver_support_issues if escalated
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_conversations_driver ON ai_conversations(driver_id);
CREATE INDEX idx_ai_conversations_status ON ai_conversations(driver_id, status);

-- ============================================================
-- AI MESSAGES
-- ============================================================
-- Individual messages within AI conversations.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  actions_taken JSONB,                   -- Array of actions the AI executed
  tokens_used INTEGER,                   -- For cost tracking
  model TEXT DEFAULT 'claude-sonnet-4-20250514',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id, created_at);

-- ============================================================
-- DRIVER DOCUMENTS (insurance, license uploads, etc.)
-- ============================================================

CREATE TYPE document_type AS ENUM (
  'drivers_license_front',
  'drivers_license_back',
  'insurance_certificate',
  'hired_nonowned_insurance',
  'vehicle_registration',
  'vehicle_inspection',
  'profile_photo',
  'background_check_consent',
  'other'
);

CREATE TYPE document_status AS ENUM (
  'pending_review',
  'approved',
  'rejected',
  'expired'
);

CREATE TABLE IF NOT EXISTS driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES driver_vehicles(id),
  doc_type document_type NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  status document_status NOT NULL DEFAULT 'pending_review',
  expires_at DATE,
  reviewed_by TEXT,
  review_notes TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX idx_driver_documents_driver ON driver_documents(driver_id);
CREATE INDEX idx_driver_documents_type ON driver_documents(driver_id, doc_type);
CREATE INDEX idx_driver_documents_expiry ON driver_documents(expires_at, status);

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Driver vehicles: drivers see only their own
ALTER TABLE driver_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_vehicles_own ON driver_vehicles
  FOR ALL USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- Payouts: drivers see only their own
ALTER TABLE driver_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_payouts_own ON driver_payouts
  FOR ALL USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- Support issues: drivers see only their own
ALTER TABLE driver_support_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_issues_own ON driver_support_issues
  FOR ALL USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- AI conversations: drivers see only their own
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_conversations_own ON ai_conversations
  FOR ALL USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- AI messages: drivers see messages in their conversations
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_messages_own ON ai_messages
  FOR ALL USING (conversation_id IN (
    SELECT id FROM ai_conversations WHERE driver_id IN (
      SELECT id FROM drivers WHERE user_id = auth.uid()
    )
  ));

-- Driver documents: drivers see only their own
ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_documents_own ON driver_documents
  FOR ALL USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- ============================================================
-- AUTO-UPDATE TIMESTAMPS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_driver_vehicles_updated_at
  BEFORE UPDATE ON driver_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_driver_payouts_updated_at
  BEFORE UPDATE ON driver_payouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_driver_support_issues_updated_at
  BEFORE UPDATE ON driver_support_issues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- DOCUMENT EXPIRY ALERT VIEW
-- ============================================================
-- Use this to find documents expiring within 30 days

CREATE OR REPLACE VIEW expiring_documents AS
SELECT
  dd.id,
  dd.driver_id,
  d.first_name || ' ' || d.last_name AS driver_name,
  d.email,
  d.phone,
  dd.doc_type,
  dd.expires_at,
  dd.expires_at - CURRENT_DATE AS days_until_expiry
FROM driver_documents dd
JOIN drivers d ON d.id = dd.driver_id
WHERE dd.status = 'approved'
  AND dd.expires_at IS NOT NULL
  AND dd.expires_at <= CURRENT_DATE + INTERVAL '30 days'
ORDER BY dd.expires_at ASC;

-- ============================================================
-- SCHEMA ADDITIONS TO EXISTING TABLES
-- ============================================================
-- These columns are added to tables from the base schema.sql.
-- Run AFTER the main schema has been applied.
-- ============================================================

-- Add payout tracking columns to driver_assignments
ALTER TABLE driver_assignments
  ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES driver_payouts(id);

CREATE INDEX IF NOT EXISTS idx_driver_assignments_payout
  ON driver_assignments(driver_id, payout_status);

-- Add card/bank info to driver_payouts for display
ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS card_last4 TEXT,
  ADD COLUMN IF NOT EXISTS bank_last4 TEXT;
