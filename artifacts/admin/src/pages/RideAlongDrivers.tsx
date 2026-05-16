import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  useListAdminRideAlongDrivers,
  getListAdminRideAlongDriversQueryKey,
  useApproveRideAlongDriver,
  useRejectRideAlongDriver,
} from '@workspace/api-client-react';
import type { AdminRideAlongDriverRecord } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/services/supabase';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ShieldCheck, LogOut, Search, CheckCircle, XCircle,
  FileText, ExternalLink, ArrowLeft, Star, ShieldOff,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const STATUS_OPTIONS = [
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const DOCUMENT_BUCKET = 'driver-documents';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'pending_approval') return 'secondary';
  if (status === 'inactive') return 'destructive';
  return 'outline';
}

function bgStatusVariant(status: string) {
  if (status === 'passed') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'failed') return 'text-destructive';
  return 'text-muted-foreground';
}

function DocumentLink({ path, label }: { path: string | null | undefined; label: string }) {
  const [isLoading, setIsLoading] = useState(false);

  const handleOpen = async () => {
    if (!path) return;
    if (path.startsWith('http')) { window.open(path, '_blank', 'noopener,noreferrer'); return; }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) {
        const { data: pub } = supabase.storage.from(DOCUMENT_BUCKET).getPublicUrl(path);
        if (pub?.publicUrl) window.open(pub.publicUrl, '_blank', 'noopener,noreferrer');
      } else {
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } finally { setIsLoading(false); }
  };

  if (!path) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/40">
        <FileText className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{label} — not uploaded</span>
      </div>
    );
  }

  return (
    <button
      onClick={handleOpen}
      disabled={isLoading}
      className="w-full flex items-center justify-between gap-2 p-3 rounded-lg border bg-card hover:bg-muted/40 transition-colors text-left group"
    >
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b last:border-0">
      <span className="text-sm text-muted-foreground w-44 shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value ?? '—'}</span>
    </div>
  );
}

