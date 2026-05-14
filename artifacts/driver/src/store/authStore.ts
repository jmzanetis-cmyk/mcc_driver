// ============================================================
// MCC Driver — Auth Store (Zustand)
// ============================================================

import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';

export interface DriverProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: 'pending_approval' | 'active' | 'inactive' | 'suspended' | 'deactivated';
  profilePhotoUrl?: string;
  partnerId?: string;
  partnerName?: string;
  isOnline: boolean;
  canDriveMemberVehicle: boolean;
  totalRidesCompleted: number;
  averageRating: number;
  completionRate: number;
  stripeAccountId?: string;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  driver: DriverProfile | null;
  loading: boolean;

  setSession: (session: Session | null) => void;
  setDriver: (driver: DriverProfile | null) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  driver: null,
  loading: true,

  setSession: (session) => set({
    session,
    user: session?.user ?? null,
  }),

  setDriver: (driver) => set({ driver }),
  setLoading: (loading) => set({ loading }),

  clear: () => set({
    session: null,
    user: null,
    driver: null,
    loading: false,
  }),
}));
