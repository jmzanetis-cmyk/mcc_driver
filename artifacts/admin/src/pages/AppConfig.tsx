import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/services/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { ShieldCheck, LogOut, AlertTriangle, RefreshCw } from 'lucide-react';

interface AppConfig {
  id: string;
  minSupportedVersion: string;
  latestVersion: string;
  outageMessage: string | null;
  appStoreUrl: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

const apiBase = (import.meta.env.BASE_URL as string).replace(/\/+$/, '');

async function authedFetch(path: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function AppConfigPage() {
  const [, setLocation] = useLocation();
  const { signOut } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [form, setForm] = useState({
    minSupportedVersion: '',
    latestVersion: '',
    outageMessage: '',
    appStoreUrl: '',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/admin/app-config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AppConfig;
      setCfg(data);
      setForm({
        minSupportedVersion: data.minSupportedVersion,
        latestVersion: data.latestVersion,
        outageMessage: data.outageMessage ?? '',
        appStoreUrl: data.appStoreUrl ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load app config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string | null> = {
        minSupportedVersion: form.minSupportedVersion.trim(),
        latestVersion: form.latestVersion.trim(),
        outageMessage: form.outageMessage.trim() === '' ? null : form.outageMessage.trim(),
        appStoreUrl: form.appStoreUrl.trim() === '' ? null : form.appStoreUrl.trim(),
      };
      const res = await authedFetch('/admin/app-config', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`HTTP ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as AppConfig;
      setCfg(data);
      toast({ title: 'App config saved', description: 'Clients will pick up changes within ~60s.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      toast({ title: 'Save failed', description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleClearOutage = () => {
    setForm((f) => ({ ...f, outageMessage: '' }));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm">MCC Admin</span>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut} data-testid="button-sign-out">
            <LogOut className="w-4 h-4 mr-1.5" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
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
            onClick={() => setLocation('/rides')}
            className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
          >
            Rides
          </button>
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary"
          >
            App Config
          </button>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">App Config (Kill Switch)</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Controls the driver app's forced-update screen and outage banner. Changes
              propagate to clients within ~60s (client cache + server cache).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Reload
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-5 rounded-lg border p-5 bg-card">
            <div className="space-y-2">
              <Label htmlFor="min-version">Minimum supported version</Label>
              <Input
                id="min-version"
                placeholder="e.g. 1.2.0"
                value={form.minSupportedVersion}
                onChange={(e) => setForm({ ...form, minSupportedVersion: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Drivers running below this version see a blocking "Update" screen on launch.
                Use semver (MAJOR.MINOR.PATCH).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="latest-version">Latest released version</Label>
              <Input
                id="latest-version"
                placeholder="e.g. 1.3.1"
                value={form.latestVersion}
                onChange={(e) => setForm({ ...form, latestVersion: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Informational. Surfaced to clients for future "update available" nudges.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="app-store-url">App Store listing URL</Label>
              <Input
                id="app-store-url"
                placeholder="https://apps.apple.com/app/idXXXXXXXXXX"
                value={form.appStoreUrl}
                onChange={(e) => setForm({ ...form, appStoreUrl: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Opened by the forced-update button. Leave blank to use the client's
                fallback default.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="outage-message">Outage banner message</Label>
                {form.outageMessage && (
                  <Button variant="ghost" size="sm" onClick={handleClearOutage}>
                    Clear
                  </Button>
                )}
              </div>
              <Textarea
                id="outage-message"
                placeholder="Leave empty to disable. E.g.: We're investigating ride dispatch delays."
                rows={3}
                value={form.outageMessage}
                onChange={(e) => setForm({ ...form, outageMessage: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                When set, every screen in the driver app shows a non-dismissable banner
                with this message. Use sparingly — this is an incident-only switch.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-xs text-muted-foreground">
                Last updated{' '}
                {cfg ? new Date(cfg.updatedAt).toLocaleString() : '—'}
                {cfg?.updatedBy ? ` by ${cfg.updatedBy}` : ''}
              </div>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Endpoint: <code>GET /api/app/status</code> (public, cached 60s) ·{' '}
          <code>PUT /api/admin/app-config</code> (admin only). Base URL: <code>{apiBase || '/'}</code>
        </p>
      </main>
    </div>
  );
}
