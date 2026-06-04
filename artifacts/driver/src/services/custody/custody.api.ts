// ============================================================
// MCC Driver — Custody HTTP API helpers
// ============================================================
// Wraps the netlify custody.js HTTP endpoints. These operations
// (create handoff, release, job-for-ride lookup) have no direct
// Supabase RPC equivalent.
// ============================================================

import { apiUrl } from '@/services/api/baseUrl';
import { supabase } from '@/services/supabase/client';
import type { CustodyHandoff, HandoffLeg, PartyRole } from './custody.types';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const tok = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
  };
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json;
}

// ── create handoff ───────────────────────────────────────────────────────────

export interface CreateHandoffArgs {
  jobId: string;
  leg: HandoffLeg;
  releasingPartyRole: PartyRole;
  receivingPartyId: string;  // auth.uid() of receiver
  receivingPartyRole: PartyRole;
}

export async function createHandoff(args: CreateHandoffArgs): Promise<CustodyHandoff> {
  const r = await postJson<{ handoff: CustodyHandoff }>('/custody/handoffs', {
    job_id:                args.jobId,
    leg:                   args.leg,
    releasing_party_role:  args.releasingPartyRole,
    receiving_party_id:    args.receivingPartyId,
    receiving_party_role:  args.receivingPartyRole,
  });
  return r.handoff;
}

// ── release handoff ──────────────────────────────────────────────────────────

export async function releaseHandoff(
  handoffId: string,
  gpsLat: number | null,
  gpsLng: number | null,
  gpsAccuracyM: number | null,
): Promise<void> {
  await postJson(`/custody/handoffs/${handoffId}/release`, {
    lat:            gpsLat,
    lng:            gpsLng,
    gps_accuracy_m: gpsAccuracyM,
  });
}

// ── job context from ride ────────────────────────────────────────────────────

export interface JobContext {
  jobId: string;
  memberId: string;
  providerId: string | null;
}

export async function getJobContextForRide(rideId: string): Promise<JobContext | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    const res = await fetch(apiUrl(`/custody/job-for-ride?ride_id=${rideId}`), {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) return null;
    const json = await res.json() as { job_id: string; member_id: string; provider_id: string | null };
    return { jobId: json.job_id, memberId: json.member_id, providerId: json.provider_id ?? null };
  } catch {
    return null;
  }
}
