// ============================================================
// MCC Driver — Utility Functions
// ============================================================

/**
 * Format currency
 */
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Format distance
 */
export function formatDistance(miles: number): string {
  if (miles < 0.1) return '< 0.1 mi';
  return `${miles.toFixed(1)} mi`;
}

/**
 * Format duration in minutes to human-readable
 */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

/**
 * Format elapsed time from a start timestamp
 */
export function formatElapsed(startedAt: string): string {
  const started = new Date(startedAt).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - started) / 1000);

  if (seconds < 60) return `0:${seconds.toString().padStart(2, '0')}`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}:${secs.toString().padStart(2, '0')}`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}:${remainMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format time for display (e.g., "2:30 PM")
 */
export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format date for display (e.g., "May 13")
 */
export function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format date and time
 */
export function formatDateTime(isoString: string): string {
  return `${formatDate(isoString)} at ${formatTime(isoString)}`;
}

/**
 * Get human-readable scenario name
 */
export function getScenarioLabel(scenario: string): string {
  const labels: Record<string, string> = {
    member_dropoff: 'Passenger Drop-Off',
    member_pickup: 'Passenger Pick-Up',
    passenger_round_trip: 'Passenger Round Trip',
    vehicle_delivery_solo: 'Vehicle Delivery',
    vehicle_pickup_solo: 'Vehicle Pickup',
    paired_vehicle_delivery: 'Paired Vehicle Delivery',
    paired_vehicle_pickup: 'Paired Vehicle Pickup',
    paired_round_trip_shuttle: 'Paired Round Trip',
    concierge_dropoff: 'Concierge Drop-Off',
    concierge_pickup: 'Concierge Pick-Up',
    full_concierge_round_trip: 'Full Concierge Round Trip',
  };
  return labels[scenario] || scenario;
}

/**
 * Get tier display name
 */
export function getTierLabel(tier: string): string {
  const labels: Record<string, string> = {
    tier_1_passenger: 'Passenger Ride',
    tier_2_vehicle_solo: 'Vehicle Shuttle',
    tier_3_vehicle_paired: 'Paired Shuttle',
    tier_4_full_concierge: 'Full Concierge',
  };
  return labels[tier] || tier;
}

/**
 * Get role display text for the driver
 */
export function getRoleDescription(
  role: 'primary' | 'chase',
  drivesMemberVehicle: boolean,
  carriesPassenger: boolean,
  vehicleDescription?: string
): string {
  if (drivesMemberVehicle && carriesPassenger) {
    return `Drive member's ${vehicleDescription || 'vehicle'} with member`;
  }
  if (drivesMemberVehicle) {
    return `Drive member's ${vehicleDescription || 'vehicle'}`;
  }
  if (carriesPassenger) {
    return 'Drive member in your vehicle';
  }
  if (role === 'chase') {
    return 'Follow in chase vehicle';
  }
  return 'Passenger ride';
}

/**
 * Get star rating display
 */
export function getStarDisplay(rating: number): string {
  return '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
}

/**
 * Calculate seconds remaining until a deadline
 */
export function getSecondsRemaining(deadline: string): number {
  const remaining = (new Date(deadline).getTime() - Date.now()) / 1000;
  return Math.max(0, Math.floor(remaining));
}

/**
 * Shorten an address for display
 */
export function shortenAddress(address: string, maxLength: number = 35): string {
  if (address.length <= maxLength) return address;
  // Try to cut at a comma
  const commaIndex = address.indexOf(',');
  if (commaIndex > 0 && commaIndex <= maxLength) {
    return address.substring(0, commaIndex);
  }
  return address.substring(0, maxLength - 3) + '...';
}
