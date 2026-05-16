import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  useListAdminRides,
  getListAdminRidesQueryKey,
  useAdminCancelRide,
} from '@workspace/api-client-react';
import type { AdminRideRecord } from '@workspace/api-client-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  Plus,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const ALL_STATUS_SENTINEL = 'all';
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'dispatch_failed']);

// ── Scenario catalog for the dispatch form ────────────────────────────────────
type ServiceType = 'concierge' | 'rideshare' | 'delivery';

const SCENARIOS_BY_SERVICE: Record<ServiceType, Array<{ value: string; label: string; tier: string }>> = {
  rideshare: [
    { value: 'rideshare_ondemand', label: 'On-Demand Ride', tier: 'tier_0_rideshare' },
    { value: 'rideshare_scheduled', label: 'Scheduled Ride', tier: 'tier_0_rideshare' },
  ],
  delivery: [
    { value: 'delivery_parcel', label: 'Parcel Delivery', tier: 'tier_0_delivery' },
    { value: 'delivery_food', label: 'Food Delivery', tier: 'tier_0_delivery' },
  ],
  concierge: [
    { value: 'member_dropoff', label: 'Passenger Drop-Off', tier: 'tier_1_passenger' },
    { value: 'member_pickup', label: 'Passenger Pick-Up', tier: 'tier_1_passenger' },
    { value: 'passenger_round_trip', label: 'Passenger Round Trip', tier: 'tier_1_passenger' },
    { value: 'vehicle_delivery_solo', label: 'Vehicle Delivery', tier: 'tier_2_vehicle_solo' },
    { value: 'vehicle_pickup_solo', label: 'Vehicle Pickup', tier: 'tier_2_vehicle_solo' },
    { value: 'paired_vehicle_delivery', label: 'Paired Vehicle Delivery', tier: 'tier_3_vehicle_paired' },
    { value: 'paired_vehicle_pickup', label: 'Paired Vehicle Pickup', tier: 'tier_3_vehicle_paired' },
    { value: 'concierge_dropoff', label: 'Concierge Drop-Off', tier: 'tier_4_full_concierge' },
    { value: 'concierge_pickup', label: 'Concierge Pick-Up', tier: 'tier_4_full_concierge' },
    { value: 'full_concierge_round_trip', label: 'Full Concierge Round Trip', tier: 'tier_4_full_concierge' },
  ],
};

// ── Dispatch dialog ───────────────────────────────────────────────────────────

const BLANK_FORM = {
  serviceType: 'concierge' as ServiceType,
  scenario: '',
  tier: '',
  pickupAddress: '',
  pickupLat: '',
  pickupLng: '',
  dropoffAddress: '',
  dropoffLat: '',
  dropoffLng: '',
  estimatedDistanceMiles: '',
  packageDescription: '',
  memberName: '',
  memberPhone: '',
};

