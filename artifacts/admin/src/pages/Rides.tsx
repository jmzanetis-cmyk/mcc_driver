import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  useListAdminRides,
  getListAdminRidesQueryKey,
  useAdminCancelRide,
} from '@workspace/api-client-react';
import type { AdminRideRecord } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ShieldCheck,
  LogOut,
  Search,
  XCircle,
  RefreshCw,
  Car,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const ALL_STATUS_SENTINEL = 'all';
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'dispatch_failed']);

const STATUS_OPTIONS = [
  { value: ALL_STATUS_SENTINEL, label: 'All statuses' },
  { value: 'pending_dispatch', label: 'Pending Dispatch' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'driver_accepted', label: 'Driver Accepted' },
  { value: 'driver_en_route', label: 'Driver En Route' },
  { value: 'driver_arrived', label: 'Driver Arrived' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'dispatch_failed', label: 'Dispatch Failed' },
];

const CANCELLABLE_STATUSES = new Set([
  'pending_dispatch',
  'dispatched',
  'driver_accepted',
  'driver_en_route',
  'driver_arrived',
  'in_progress',
]);

function rideStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default';
  if (['driver_accepted', 'driver_en_route', 'driver_arrived', 'in_progress'].includes(status)) return 'secondary';
  if (status === 'cancelled' || status === 'dispatch_failed') return 'destructive';
  return 'outline';
}

function scenarioLabel(scenario: string): string {
  const map: Record<string, string> = {
    standard: 'Standard',
    member_drive: 'Member Drive',
    tandem: 'Tandem',
  };
  return map[scenario] ?? scenario;
}

function RideRow({ ride, onCancel }: { ride: AdminRideRecord; onCancel: (id: string) => void }) {
  const cancellable = CANCELLABLE_STATUSES.has(ride.status);
  return (
    <TableRow data-testid={`row-ride-${ride.id}`}>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {ride.id.slice(0, 8)}…
      </TableCell>
      <TableCell className="text-sm">{scenarioLabel(ride.scenario)}</TableCell>
      <TableCell>
        <Badge variant={rideStatusVariant(ride.status)} className="capitalize text-xs">
          {ride.status.replace(/_/g, ' ')}
        </Badge>
      </TableCell>
      <TableCell className="text-sm max-w-[180px] truncate" title={ride.pickupAddress}>
        {ride.pickupAddress}
      </TableCell>
      <TableCell className="text-sm text-right tabular-nums">
        ${ride.estimatedFare.toFixed(2)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {ride.createdAt ? format(new Date(ride.createdAt), 'MMM d, h:mm a') : '—'}
      </TableCell>
      <TableCell>
        {cancellable ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                data-testid={`button-cancel-${ride.id}`}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />
                Cancel
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this ride?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will immediately cancel ride{' '}
                  <span className="font-mono">{ride.id.slice(0, 8)}…</span> and notify the
                  assigned driver in real time. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep ride</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => onCancel(ride.id)}
                  data-testid={`button-confirm-cancel-${ride.id}`}
                >
                  Cancel ride
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <span className="text-xs text-muted-foreground px-2">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export default function Rides() {
  const [, setLocation] = useLocation();
  const { signOut } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState(ALL_STATUS_SENTINEL);
  const [search, setSearch] = useState('');

  const activeStatusParam = statusFilter !== ALL_STATUS_SENTINEL ? statusFilter : undefined;

  const { data: rides, isLoading, isError, error, refetch, isFetching } = useListAdminRides(
    activeStatusParam ? { status: activeStatusParam } : {},
    { query: { queryKey: getListAdminRidesQueryKey(activeStatusParam ? { status: activeStatusParam } : {}) } },
  );

  const isAuthError = isError && error instanceof Error && (
    error.message === 'Unauthorized' ||
    error.message === 'Forbidden' ||
    /\b(401|403)\b/.test(error.message)
  );

  const cancelRide = useAdminCancelRide({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: 'Ride cancelled',
          description: `Ride cancelled. ${data.driversNotified} driver(s) notified.`,
        });
        queryClient.invalidateQueries({ queryKey: getListAdminRidesQueryKey() });
      },
      onError: (err) => {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      },
    },
  });

  const handleCancel = (rideId: string) => {
    cancelRide.mutate({ rideId, data: { reason: 'Cancelled by admin' } });
  };

  const filtered = (rides ?? []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.id.toLowerCase().includes(q) ||
      r.pickupAddress.toLowerCase().includes(q) ||
      r.dropoffAddress.toLowerCase().includes(q) ||
      r.scenario.toLowerCase().includes(q)
    );
  });

  if (isAuthError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 text-center">
        <ShieldCheck className="w-10 h-10 text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold mb-1">Not authorized</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-xs">
          Your account does not have admin permissions.
        </p>
        <Button variant="outline" onClick={signOut} data-testid="button-signout-unauthorized">
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="font-semibold text-sm">MCC Admin</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="text-muted-foreground"
            data-testid="button-signout"
          >
            <LogOut className="w-4 h-4 mr-1.5" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Tab navigation */}
        <div className="flex gap-1 border-b">
          <button
            onClick={() => setLocation('/drivers')}
            className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
          >
            MCC Drivers
          </button>
          <button
            onClick={() => setLocation('/ride-along-drivers')}
            className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
          >
            Ride-Along Drivers
          </button>
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary"
          >
            Rides
          </button>
        </div>

        {/* Page title */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Car className="w-5 h-5" />
              Active Rides
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              View and cancel rides in real time
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by ID, pickup, or scenario..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Error */}
        {isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {error?.message ?? 'Failed to load rides'}
            </AlertDescription>
          </Alert>
        )}

        {/* Table */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">ID</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pickup</TableHead>
                <TableHead className="text-right">Fare</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-28">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    No rides found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((ride) => (
                  <RideRow key={ride.id} ride={ride} onCancel={handleCancel} />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!isLoading && filtered.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {filtered.length} ride{filtered.length !== 1 ? 's' : ''}
          </p>
        )}
      </main>
    </div>
  );
}