function DetailPanel({
  driver,
  onClose,
  onApprove,
  onReject,
  isPending,
}: {
  driver: AdminRideAlongDriverRecord;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
}) {
  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try { return format(new Date(iso), 'MMM d, yyyy'); } catch { return '—'; }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onClose}>
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back
            </Button>
            <h2 className="text-xl font-bold tracking-tight">
              {driver.firstName} {driver.lastName}
            </h2>
            <Badge variant={statusVariant(driver.status)}>
              {driver.status.replace(/_/g, ' ')}
            </Badge>
            {driver.verified && (
              <Badge variant="default" className="bg-emerald-600">Verified</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 ml-[60px]">
            Applied {formatDate(driver.createdAt)}
          </p>
        </div>

        {driver.status === 'pending_approval' && (
          <div className="flex gap-2 shrink-0">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10"
                  disabled={isPending}
                >
                  <XCircle className="w-4 h-4 mr-1.5" />
                  Reject
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reject application?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will set {driver.firstName} {driver.lastName}'s status to inactive.
                    They will not be able to receive Ride-Along jobs.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => onReject(driver.id)}
                  >Reject</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={isPending}>
                  <CheckCircle className="w-4 h-4 mr-1.5" />
                  Approve
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Approve application?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will activate {driver.firstName} {driver.lastName}'s Ride-Along Driver account
                    and set their verified status.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onApprove(driver.id)}>Approve</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Personal Information</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label="Full name" value={`${driver.firstName} ${driver.lastName}`} />
            <InfoRow label="Email" value={driver.email} />
            <InfoRow label="Phone" value={driver.phone} />
            <InfoRow label="ZIP code" value={driver.zipCode} />
            <InfoRow label="Max distance" value={driver.maxDistanceMiles ? `${driver.maxDistanceMiles} mi` : null} />
            <InfoRow label="Application date" value={formatDate(driver.createdAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Verification & Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow
              label="Background check"
              value={
                <span className={bgStatusVariant(driver.backgroundCheckStatus)}>
                  {driver.backgroundCheckStatus.charAt(0).toUpperCase() + driver.backgroundCheckStatus.slice(1)}
                </span>
              }
            />
            <InfoRow label="Verified" value={driver.verified ? '✅ Yes' : '—'} />
            <InfoRow label="License #" value={driver.licenseNumber} />
            <InfoRow label="License state" value={driver.licenseState} />
            <InfoRow label="License expiry" value={driver.licenseExpiry} />
            <InfoRow label="Insurance expiry" value={driver.insuranceExpiry} />
            <InfoRow
              label="Rating"
              value={
                <span className="flex items-center gap-1 justify-end">
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  {driver.rating.toFixed(1)}
                </span>
              }
            />
            <InfoRow label="Total jobs" value={driver.totalJobs} />
            <InfoRow
              label="Agreement signed"
              value={driver.agreementSignedAt ? formatDate(driver.agreementSignedAt) : 'Not signed'}
            />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Submitted Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <DocumentLink path={driver.licenseDocumentPath} label="Driver's License" />
            <DocumentLink path={driver.insuranceDocumentPath} label="Insurance Certificate" />
            <DocumentLink path={driver.profilePhotoPath} label="Profile Photo" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function RideAlongDrivers() {
  const [, setLocation] = useLocation();
  const { signOut } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('pending_approval');
  const [search, setSearch] = useState('');
  const [selectedDriver, setSelectedDriver] = useState<AdminRideAlongDriverRecord | null>(null);

  const { data: drivers, isLoading, isError, error } = useListAdminRideAlongDrivers(
    { status: statusFilter },
    { query: { queryKey: getListAdminRideAlongDriversQueryKey({ status: statusFilter }) } },
  );

  const isAuthError = isError && error instanceof Error && (
    error.message === 'Unauthorized' || error.message === 'Forbidden' ||
    /\b(401|403)\b/.test(error.message)
  );

  const approveDriver = useApproveRideAlongDriver({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Driver approved', description: 'Ride-Along Driver status set to active and verified.' });
        queryClient.invalidateQueries({ queryKey: getListAdminRideAlongDriversQueryKey({ status: statusFilter }) });
        setSelectedDriver(null);
      },
      onError: (err) => {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      },
    },
  });

  const rejectDriver = useRejectRideAlongDriver({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Driver rejected', description: 'Ride-Along Driver status set to inactive.' });
        queryClient.invalidateQueries({ queryKey: getListAdminRideAlongDriversQueryKey({ status: statusFilter }) });
        setSelectedDriver(null);
      },
      onError: (err) => {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      },
    },
  });

  const filtered = (drivers ?? []).filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.firstName.toLowerCase().includes(q) ||
      d.lastName.toLowerCase().includes(q) ||
      d.email.toLowerCase().includes(q) ||
      d.phone.includes(q)
    );
  });

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try { return format(new Date(iso), 'MMM d, yyyy'); } catch { return '—'; }
  };

  if (isAuthError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 text-center">
        <ShieldOff className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-xl font-bold mb-2">Access Denied</h1>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          Your account does not have admin permissions.
        </p>
        <Button variant="outline" onClick={signOut}>
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
            <span className="text-muted-foreground text-sm">·</span>
            <button onClick={() => setLocation('/drivers')} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Drivers
            </button>
            <span className="text-muted-foreground text-sm">/</span>
            <span className="text-sm font-medium">Ride-Along Drivers</span>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
            <LogOut className="w-4 h-4 mr-1.5" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Tab navigation */}
        {!selectedDriver && (
          <div className="flex gap-1 border-b">
            <button
              onClick={() => setLocation('/drivers')}
              className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
            >
              MCC Drivers
            </button>
            <button
              className="px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary"
            >
              Ride-Along Drivers
            </button>
            <button
              onClick={() => setLocation('/rides')}
              className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
            >
              Rides
            </button>
          </div>
        )}

        {selectedDriver ? (
          <DetailPanel
            driver={selectedDriver}
            onClose={() => setSelectedDriver(null)}
            onApprove={(id) => approveDriver.mutate({ id })}
            onReject={(id) => rejectDriver.mutate({ id })}
            isPending={approveDriver.isPending || rejectDriver.isPending}
          />
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold tracking-tight">Ride-Along Driver Applications</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Review Ride-Along Driver applications and manage verification status
                </p>
              </div>
              {!isLoading && (
                <div className="text-right">
                  <span className="text-2xl font-bold tabular-nums">{filtered.length}</span>
                  <p className="text-xs text-muted-foreground">
                    {statusFilter === 'pending_approval' ? 'pending review' : 'drivers'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or phone..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {error instanceof Error ? error.message : 'Failed to load drivers'}
                </AlertDescription>
              </Alert>
            )}

            <div className="border rounded-lg overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-semibold">Driver</TableHead>
                    <TableHead className="font-semibold">Contact</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Background</TableHead>
                    <TableHead className="font-semibold">Documents</TableHead>
                    <TableHead className="font-semibold">Applied</TableHead>
                    <TableHead className="font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                        No Ride-Along Driver applications found
                        {search && ' matching your search'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((driver: AdminRideAlongDriverRecord) => (
                      <TableRow
                        key={driver.id}
                        className="hover:bg-muted/30 cursor-pointer"
                        onClick={() => setSelectedDriver(driver)}
                      >
                        <TableCell>
                          <div className="font-medium">{driver.firstName} {driver.lastName}</div>
                          {driver.verified && (
                            <div className="text-xs text-emerald-600 mt-0.5">✓ Verified</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{driver.email}</div>
                          <div className="text-xs text-muted-foreground">{driver.phone}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(driver.status)}>
                            {driver.status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium ${bgStatusVariant(driver.backgroundCheckStatus)}`}>
                            {driver.backgroundCheckStatus}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1.5 text-xs">
                            <span className={`px-1.5 py-0.5 rounded font-medium ${driver.licenseDocumentPath ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                              License
                            </span>
                            <span className={`px-1.5 py-0.5 rounded font-medium ${driver.insuranceDocumentPath ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                              Insurance
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(driver.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div
                            className="flex items-center justify-end gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {driver.status === 'pending_approval' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                  onClick={() => approveDriver.mutate({ id: driver.id })}
                                  disabled={approveDriver.isPending}
                                >
                                  <CheckCircle className="w-3.5 h-3.5 mr-1" />
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => rejectDriver.mutate({ id: driver.id })}
                                  disabled={rejectDriver.isPending}
                                >
                                  <XCircle className="w-3.5 h-3.5 mr-1" />
                                  Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
