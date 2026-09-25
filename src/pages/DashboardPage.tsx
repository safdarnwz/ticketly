import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Ticket, RotateCcw, Star, ArrowUpRight, TrendingUp, XCircle } from 'lucide-react';

import { Card, CardBody, PageLoader } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { reportsApi } from '@/lib/api/reports';
import { formatMoney } from '@/lib/utils';

const shortcuts = [
  { to: '/search', label: 'Search & Book', desc: 'Find trips and create a booking', icon: Search },
  { to: '/bookings', label: 'Bookings', desc: 'Manage PNRs, tickets, refunds', icon: Ticket },
  { to: '/refunds', label: 'Refunds', desc: 'Process pending refund requests', icon: RotateCcw },
  { to: '/reviews', label: 'Reviews', desc: 'See what customers are saying', icon: Star },
];

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const summary = useQuery({ queryKey: ['reports-summary'], queryFn: reportsApi.summary });

  const stats = summary.data ? [
    { label: 'Today’s bookings', value: String(summary.data.todayBookings), icon: TrendingUp },
    { label: 'Total bookings', value: String(summary.data.totalBookings), icon: Ticket },
    { label: 'Today’s cancellations', value: String(summary.data.todayCancelled), icon: XCircle },
    { label: 'Total revenue', value: formatMoney(summary.data.totalRevenueMinor, 'INR'), icon: TrendingUp },
  ] : [];

  return (
    <>
      {/* Welcome banner — flat black, minimal */}
      <div className="mb-6 rounded-card bg-primary p-7 text-primary-fg sm:p-8">
        <p className="text-sm font-medium text-white/60">Operator console</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">
          Welcome, {user?.fullName?.split(' ')[0] ?? 'there'}.
        </h1>
        <p className="mt-2 max-w-lg text-[15px] text-white/60">Here’s a snapshot of your network today.</p>
      </div>

      {summary.isLoading ? <PageLoader /> : (
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s, i) => (
            <Card key={s.label} accent={i === 0}>
              <CardBody>
                <div className="text-sm text-text-muted">{s.label}</div>
                <div className="mt-2 flex items-end gap-2">
                  <span className="font-display text-3xl text-text">{s.value}</span>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Quick actions</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {shortcuts.map(({ to, label, desc, icon: Icon }) => (
          <Link key={to} to={to}>
            <Card interactive>
              <CardBody className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1 font-semibold text-text">
                    {label} <ArrowUpRight className="h-4 w-4 text-text-muted" />
                  </div>
                  <div className="text-sm text-text-muted">{desc}</div>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
