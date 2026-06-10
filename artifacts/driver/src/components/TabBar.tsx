import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Car, Wallet, GraduationCap, CircleUser } from 'lucide-react';
import { colors } from '@/theme';

type TabKey = 'home' | 'rides' | 'earnings' | 'training' | 'account';

interface Tab {
  key: TabKey;
  label: string;
  Icon: React.ComponentType<{ size: number; strokeWidth: number }>;
  path: string;
  roots: string[];
}

const TABS: Tab[] = [
  {
    key: 'home',
    label: 'Home',
    Icon: Home,
    path: '/home',
    roots: ['/home'],
  },
  {
    key: 'rides',
    label: 'Rides',
    Icon: Car,
    path: '/schedule',
    roots: ['/schedule', '/scheduled-jobs', '/ride-along'],
  },
  {
    key: 'earnings',
    label: 'Earnings',
    Icon: Wallet,
    path: '/earnings',
    roots: ['/earnings', '/instant-pay', '/mileage', '/expenses', '/tax-estimator'],
  },
  {
    key: 'training',
    label: 'Training',
    Icon: GraduationCap,
    path: '/training',
    roots: ['/training', '/leaderboard', '/promotions', '/performance'],
  },
  {
    key: 'account',
    label: 'Account',
    Icon: CircleUser,
    path: '/settings',
    roots: [
      '/settings',
      '/profile',
      '/documents',
      '/my-documents',
      '/safety',
      '/help',
      '/support',
      '/notifications',
      '/refer',
      '/announcements',
      '/founder',
      '/custody',
    ],
  },
];

function getActiveKey(pathname: string): TabKey | null {
  const tab = TABS.find(t =>
    t.roots.some(r => pathname === r || pathname.startsWith(r + '/')),
  );
  return tab?.key ?? null;
}

export function TabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeKey = getActiveKey(pathname);

  return (
    <nav
      aria-label="Main navigation"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        background: colors.surfaceDark,
        borderTop: '1px solid rgba(250, 247, 240, 0.08)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        zIndex: 50,
      }}
    >
      {TABS.map(({ key, label, Icon, path }) => {
        const active = activeKey === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => navigate(path)}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              height: 56,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: active ? colors.gold : 'rgba(250,247,240,0.45)',
              WebkitTapHighlightColor: 'transparent',
              transition: 'color 0.15s',
              minHeight: 44,
            }}
          >
            <Icon size={22} strokeWidth={active ? 2 : 1.5} />
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 600 : 400,
                fontFamily: 'Outfit, sans-serif',
                lineHeight: 1,
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
