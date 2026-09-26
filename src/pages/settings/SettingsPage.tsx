import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Building2, Landmark, Receipt, RotateCcw, MessageSquare, Image as ImageIcon } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { to: '/settings/profile', label: 'Company Profile', icon: Building2, description: 'Name, contacts and registered address' },
  { to: '/settings/bank-details', label: 'Bank Details', icon: Landmark, description: 'Where your payouts are sent' },
  { to: '/settings/refund-policy', label: 'Cancellation Policy', icon: RotateCcw, description: 'Your own cancellation/refund tiers' },
  { to: '/settings/templates', label: 'Message Templates', icon: MessageSquare, description: 'SMS, WhatsApp and email content' },
  { to: '/settings/branding', label: 'Branding', icon: ImageIcon, description: 'Your logo on tickets and invoices' },
  { to: '/settings/bills', label: 'Ticketly Bills', icon: Receipt, description: 'Invoices Ticketly issued to you' },
];

/** Every operator-facing settings section lives under here — one place, not scattered through the main nav between Fleet and Customers. */
export function SettingsPage() {
  const location = useLocation();
  const isHub = location.pathname === '/settings';

  return (
    <>
      <PageHeader title="Settings" subtitle="Everything specific to how your operation runs — payouts, cancellation terms, customer messaging, and your brand" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to}
              className={({ isActive }) => cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
                isActive ? 'bg-primary/10 font-medium text-primary' : 'text-text-muted hover:bg-surface-muted hover:text-text',
              )}>
              <s.icon className="h-4 w-4" /> {s.label}
            </NavLink>
          ))}
        </nav>
        <div>
          {isHub ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SECTIONS.map((s) => (
                <NavLink key={s.to} to={s.to} className="flex flex-col gap-2 rounded-xl border border-border p-4 transition hover:border-primary/40 hover:bg-surface-muted">
                  <s.icon className="h-5 w-5 text-primary" />
                  <div className="font-medium text-text">{s.label}</div>
                  <div className="text-xs text-text-muted">{s.description}</div>
                </NavLink>
              ))}
            </div>
          ) : <Outlet />}
        </div>
      </div>
    </>
  );
}
