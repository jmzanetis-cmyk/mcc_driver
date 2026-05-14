// ============================================================
// MCC Driver — AI Operations Service
// ============================================================
// Handles all AI-powered features: support chat, automated
// accounting, payout inquiries, vehicle management, document
// verification, dispute resolution, and onboarding guidance.
//
// Uses Claude API (Sonnet) via the Anthropic Messages endpoint.
// The system prompt gives Claude full context about MCC's
// operations, the driver's profile, and available actions.
// ============================================================

import { supabase } from '@/services/supabase/client';

// ============================================================
// TYPES
// ============================================================

export type AICategory =
  | 'support'          // General help, how-to, troubleshooting
  | 'earnings'         // Payout questions, fare disputes, tax help
  | 'vehicle'          // Add/remove vehicles, insurance docs
  | 'verification'     // License renewal, background check status
  | 'ride_issue'       // Active/recent ride problems
  | 'account'          // Profile, settings, deactivation concerns
  | 'onboarding';      // New driver guidance

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  category?: AICategory;
  actionTaken?: string;  // e.g., "vehicle_added", "payout_initiated"
}

export interface AIConversation {
  id: string;
  driverId: string;
  messages: AIMessage[];
  category: AICategory;
  status: 'open' | 'resolved' | 'escalated';
  createdAt: string;
  resolvedAt?: string;
}

interface DriverContext {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  partnerId?: string;
  partnerName?: string;
  isOnline: boolean;
  canDriveMemberVehicle: boolean;
  totalRidesCompleted: number;
  averageRating: number;
  completionRate: number;
  stripeAccountId?: string;
  vehicles: VehicleInfo[];
  recentRides: RecentRideInfo[];
  pendingPayouts: PayoutInfo[];
  openIssues: IssueInfo[];
}

interface VehicleInfo {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate: string;
  isActive: boolean;
  insuranceExpiry?: string;
}

interface RecentRideInfo {
  id: string;
  scenario: string;
  status: string;
  fare: number;
  driverPayout: number;
  completedAt?: string;
  pickupAddress: string;
  dropoffAddress: string;
  memberRating?: number;
}

interface PayoutInfo {
  amount: number;
  status: string;
  scheduledDate: string;
  stripeTransferId?: string;
}

interface IssueInfo {
  id: string;
  type: string;
  description: string;
  status: string;
  createdAt: string;
}

// ============================================================
// SYSTEM PROMPT BUILDER
// ============================================================

