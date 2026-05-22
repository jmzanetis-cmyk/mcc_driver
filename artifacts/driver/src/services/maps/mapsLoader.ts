import { Loader } from '@googlemaps/js-api-loader';

let _loader: Loader | null = null;

export function getMapsLoader(): Loader | null {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  if (!_loader) {
    _loader = new Loader({ apiKey, version: 'weekly', libraries: [] });
  }
  return _loader;
}

export async function loadMapsApi(): Promise<boolean> {
  const loader = getMapsLoader();
  if (!loader) return false;
  try {
    await loader.load();
    return true;
  } catch {
    return false;
  }
}