function DispatchDialog({ onDispatched }: { onDispatched: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });

  const dispatch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/admin/rides/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Ride dispatched', description: 'Drivers are being notified.' });
      setOpen(false);
      setForm({ ...BLANK_FORM });
      onDispatched();
    },
    onError: (err: Error) => {
      toast({ title: 'Dispatch failed', description: err.message, variant: 'destructive' });
    },
  });

  const scenarios = SCENARIOS_BY_SERVICE[form.serviceType];
  const selectedScenario = scenarios.find((s) => s.value === form.scenario);

  function setField<K extends keyof typeof BLANK_FORM>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleServiceTypeChange(val: string) {
    setForm((f) => ({ ...f, serviceType: val as ServiceType, scenario: '', tier: '' }));
  }

  function handleScenarioChange(val: string) {
    const s = SCENARIOS_BY_SERVICE[form.serviceType].find((x) => x.value === val);
    setForm((f) => ({ ...f, scenario: val, tier: s?.tier ?? '' }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const dist = parseFloat(form.estimatedDistanceMiles);
    const lat1 = parseFloat(form.pickupLat);
    const lng1 = parseFloat(form.pickupLng);
    const lat2 = parseFloat(form.dropoffLat);
    const lng2 = parseFloat(form.dropoffLng);
    if (!form.scenario || !form.tier || !form.pickupAddress || !form.dropoffAddress ||
        isNaN(dist) || isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) {
      toast({ title: 'Missing fields', description: 'Please fill all required fields.', variant: 'destructive' });
      return;
    }
    dispatch.mutate({
      scenario: form.scenario,
      tier: form.tier,
      serviceType: form.serviceType,
      packageDescription: form.serviceType === 'delivery' ? form.packageDescription || undefined : undefined,
      pickupAddress: form.pickupAddress,
      pickupLat: lat1,
      pickupLng: lng1,
      dropoffAddress: form.dropoffAddress,
      dropoffLat: lat2,
      dropoffLng: lng2,
      estimatedDistanceMiles: dist,
      memberName: form.memberName.trim() || undefined,
      memberPhone: form.memberPhone.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-dispatch-ride">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Dispatch Ride
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dispatch a Ride</DialogTitle>
          <DialogDescription>
            Create a new ride and send it to eligible drivers.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Service type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Service Type</Label>
              <Select value={form.serviceType} onValueChange={handleServiceTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="concierge">🎩 Concierge</SelectItem>
                  <SelectItem value="rideshare">🚗 Rideshare</SelectItem>
                  <SelectItem value="delivery">📦 Delivery</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scenario</Label>
              <Select value={form.scenario} onValueChange={handleScenarioChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {scenarios.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedScenario && (
                <p className="text-xs text-muted-foreground">{selectedScenario.tier}</p>
              )}
            </div>
          </div>

          {/* Package description (delivery only) */}
          {form.serviceType === 'delivery' && (
            <div className="space-y-1.5">
              <Label>Package Description</Label>
              <Textarea
                placeholder="e.g. 2 pizza boxes, handle with care"
                value={form.packageDescription}
                onChange={(e) => setField('packageDescription', e.target.value)}
                rows={2}
              />
            </div>
          )}

          {/* Member contact (optional) */}
          <div className="space-y-1.5">
            <Label>Member (optional)</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Name" value={form.memberName}
                onChange={(e) => setField('memberName', e.target.value)}
                data-testid="input-member-name" />
              <Input placeholder="Phone (e.g. +15125550123)" type="tel"
                value={form.memberPhone}
                onChange={(e) => setField('memberPhone', e.target.value)}
                data-testid="input-member-phone" />
            </div>
            <p className="text-xs text-muted-foreground">
              When provided, the member is texted directly if a ride-along match needs their approval.
            </p>
          </div>

          {/* Pickup */}
          <div className="space-y-1.5">
            <Label>Pickup Address</Label>
            <Input placeholder="123 Main St, Austin, TX"
              value={form.pickupAddress} onChange={(e) => setField('pickupAddress', e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Lat (e.g. 30.267)" type="number" step="any"
                value={form.pickupLat} onChange={(e) => setField('pickupLat', e.target.value)} />
              <Input placeholder="Lng (e.g. -97.743)" type="number" step="any"
                value={form.pickupLng} onChange={(e) => setField('pickupLng', e.target.value)} />
            </div>
          </div>

          {/* Dropoff */}
          <div className="space-y-1.5">
            <Label>Dropoff Address</Label>
            <Input placeholder="456 Oak Ave, Austin, TX"
              value={form.dropoffAddress} onChange={(e) => setField('dropoffAddress', e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Lat" type="number" step="any"
                value={form.dropoffLat} onChange={(e) => setField('dropoffLat', e.target.value)} />
              <Input placeholder="Lng" type="number" step="any"
                value={form.dropoffLng} onChange={(e) => setField('dropoffLng', e.target.value)} />
            </div>
          </div>

          {/* Distance */}
          <div className="space-y-1.5">
            <Label>Estimated Distance (miles)</Label>
            <Input placeholder="e.g. 5.2" type="number" step="0.1" min="0"
              value={form.estimatedDistanceMiles}
              onChange={(e) => setField('estimatedDistanceMiles', e.target.value)} />
            {form.tier && (
              <p className="text-xs text-muted-foreground">
                Fare is calculated server-side from the published rate card for {form.tier}.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={dispatch.isPending}>
              {dispatch.isPending ? 'Dispatching…' : 'Dispatch Ride'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
    rideshare_ondemand: 'On-Demand Ride',
    rideshare_scheduled: 'Scheduled Ride',
    delivery_parcel: 'Parcel Delivery',
    delivery_food: 'Food Delivery',
    standard: 'Standard',
    member_drive: 'Member Drive',
    tandem: 'Tandem',
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
  return map[scenario] ?? scenario;
}

function serviceTypeBadge(serviceType: string | null | undefined) {
  if (serviceType === 'rideshare') {
    return <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-blue-200">🚗 Rideshare</Badge>;
  }
  if (serviceType === 'delivery') {
    return <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700 border-orange-200">📦 Delivery</Badge>;
  }
  return <Badge variant="outline" className="text-xs text-muted-foreground">Concierge</Badge>;
}

function RideRow({ ride, onCancel }: { ride: AdminRideRecord; onCancel: (id: string) => void }) {
  const cancellable = CANCELLABLE_STATUSES.has(ride.status);
  return (
    <TableRow data-testid={`row-ride-${ride.id}`}>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {ride.id.slice(0, 8)}…
      </TableCell>
      <TableCell className="text-sm">
        <div className="flex flex-col gap-1">
          <span>{scenarioLabel(ride.scenario)}</span>
          {serviceTypeBadge(ride.serviceType)}
        </div>
      </TableCell>
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
          <div className="flex items-center gap-2">
            <DispatchDialog onDispatched={() => queryClient.invalidateQueries({ queryKey: getListAdminRidesQueryKey() })} />
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
