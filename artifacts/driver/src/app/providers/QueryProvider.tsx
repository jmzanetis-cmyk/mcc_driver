// ============================================================
// MCC Driver — Query Provider (TanStack Query)
// ============================================================
// Network-resilient defaults so dropped signal in a parking
// garage doesn't leave drivers staring at stuck spinners:
//
//   - retry: 2 with exponential backoff (cap 8 s) so a transient
//     failure recovers automatically without hammering the API.
//   - retryOnMount: true — if a cached query previously errored,
//     refetch when the component mounts again.
//   - refetchOnReconnect: true — when the browser / Capacitor
//     reports back online, all stale queries refetch immediately.
//   - networkMode: 'offlineFirst' — render whatever we have
//     cached while offline instead of holding the spinner; the
//     UI's OfflineBanner is the user-visible signal.
//
// Mutations get the same retry/reconnect treatment so a
// momentary blip doesn't drop a ride accept or settings save.
// ============================================================

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8000),
      retryOnMount: true,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 1,
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8000),
      networkMode: 'offlineFirst',
    },
  },
});

export function QueryProvider({ children }: React.PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

export { queryClient };
