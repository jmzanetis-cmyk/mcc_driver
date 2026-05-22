import { loadMapsApi } from '@/services/maps/mapsLoader';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteResult {
  polyline: LatLng[];
  etaMinutes: number;
  distanceMeters: number;
}

export async function fetchRoute(
  origin: LatLng,
  destination: LatLng,
): Promise<RouteResult | null> {
  const loaded = await loadMapsApi();
  if (!loaded) return null;

  return new Promise((resolve) => {
    const svc = new google.maps.DirectionsService();
    svc.route(
      {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status !== google.maps.DirectionsStatus.OK || !result?.routes[0]) {
          resolve(null);
          return;
        }
        const route = result.routes[0];
        const leg = route.legs[0];
        const polyline = route.overview_path.map((p) => ({
          lat: p.lat(),
          lng: p.lng(),
        }));
        resolve({
          polyline,
          etaMinutes: Math.round((leg.duration?.value ?? 0) / 60),
          distanceMeters: leg.distance?.value ?? 0,
        });
      },
    );
  });
}
