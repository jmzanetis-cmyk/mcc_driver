// ============================================================
// MCC Driver — Ride Scenario Definitions
// ============================================================
// Client-side mirror of the backend SCENARIO_CONFIG.
// Used by hooks and screens to understand ride structure.
// ============================================================

export type RideScenario =
  | 'member_dropoff'
  | 'member_pickup'
  | 'passenger_round_trip'
  | 'vehicle_delivery_solo'
  | 'vehicle_pickup_solo'
  | 'paired_vehicle_delivery'
  | 'paired_vehicle_pickup'
  | 'paired_round_trip_shuttle'
  | 'concierge_dropoff'
  | 'concierge_pickup'
  | 'full_concierge_round_trip';

export type RideTier =
  | 'tier_1_passenger'
  | 'tier_2_vehicle_solo'
  | 'tier_3_vehicle_paired'
  | 'tier_4_full_concierge';

interface DriverAssignment {
  role: 'primary' | 'chase';
  drivesMemberVehicle: boolean;
  carriesPassenger: boolean;
  description: string;
}

interface ScenarioConfig {
  tier: RideTier;
  driversRequired: 1 | 2;
  assignments: DriverAssignment[];
  description: string;
  shortDescription: string;
}

export const SCENARIO_CONFIG: Record<RideScenario, ScenarioConfig> = {
  // ── Tier 1: Passenger ──
  member_dropoff: {
    tier: 'tier_1_passenger',
    driversRequired: 1,
    assignments: [
      { role: 'primary', drivesMemberVehicle: false, carriesPassenger: true, description: 'Drive member in your vehicle to their destination' },
    ],
    description: 'Drive the member to their drop-off location, like a standard ride.',
    shortDescription: 'Drop member at destination',
  },
  member_pickup: {
    tier: 'tier_1_passenger',
    driversRequired: 1,
    assignments: [
      { role: 'primary', drivesMemberVehicle: false, carriesPassenger: true, description: 'Pick up the member and drive them in your vehicle' },
    ],
    description: 'Pick the member up from a location and drive them.',
    shortDescription: 'Pick up member',
  },
  passenger_round_trip: {
    tier: 'tier_1_passenger',
    driversRequired: 1,
    assignments: [
      { role: 'primary', drivesMemberVehicle: false, carriesPassenger: true, description: 'Drive member round trip, wait at destination' },
    ],
    description: 'Drive the member to a destination, wait, and bring them back.',
    shortDescription: 'Round trip with wait',
  },

  // ── Tier 2: Vehicle Solo ──
  vehicle_delivery_solo: {
    tier: 'tier_2_vehicle_solo',
    driversRequired: 1,
    assignments: [
      { role: 'primary', drivesMemberVehicle: true, carriesPassenger: false, description: "Drive the member's vehicle to its destination" },
    ],
    description: "Deliver the member's vehicle to a service shop, valet, or other location. No passenger.",
    shortDescription: "Deliver member's vehicle",
  },
  vehicle_pickup_solo: {
    tier: 'tier_2_vehicle_solo',
    driversRequired: 1,
    assignments: [
      { role: 'primary', drivesMemberVehicle: true, carriesPassenger: false, description: "Pick up the member's vehicle and drive it to them" },
    ],
    description: "Pick up the member's vehicle from a shop or location and return it.",
    shortDescription: "Pick up member's vehicle",
  },

  // ── Tier 3: Vehicle Paired ──
  paired_vehicle_delivery: {
    tier: 'tier_3_vehicle_paired',
    driversRequired: 2,
    assignments: [
      { role: 'primary', drivesMemberVehicle: true, carriesPassenger: false, description: "Drive the member's vehicle to its destination" },
      { role: 'chase', drivesMemberVehicle: false, carriesPassenger: false, description: 'Follow in chase vehicle, pick up primary driver after delivery' },
    ],
    description: "Two drivers: one drives the member's vehicle, the chase driver follows and picks up the primary afterward.",
    shortDescription: 'Paired vehicle delivery',
  },
  paired_vehicle_pickup: {
    tier: 'tier_3_vehicle_paired',
    driversRequired: 2,
    assignments: [
      { role: 'primary', drivesMemberVehicle: true, carriesPassenger: false, description: "Pick up and drive the member's vehicle back" },
      { role: 'chase', drivesMemberVehicle: false, carriesPassenger: false, description: 'Drop off primary driver at vehicle, then follow back' },
    ],
    description: "Two drivers: chase drops primary at the vehicle location, primary drives it back, chase follows.",
    shortDescription: 'Paired vehicle pickup',
  },
  paired_round_trip_shuttle: {
    tier: 'tier_3_vehicle_paired',
    driversRequired: 2,
    assignments: [
      { role: 'primary', drivesMemberVehicle: true, carriesPassenger: false, description: "Drive the member's vehicle round trip" },
      { role: 'chase', drivesMemberVehicle: false, carriesPassenger: false, description: 'Follow both legs in chase vehicle' },
    ],
    description: "Full round-trip vehicle shuttle with a chase driver for both legs.",
    shortDescription: 'Paired round trip',
  },

  // ── Tier 4: Full Concierge ──
  concierge_dropoff: {
    tier: 'tier_4_full_concierge',
    driversRequired: 2,
    assignments: [
      { role: 'primary', drivesMemberVehicle: true, carriesPassenger: false, description: "Drive the member's vehicle to the destination" },
      { role: 'chase', drivesMemberVehicle: false, carriesPassenger: true, description: 'Drive the member in chase vehicle to the destination' },
    ],
    description: "The premium: one driver takes the member's car, the other takes the member. Both go to the destination.",
    shortDescription: 'Full concierge drop-off',
  },
  concierge_pickup: {
    tier: 'tier_4_full_concierge',
    driversRequired: 2,
    assignments: [
      { role: 'primary', drivesMemberVehicle: true, carriesPassenger: false, description: "Drive the member's vehicle from the pickup location" },
      { role: 'chase', drivesMemberVehicle: false, carriesPassenger: true, description: 'Drive the member from the pickup location' },
    ],
    description: "One driver picks up the member's car, the other picks up the member. Both return.",
    shortDescription: 'Full concierge pickup',
  },
  full_concierge_round_trip: {
    tier: 'tier_4_full_concierge',
    driversRequired: 2,
    assignments: [
      { role: 'primary', drivesMemberVehicle: true, carriesPassenger: false, description: "Drive the member's vehicle for the full round trip" },
      { role: 'chase', drivesMemberVehicle: false, carriesPassenger: true, description: 'Drive the member for the full round trip' },
    ],
    description: "The ultimate: both drivers handle the full round trip — one with the car, one with the member.",
    shortDescription: 'Full concierge round trip',
  },
};

/**
 * Get the tier pricing display
 */
export function getTierPricing(tier: RideTier): { base: number; perMile: number; minimum: number } {
  const pricing: Record<RideTier, { base: number; perMile: number; minimum: number }> = {
    tier_1_passenger: { base: 10, perMile: 1.50, minimum: 12 },
    tier_2_vehicle_solo: { base: 20, perMile: 2.00, minimum: 25 },
    tier_3_vehicle_paired: { base: 35, perMile: 2.50, minimum: 40 },
    tier_4_full_concierge: { base: 40, perMile: 3.00, minimum: 45 },
  };
  return pricing[tier];
}
