import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  useListAdminDrivers,
  getListAdminDriversQueryKey,
  useApproveDriver,
} from '@workspace/api-client-react';
import type { AdminDriverRecord } from '@workspace/api-client-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, LogOut, Search, CheckCircle, XCircle, Eye, ShieldOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const STATUS_OPTIONS = [
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'pending_approval') return 'secondary';
  if (status === 'inactive' || status === 'suspended') return 'destructive';
  return 'outline';
}

export default function Drivers() {
  const [, setLocation] = useLocation();
  const { signOut } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('pending_approval');
  const [search, setSearch] = useState('');

  const { data: drivers, isLoading, isError, error } = useListAdminDrivers(
    { status: statusFilter },
    { query: { queryKey: getListAdminDriversQueryKey({ status: statusFilter }) } },
  );

  const isAuthError = isError && error instanceof Error && (
    error.message === 'Unauthorized' ||
    error.message === 'Forbidden' ||
    /\b(401|403)\b/.test(error.message)
  );

  const approveDriver = useApproveDriver({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Driver approved', description: 'Driver status set to active.' });
        queryClient.invalidateQueries({ queryKey: getListAdminDriversQueryKey({ status: statusFilter }) });
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

  const handleApprove = (driverId: string) => {
    approveDriver.mutate({ driverId });
  };

  const handleReject = (driverId: string) => {
    setLocation(`/drivers/${driverId}`);
  };

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try {
      return format(new Date(iso), 'MMM d, yyyy');
    } catch {
      return '—';
    }
  };

  if (isAuthError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 text-center">
        <ShieldOff className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-xl font-bold mb-2">Access Denied</h1>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          Your account does not have admin permissions. Please sign in with an authorized admin account.
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
            className="px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary"
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
            onClick={() => setLocation('/rides')}
            className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
          >
            Rides
          </button>
        </div>

        {/* Page title + summary */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Driver Applications</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Review submitted applications and manage driver statuses
            </p>
          </div>
          {!isLoading && (
            <div className="text-right">
              <span className="text-2xl font-bold tabular-nums" data-testid="text-driver-count">
                {filtered.length}
              </span>
              <p className="text-xs text-muted-foreground">
                {statusFilter === 'pending_approval' ? 'pending review' : 'drivers'}
              </p>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or phone..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} data-testid={`option-status-${opt.value}`}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Error state */}
        {isError && (
          <Alert variant="destructive" data-testid="alert-load-error">
            <AlertDescription>
              {error instanceof Error ? error.message : 'Failed to load drivers'}
            </AlertDescription>
          </Alert>
        )}

        {/* Table */}
        <div className="border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="font-semibold">Driver</TableHead>
                <TableHead className="font-semibold">Contact</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Documents</TableHead>
                <TableHead className="font-semibold">Applied</TableHead>
                <TableHead className="font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No drivers found
                    {search && ' matching your search'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((driver: AdminDriverRecord) => (
                  <TableRow
                    key={driver.id}
                    className="hover:bg-muted/30 cursor-pointer"
                    data-testid={`row-driver-${driver.id}`}
                    onClick={() => setLocation(`/drivers/${driver.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium">
                        {driver.firstName} {driver.lastName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{driver.email}</div>
                      <div className="text-xs text-muted-foreground">{driver.phone}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(driver.status)} data-testid={`status-${driver.id}`}>
                        {driver.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5 text-xs">
                        <span
                          className={`px-1.5 py-0.5 rounded font-medium ${
                            driver.licenseDocumentPath
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          License
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-medium ${
                            driver.insuranceDocumentPath
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLocation(`/drivers/${driver.id}`)}
                          data-testid={`button-view-${driver.id}`}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          View
                        </Button>
                        {driver.status === 'pending_approval' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              onClick={() => handleApprove(driver.id)}
                              disabled={approveDriver.isPending}
                              data-testid={`button-approve-${driver.id}`}
                            >
                              <CheckCircle className="w-3.5 h-3.5 mr-1" />
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleReject(driver.id)}
                              data-testid={`button-reject-${driver.id}`}
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
      </main>
    </div>
  );
}