function buildSystemPrompt(driver: DriverContext): string {
  const vehicleList = driver.vehicles.length > 0
    ? driver.vehicles.map(v => `  - ${v.year} ${v.color} ${v.make} ${v.model} (${v.plate}) — ${v.isActive ? 'Active' : 'Inactive'}${v.insuranceExpiry ? `, insurance expires ${v.insuranceExpiry}` : ''}`).join('\n')
    : '  None registered';

  const recentRidesList = driver.recentRides.slice(0, 5).map(r =>
    `  - ${r.scenario} | ${r.status} | $${r.fare.toFixed(2)} fare / $${r.driverPayout.toFixed(2)} payout | ${r.pickupAddress.split(',')[0]} → ${r.dropoffAddress.split(',')[0]}${r.completedAt ? ` | ${r.completedAt}` : ''}${r.memberRating ? ` | Rated ${r.memberRating}/5` : ''}`
  ).join('\n') || '  No recent rides';

  const payoutsList = driver.pendingPayouts.map(p =>
    `  - $${p.amount.toFixed(2)} — ${p.status} — scheduled ${p.scheduledDate}`
  ).join('\n') || '  No pending payouts';

  const issuesList = driver.openIssues.map(i =>
    `  - [${i.type}] ${i.description} — ${i.status} — opened ${i.createdAt}`
  ).join('\n') || '  No open issues';

  return `You are MCC Driver Support, the AI assistant built into the My Car Concierge Driver app. You help drivers with everything they need — support questions, earnings/payout inquiries, adding vehicles, document verification, ride issues, and onboarding guidance.

## About MCC
My Car Concierge (MCC) is a two-sided automotive service marketplace. Members book car services through providers (mechanics, detailers, body shops). The transportation module provides rides and vehicle shuttles so members don't need to arrange their own transportation when their car is being serviced.

## Service Tiers & Pricing
- Tier 1 (Passenger): $10 base + $1.50/mi, $12 min — standard rides
- Tier 2 (Vehicle Solo): $20 base + $2.00/mi, $25 min — one driver moves member's car
- Tier 3 (Vehicle Paired): $35 base + $2.50/mi, $40 min — two drivers, one moves car, one follows
- Tier 4 (Full Concierge): $40 base + $3.00/mi, $45 min — two drivers, one moves car, one drives member

## Revenue Split
- Driver share: 85% of fare
- MCC platform fee: 15%
- Tips: 100% to driver
- Partner drivers: 85% goes to partner company, partner pays drivers per their own structure

## Instant Pay
- Drivers can cash out available earnings instantly to a debit card
- Instant Pay fee: $0.50 per cash-out (MCC keeps this)
- Minimum cash-out: $5.00
- Maximum: full available balance
- Daily limit: 5 instant payouts per day
- Standard (free) payout: ACH to bank account, every Wednesday, 2-3 business days
- Requires: Stripe Connect account + linked debit card
- Partner drivers cannot use Instant Pay (paid by partner company)
- To set up: Settings → Payments → connect Stripe → add debit card

## Driver Types
- Partner drivers: affiliated with a transportation partner company (partner_id is set)
- Independent drivers: no partner, direct MCC relationship, own Stripe Connect account

## Current Driver Profile
Name: ${driver.firstName} ${driver.lastName}
Email: ${driver.email}
Phone: ${driver.phone}
Status: ${driver.status}
Type: ${driver.partnerId ? `Partner driver (${driver.partnerName || 'partner company'})` : 'Independent MCC driver'}
Online: ${driver.isOnline ? 'Yes' : 'No'}
Can drive member vehicles: ${driver.canDriveMemberVehicle ? 'Yes (Tier 2+ eligible)' : 'No (Tier 1 only — needs insurance verification)'}
Total rides: ${driver.totalRidesCompleted}
Average rating: ${driver.averageRating}/5
Completion rate: ${(driver.completionRate * 100).toFixed(0)}%
Stripe account: ${driver.stripeAccountId ? 'Connected' : 'Not set up'}

## Registered Vehicles
${vehicleList}

## Recent Rides (last 5)
${recentRidesList}

## Pending Payouts
${payoutsList}

## Open Issues
${issuesList}

## What You Can Do

### Direct Actions (you can execute these)
When the driver asks you to do something, respond with the action in a structured way. Include an ACTION block at the end of your message:

1. **Add a vehicle**: Collect make, model, year, color, plate. Then output:
   [ACTION:ADD_VEHICLE|make=X|model=X|year=X|color=X|plate=X]

2. **Remove/deactivate a vehicle**: Confirm which vehicle. Then:
   [ACTION:DEACTIVATE_VEHICLE|vehicle_id=X]

3. **Update profile info**: Name, email, phone changes:
   [ACTION:UPDATE_PROFILE|field=X|value=X]

4. **Request payout**: Trigger an immediate Stripe payout:
   [ACTION:REQUEST_PAYOUT]

5. **Report ride issue**: Create a support ticket:
   [ACTION:CREATE_ISSUE|ride_id=X|type=X|description=X]

6. **Upload document reminder**: Send driver a reminder link:
   [ACTION:SEND_DOCUMENT_REMINDER|doc_type=X]

7. **Escalate to human**: When you can't resolve something:
   [ACTION:ESCALATE|reason=X]

8. **Go online/offline**: Toggle driver availability:
   [ACTION:SET_STATUS|online=true/false]

### Information You Can Provide
- Fare breakdowns for any ride (use the data above)
- Payout schedule and history
- How to get Tier 2+ certified (insurance requirements)
- MCC policies (cancellation, rating thresholds, deactivation criteria)
- Tax guidance (1099-NEC issued for earnings > $600, track mileage, quarterly estimates)
- Vehicle requirements (4-door, 2010+, clean title, pass inspection)
- Background check status and timeline
- How dispatch works (nearest driver, partner priority, cascade on timeout)

### Policies to Enforce
- Minimum rating: 4.5 average or account review triggered
- Completion rate: below 80% triggers warning, below 70% triggers review
- Cancellation after acceptance: affects completion rate
- No-show at pickup: member can report, triggers review
- Vehicle inspection photos: required for Tiers 2/3/4, 4 angles minimum
- Insurance: hired/non-owned auto required for driving member vehicles

## Tone & Style
- Friendly, professional, concise
- Use the driver's first name
- Don't be overly formal — this is a chat, not an email
- If you need more info, ask one clear question
- If you're taking an action, confirm what you're doing before the ACTION block
- For earnings questions, show the math
- For complex issues, break it down step by step
- Always be honest about what you can and can't do
- If something needs a human, escalate immediately — don't guess

## Important
- Never share other drivers' information
- Never reveal internal dispatch algorithms beyond what's documented
- Never promise specific payout dates — say "typically within X days"
- For legal/insurance questions, provide general guidance but recommend consulting a professional
- If a driver seems frustrated, acknowledge it before solving the problem`;
}

