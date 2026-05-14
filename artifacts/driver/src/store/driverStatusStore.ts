// ============================================================
// MCC Driver — Driver Status Store (Zustand)
// ============================================================

import { create } from 'zustand';

interface DriverStatusState {
  isOnline: boolean;
  isToggling: boolean;
  currentLat: number | null;
  currentLng: number | null;
  locationError: string | null;

  setOnline: (isOnline: boolean) => void;
  setToggling: (isToggling: boolean) => void;
  setLocation: (lat: number, lng: number) => void;
  setLocationError: (error: string | null) => void;
}

export const useDriverStatusStore = create<DriverStatusState>((set) => ({
  isOnline: false,
  isToggling: false,
  currentLat: null,
  currentLng: null,
  locationError: null,

  setOnline: (isOnline) => set({ isOnline }),
  setToggling: (isToggling) => set({ isToggling }),
  setLocation: (lat, lng) => set({ currentLat: lat, currentLng: lng, locationError: null }),
  setLocationError: (error) => set({ locationError: error }),
}));
