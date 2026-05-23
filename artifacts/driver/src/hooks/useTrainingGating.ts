import { useState, useEffect } from 'react';
import { supabase } from '@/services/supabase/client';
import { apiUrl } from '@/services/api/baseUrl';

const TIER_REQUIREMENTS: Record<string, string[]> = {
  tier_1_passenger:      ['passenger-rides'],
  tier_2_vehicle_solo:   ['solo-vehicle-shuttle'],
  tier_3_vehicle_paired: ['solo-vehicle-shuttle', 'tandem-concierge'],
  tier_4_full_concierge: ['solo-vehicle-shuttle', 'tandem-concierge'],
};

export const CERT_LABELS: Record<string, string> = {
  'platform-basics':      'Platform Basics',
  'passenger-rides':      'Passenger Rides',
  'solo-vehicle-shuttle': 'Solo Vehicle Shuttle',
  'tandem-concierge':     'Tandem & Concierge',
  'safety-emergency':     'Safety & Emergency',
  'earnings-business':    'Earnings & Business',
};

interface GatingResult {
  loading: boolean;
  blocked: boolean;
  missingCerts: string[];
}

export function useTrainingGating(tier: string | null | undefined): GatingResult {
  const [certifiedSlugs, setCertifiedSlugs] = useState<Set<string> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/training/certifications'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (!res.ok) { setCertifiedSlugs(new Set()); return; }
        const j = await res.json() as { certifications: Array<{ module_slug: string }> };
        setCertifiedSlugs(new Set(j.certifications.map((c) => c.module_slug)));
      } catch {
        setCertifiedSlugs(new Set());
      }
    })();
  }, []);

  if (certifiedSlugs === null) return { loading: true, blocked: false, missingCerts: [] };

  const required = (tier ? TIER_REQUIREMENTS[tier] : null) ?? [];
  const missingCerts = required.filter((slug) => !certifiedSlugs.has(slug));

  return { loading: false, blocked: missingCerts.length > 0, missingCerts };
}