// ============================================================
// DRIVER CONTEXT LOADER
// ============================================================

async function loadDriverContext(driverId: string): Promise<DriverContext | null> {
  // Get driver profile
  const { data: driver } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', driverId)
    .single() as any;

  if (!driver) return null;

  // Get partner name if applicable
  let partnerName: string | undefined;
  if (driver.partner_id) {
    const { data: partner } = await supabase
      .from('transportation_partners')
      .select('company_name')
      .eq('id', driver.partner_id)
      .single() as any;
    partnerName = partner?.company_name;
  }

  // Get vehicles (from a driver_vehicles table or inline fields)
  const { data: vehicles } = await supabase
    .from('driver_vehicles')
    .select('*')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false });

  // Get recent rides
  const { data: assignments } = await supabase
    .from('driver_assignments')
    .select(`
      ride_id, driver_payout_amount, status,
      rides (
        id, scenario, status, actual_fare, estimated_fare,
        pickup_address, dropoff_address, completed_at, member_rating
      )
    `)
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(10) as any;

  // Get pending payouts
  const { data: payouts } = await supabase
    .from('driver_payouts')
    .select('*')
    .eq('driver_id', driverId)
    .in('status', ['pending', 'scheduled'])
    .order('scheduled_date', { ascending: true });

  // Get open issues
  const { data: issues } = await supabase
    .from('driver_support_issues')
    .select('*')
    .eq('driver_id', driverId)
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false });

  const recentRides: RecentRideInfo[] = (assignments || []).map((a: any) => {
    const ride = a.rides;
    return {
      id: ride?.id || a.ride_id,
      scenario: ride?.scenario || 'unknown',
      status: ride?.status || a.status,
      fare: ride?.actual_fare || ride?.estimated_fare || 0,
      driverPayout: a.driver_payout_amount || 0,
      completedAt: ride?.completed_at,
      pickupAddress: ride?.pickup_address || '',
      dropoffAddress: ride?.dropoff_address || '',
      memberRating: ride?.member_rating,
    };
  });

  return {
    id: driver.id,
    firstName: driver.first_name,
    lastName: driver.last_name,
    email: driver.email,
    phone: driver.phone,
    status: driver.status,
    partnerId: driver.partner_id,
    partnerName,
    isOnline: driver.is_online,
    canDriveMemberVehicle: driver.can_drive_member_vehicle,
    totalRidesCompleted: driver.total_rides_completed,
    averageRating: driver.average_rating,
    completionRate: driver.completion_rate,
    stripeAccountId: driver.stripe_account_id,
    vehicles: (vehicles || []).map((v: any) => ({
      id: v.id,
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      plate: v.plate,
      isActive: v.is_active,
      insuranceExpiry: v.insurance_expiry,
    })),
    recentRides,
    pendingPayouts: (payouts || []).map((p: any) => ({
      amount: p.amount,
      status: p.status,
      scheduledDate: p.scheduled_date,
      stripeTransferId: p.stripe_transfer_id,
    })),
    openIssues: (issues || []).map((i: any) => ({
      id: i.id,
      type: i.issue_type,
      description: i.description,
      status: i.status,
      createdAt: i.created_at,
    })),
  };
}

// ============================================================
// ACTION PARSER & EXECUTOR
// ============================================================

interface ParsedAction {
  type: string;
  params: Record<string, string>;
}

function parseActions(response: string): ParsedAction[] {
  const actionRegex = /\[ACTION:(\w+)(?:\|([^\]]+))?\]/g;
  const actions: ParsedAction[] = [];
  let match;

  while ((match = actionRegex.exec(response)) !== null) {
    const type = match[1];
    const paramsStr = match[2] || '';
    const params: Record<string, string> = {};

    if (paramsStr) {
      paramsStr.split('|').forEach(pair => {
        const [key, ...valueParts] = pair.split('=');
        if (key) params[key.trim()] = valueParts.join('=').trim();
      });
    }

    actions.push({ type, params });
  }

  return actions;
}

