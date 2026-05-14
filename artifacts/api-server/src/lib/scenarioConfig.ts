// ============================================================
// MCC API — Scenario Configuration
// ============================================================
// Server-side mirror of the frontend ride scenario definitions.
// Used when dispatching rides to determine required driver roles.
// ============================================================

interface DriverAssignment {
  role: "primary" | "chase";
  drivesMemberVehicle: boolean;
  carriesPassenger: boolean;
  description: string;
}

interface ScenarioConfig {
  tier: string;
  driversRequired: 1 | 2;
  assignments: DriverAssignment[];
  description: string;
}

export const SCENARIO_CONFIG: Record<string, ScenarioConfig> = {
  // ── Tier 1: Passenger ──
  member_dropoff: {
    tier: "tier_1_passenger",
    driversRequired: 1,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: false,
        carriesPassenger: true,
        description: "Drive member in your vehicle to their destination",
      },
    ],
    description: "Drive the member to their drop-off location.",
  },
  member_pickup: {
    tier: "tier_1_passenger",
    driversRequired: 1,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: false,
        carriesPassenger: true,
        description: "Pick up the member and drive them in your vehicle",
      },
    ],
    description: "Pick the member up from a location and drive them.",
  },
  passenger_round_trip: {
    tier: "tier_1_passenger",
    driversRequired: 1,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: false,
        carriesPassenger: true,
        description: "Drive member round trip, wait at destination",
      },
    ],
    description: "Drive the member to a destination, wait, and bring them back.",
  },

  // ── Tier 2: Vehicle Solo ──
  vehicle_delivery_solo: {
    tier: "tier_2_vehicle_solo",
    driversRequired: 1,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: true,
        carriesPassenger: false,
        description: "Drive the member's vehicle to its destination",
      },
    ],
    description: "Deliver the member's vehicle. No passenger.",
  },
  vehicle_pickup_solo: {
    tier: "tier_2_vehicle_solo",
    driversRequired: 1,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: true,
        carriesPassenger: false,
        description: "Pick up the member's vehicle and drive it to them",
      },
    ],
    description: "Pick up the member's vehicle from a shop or location and return it.",
  },

  // ── Tier 3: Vehicle Paired ──
  paired_vehicle_delivery: {
    tier: "tier_3_vehicle_paired",
    driversRequired: 2,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: true,
        carriesPassenger: false,
        description: "Drive the member's vehicle to its destination",
      },
      {
        role: "chase",
        drivesMemberVehicle: false,
        carriesPassenger: false,
        description: "Follow in chase vehicle, pick up primary driver after delivery",
      },
    ],
    description: "Two drivers: one drives the member's vehicle, chase driver follows.",
  },
  paired_vehicle_pickup: {
    tier: "tier_3_vehicle_paired",
    driversRequired: 2,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: true,
        carriesPassenger: false,
        description: "Pick up and drive the member's vehicle back",
      },
      {
        role: "chase",
        drivesMemberVehicle: false,
        carriesPassenger: false,
        description: "Drop off primary driver at vehicle, then follow back",
      },
    ],
    description: "Chase drops primary at the vehicle location, primary drives it back.",
  },
  paired_round_trip_shuttle: {
    tier: "tier_3_vehicle_paired",
    driversRequired: 2,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: true,
        carriesPassenger: false,
        description: "Drive the member's vehicle round trip",
      },
      {
        role: "chase",
        drivesMemberVehicle: false,
        carriesPassenger: false,
        description: "Follow both legs in chase vehicle",
      },
    ],
    description: "Full round-trip vehicle shuttle with a chase driver for both legs.",
  },

  // ── Tier 4: Full Concierge ──
  concierge_dropoff: {
    tier: "tier_4_full_concierge",
    driversRequired: 2,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: true,
        carriesPassenger: false,
        description: "Drive the member's vehicle to the destination",
      },
      {
        role: "chase",
        drivesMemberVehicle: false,
        carriesPassenger: true,
        description: "Drive the member in chase vehicle to the destination",
      },
    ],
    description: "One driver takes the member's car, the other takes the member.",
  },
  concierge_pickup: {
    tier: "tier_4_full_concierge",
    driversRequired: 2,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: true,
        carriesPassenger: false,
        description: "Drive the member's vehicle from the pickup location",
      },
      {
        role: "chase",
        drivesMemberVehicle: false,
        carriesPassenger: true,
        description: "Drive the member from the pickup location",
      },
    ],
    description: "One driver picks up the member's car, the other picks up the member.",
  },
  full_concierge_round_trip: {
    tier: "tier_4_full_concierge",
    driversRequired: 2,
    assignments: [
      {
        role: "primary",
        drivesMemberVehicle: true,
        carriesPassenger: false,
        description: "Drive the member's vehicle for the full round trip",
      },
      {
        role: "chase",
        drivesMemberVehicle: false,
        carriesPassenger: true,
        description: "Drive the member for the full round trip",
      },
    ],
    description: "Both drivers handle the full round trip.",
  },
};
