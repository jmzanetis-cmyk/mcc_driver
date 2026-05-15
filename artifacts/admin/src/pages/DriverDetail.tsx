import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  useListAdminDrivers,
  getListAdminDriversQueryKey,
  useApproveDriver,
  useRejectDriver,
} from '@workspace/api-client-react';
import type { AdminDriverRecord } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/services/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
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
import {
  ArrowLeft,
  ShieldCheck,
  LogOut,
  CheckCircle,
  XCircle,
  ExternalLink,
  FileText,
  User,
  Star,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'pending_approval') return 'secondary';
  if (status === 'inactive' || status === 'suspended') return 'destructive';
  return 'outline';
}

const DOCUMENT_BUCKET = 'driver-documents';

function DocumentLink({ path, label }: { path: string | null | undefined; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleOpen = async () => {
    if (!path) return;

    // If already a full URL, open directly
    if (path.startsWith('http')) {
      window.open(path, '_blank', 'noopener,noreferrer');
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrl(path, 3600);

      if (error || !data?.signedUrl) {
        // Fallback: try public URL
        const { data: publicData } = supabase.storage
          .from(DOCUMENT_BUCKET)
          .getPublicUrl(path);
        if (publicData?.publicUrl) {
          window.open(publicData.publicUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        setUrl(data.signedUrl);
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setIsLoading(false);
    }
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
      data-testid={`button-doc-${label.toLowerCase().replace(/\s+/g, '-')}`}
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
      <span className="text-sm text-muted-foreground w-40 shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value ?? '—'}</span>
    </div>
  );
}

export default function DriverDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { signOut } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all statuses to find the driver by ID
  const { data: pendingDrivers, isLoading: pendingLoading } = useListAdminDrivers(
    { status: 'pending_approval' },
    { query: { queryKey: getListAdminDriversQueryKey({ status: 'pending_approval' }) } },
  );
  const { data: activeDrivers, isLoading: activeLoading } = useListAdminDrivers(
    { status: 'active' },
    { query: { queryKey: getListAdminDriversQueryKey({ status: 'active' }) } },
  );
  const { data: inactiveDrivers, isLoading: inactiveLoading } = useListAdminDrivers(
    { status: 'inactive' },
    { query: { queryKey: getListAdminDriversQueryKey({ status: 'inactive' }) } },
  );

  const isLoading = pendingLoading || activeLoading || inactiveLoading;

  const driver: AdminDriverRecord | undefined = [
    ...(pendingDrivers ?? []),
    ...(activeDrivers ?? []),
    ...(inactiveDrivers ?? []),
  ].find((d) => d.id === id);

  const approveDriver = useApproveDriver({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Driver approved', description: 'Driver status set to active.' });
        queryClient.invalidateQueries({ queryKey: getListAdminDriversQueryKey() });
        setLocation('/drivers');
      },
      onError: (err) => {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      },
    },
  });

  const rejectDriver = useRejectDriver({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Driver rejected', description: 'Driver status set to inactive.' });
        queryClient.invalidateQueries({ queryKey: getListAdminDriversQueryKey() });
        setLocation('/drivers');
      },
      onError: (err) => {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      },
    },
  });

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try {
      return format(new Date(iso), 'MMM d, yyyy');
    } catch {
      return '—';
    }
  };

  const isPending = approveDriver.isPending || rejectDriver.isPending;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/drivers')}
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back
            </Button>
            <div className="flex items-center gap-2 pl-2 border-l">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary text-primary-foreground">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm">MCC Admin</span>
            </div>
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          </div>
        ) : !driver ? (
          <div className="text-center py-16 text-muted-foreground">
            <User className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Driver not found</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Title bar */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold tracking-tight" data-testid="text-driver-name">
                    {driver.firstName} {driver.lastName}
                  </h1>
                  <Badge variant={statusVariant(driver.status)} data-testid="status-badge">
                    {driver.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
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
                        data-testid="button-reject"
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
                          They will not be able to receive rides.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => rejectDriver.mutate({ driverId: driver.id })}
                          data-testid="button-confirm-reject"
                        >
                          Reject
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={isPending}
                        data-testid="button-approve"
                      >
                        <CheckCircle className="w-4 h-4 mr-1.5" />
                        Approve
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Approve application?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will activate {driver.firstName} {driver.lastName}'s account.
                          They will be able to go online and receive ride requests.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => approveDriver.mutate({ driverId: driver.id })}
                          data-testid="button-confirm-approve"
                        >
                          Approve
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Personal info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Personal Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <InfoRow label="Full name" value={`${driver.firstName} ${driver.lastName}`} />
                  <InfoRow label="Email" value={driver.email} />
                  <InfoRow label="Phone" value={driver.phone} />
                  <InfoRow label="Application date" value={formatDate(driver.createdAt)} />
                </CardContent>
              </Card>

              {/* Account capabilities */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Capabilities & Stats</CardTitle>
                </CardHeader>
                <CardContent>
                  <InfoRow
                    label="Background check"
                    value={
                      <span className={driver.backgroundCheckPassed ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>
                        {driver.backgroundCheckPassed ? 'Passed' : 'Not verified'}
                      </span>
                    }
                  />
                  <InfoRow
                    label="Drive member vehicle"
                    value={driver.canDriveMemberVehicle ? 'Authorized' : 'Not authorized'}
                  />
                  <InfoRow
                    label="Rides completed"
                    value={driver.totalRidesCompleted}
                  />
                  <InfoRow
                    label="Average rating"
                    value={
                      <span className="flex items-center gap-1 justify-end">
                        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                        {driver.averageRating.toFixed(1)}
                      </span>
                    }
                  />
                </CardContent>
              </Card>

              {/* Documents */}
              <Card className="md:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Submitted Documents</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  <DocumentLink path={driver.licenseDocumentPath} label="Driver's License" />
                  <DocumentLink path={driver.insuranceDocumentPath} label="Insurance Certificate" />
                  {driver.profilePhotoUrl && (
                    <DocumentLink path={driver.profilePhotoUrl} label="Profile Photo" />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