async function executeAction(
  action: ParsedAction,
  driverId: string
): Promise<{ success: boolean; message: string }> {
  switch (action.type) {
    case 'ADD_VEHICLE': {
      const { make, model, year, color, plate } = action.params;
      const { error } = await supabase.from('driver_vehicles').insert({
        driver_id: driverId,
        make, model,
        year: parseInt(year),
        color, plate,
        is_active: true,
      });
      if (error) return { success: false, message: `Failed to add vehicle: ${error.message}` };
      return { success: true, message: `Added ${year} ${color} ${make} ${model} (${plate})` };
    }

    case 'DEACTIVATE_VEHICLE': {
      const { vehicle_id } = action.params;
      const { error } = await supabase.from('driver_vehicles')
        .update({ is_active: false })
        .eq('id', vehicle_id)
        .eq('driver_id', driverId);
      if (error) return { success: false, message: `Failed to deactivate vehicle: ${error.message}` };
      return { success: true, message: 'Vehicle deactivated' };
    }

    case 'UPDATE_PROFILE': {
      const { field, value } = action.params;
      const allowedFields: Record<string, string> = {
        first_name: 'first_name', last_name: 'last_name',
        email: 'email', phone: 'phone',
      };
      const dbField = allowedFields[field];
      if (!dbField) return { success: false, message: `Cannot update field: ${field}` };

      const { error } = await supabase.from('drivers')
        .update({ [dbField]: value })
        .eq('id', driverId);
      if (error) return { success: false, message: `Failed to update: ${error.message}` };
      return { success: true, message: `Updated ${field} to ${value}` };
    }

    case 'REQUEST_PAYOUT': {
      // In production: trigger Stripe payout via Edge Function
      const { error } = await supabase.from('driver_payouts').insert({
        driver_id: driverId,
        status: 'requested',
        requested_at: new Date().toISOString(),
      });
      if (error) return { success: false, message: `Payout request failed: ${error.message}` };
      return { success: true, message: 'Payout requested — typically processes within 1-2 business days' };
    }

    case 'CREATE_ISSUE': {
      const { ride_id, type, description } = action.params;
      const { error } = await supabase.from('driver_support_issues').insert({
        driver_id: driverId,
        ride_id: ride_id || null,
        issue_type: type,
        description,
        status: 'open',
      });
      if (error) return { success: false, message: `Failed to create issue: ${error.message}` };
      return { success: true, message: 'Support ticket created — we\'ll follow up within 24 hours' };
    }

    case 'ESCALATE': {
      const { reason } = action.params;
      const { error } = await supabase.from('driver_support_issues').insert({
        driver_id: driverId,
        issue_type: 'escalation',
        description: reason,
        status: 'escalated',
        priority: 'high',
      });
      if (error) return { success: false, message: 'Failed to escalate' };
      return { success: true, message: 'Escalated to MCC support team — a human will reach out within 4 hours' };
    }

    case 'SET_STATUS': {
      const online = action.params.online === 'true';
      const { error } = await supabase.from('drivers')
        .update({ is_online: online })
        .eq('id', driverId);
      if (error) return { success: false, message: `Failed to update status: ${error.message}` };
      return { success: true, message: online ? 'You\'re now online' : 'You\'re now offline' };
    }

    case 'SEND_DOCUMENT_REMINDER': {
      // In production: trigger Twilio SMS or push notification
      return { success: true, message: `Reminder sent for ${action.params.doc_type} upload` };
    }

    default:
      return { success: false, message: `Unknown action: ${action.type}` };
  }
}

// ============================================================
// MAIN CHAT FUNCTION
// ============================================================

export async function sendDriverMessage(
  driverId: string,
  conversationId: string | null,
  userMessage: string,
  conversationHistory: AIMessage[] = [],
): Promise<{
  response: string;
  conversationId: string;
  actions: { type: string; result: string }[];
  category: AICategory;
}> {
  // Load fresh driver context
  const driverContext = await loadDriverContext(driverId);
  if (!driverContext) {
    throw new Error('Driver profile not found');
  }

  // Build messages array for Claude
  const messages = [
    ...conversationHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: userMessage },
  ];

  // Call Claude API
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: buildSystemPrompt(driverContext),
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} — ${errorText}`);
  }

  const data = await response.json();
  const assistantMessage = data.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');

  // Parse and execute any actions
  const parsedActions = parseActions(assistantMessage);
  const actionResults: { type: string; result: string }[] = [];

  for (const action of parsedActions) {
    const result = await executeAction(action, driverId);
    actionResults.push({
      type: action.type,
      result: result.message,
    });
  }

  // Strip ACTION blocks from the display message
  const displayMessage = assistantMessage.replace(/\[ACTION:[^\]]+\]/g, '').trim();

  // Categorize the conversation
  const category = categorizeMessage(userMessage);

  // Save to conversation history in Supabase
  const convId = conversationId || crypto.randomUUID();

  await supabase.from('ai_conversations').upsert({
    id: convId,
    driver_id: driverId,
    category,
    status: 'open',
    last_message_at: new Date().toISOString(),
  });

  await supabase.from('ai_messages').insert([
    {
      conversation_id: convId,
      role: 'user',
      content: userMessage,
    },
    {
      conversation_id: convId,
      role: 'assistant',
      content: displayMessage,
      actions_taken: actionResults.length > 0 ? JSON.stringify(actionResults) : null,
    },
  ]);

  return {
    response: displayMessage,
    conversationId: convId,
    actions: actionResults,
    category,
  };
}

// ============================================================
// CATEGORY DETECTION
// ============================================================

function categorizeMessage(message: string): AICategory {
  const lower = message.toLowerCase();

  if (/payout|earn|pay|money|income|tax|1099|deposit|transfer|stripe/i.test(lower)) return 'earnings';
  if (/vehicle|car|truck|van|plate|add.*(car|vehicle)|remove.*(car|vehicle)|insurance/i.test(lower)) return 'vehicle';
  if (/license|background.?check|document|verify|certification|expir/i.test(lower)) return 'verification';
  if (/ride.*issue|problem.*ride|member.*complaint|dispute|cancel|wrong.*address|accident/i.test(lower)) return 'ride_issue';
  if (/account|deactivat|suspend|password|login|profile|settings/i.test(lower)) return 'account';
  if (/how.*(do|does|to)|get.?started|new.?driver|first.?ride|onboard|sign.?up/i.test(lower)) return 'onboarding';

  return 'support';
}

// ============================================================
// QUICK ACTIONS (pre-built prompts for common tasks)
// ============================================================

export const QUICK_ACTIONS = [
  { id: 'earnings_today', label: 'Today\'s earnings', icon: '💰', prompt: 'Show me my earnings breakdown for today' },
  { id: 'add_vehicle', label: 'Add a vehicle', icon: '🚗', prompt: 'I want to add a new vehicle to my account' },
  { id: 'payout_status', label: 'Payout status', icon: '💳', prompt: 'When is my next payout and how much?' },
  { id: 'tier2_cert', label: 'Get Tier 2 certified', icon: '📋', prompt: 'How do I get certified to drive member vehicles (Tier 2+)?' },
  { id: 'ride_issue', label: 'Report ride issue', icon: '⚠️', prompt: 'I have an issue with a recent ride' },
  { id: 'tax_help', label: 'Tax info', icon: '📊', prompt: 'What do I need to know about taxes as an MCC driver?' },
  { id: 'insurance', label: 'Insurance help', icon: '🛡️', prompt: 'What insurance do I need and how do I upload it?' },
  { id: 'update_license', label: 'Update license', icon: '🪪', prompt: 'My driver\'s license is expiring, how do I update it?' },
];

// ============================================================
// LOAD CONVERSATION HISTORY
// ============================================================

export async function loadConversation(conversationId: string): Promise<AIMessage[]> {
  const { data } = await supabase
    .from('ai_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  return (data || []).map((m: any) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.created_at,
    actionTaken: m.actions_taken,
  }));
}

export async function loadRecentConversations(driverId: string): Promise<AIConversation[]> {
  const { data } = await supabase
    .from('ai_conversations')
    .select('*')
    .eq('driver_id', driverId)
    .order('last_message_at', { ascending: false })
    .limit(20) as any;

  return (data || []).map((c: any) => ({
    id: c.id,
    driverId: c.driver_id,
    messages: [],
    category: c.category,
    status: c.status,
    createdAt: c.created_at,
    resolvedAt: c.resolved_at,
  }));
}
