import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui';
import { isCustomer, isSuperAdmin } from '@/lib/host';

/**
 * A back button with CORRECT redirection on every screen. It doesn't blindly
 * pop history (which can leave the app or land on login); it resolves the
 * logical parent route:
 *   - an explicit `to` wins;
 *   - otherwise a detail route (/bookings/:id) drops to its list (/bookings);
 *   - a top-level route falls back to the CURRENT surface's own home — the
 *     customer storefront's `/`, the operator console's `/dashboard`, or
 *     super-admin's `/admin/tenants`. Getting this wrong sends someone to a
 *     page that doesn't exist on the surface they're actually on (there is
 *     no "/dashboard" on the customer surface, no bare "/" on either
 *     console, and super-admin has no "/dashboard" either).
 * If the user actually navigated in-app, history is preferred so it feels native.
 */
export function BackButton({ to, label = 'Back' }: { to?: string; label?: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  const parent = (): string => {
    if (to) return to;
    const segments = location.pathname.split('/').filter(Boolean);
    if (segments.length <= 1) return isCustomer ? '/' : isSuperAdmin ? '/admin/tenants' : '/dashboard';
    return '/' + segments.slice(0, -1).join('/');
  };

  const onClick = () => {
    // Prefer real in-app history when present, else the resolved parent.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(parent());
  };

  return (
    <Button variant="ghost" size="sm" onClick={onClick} leftIcon={<ArrowLeft className="h-4 w-4" />}>
      {label}
    </Button>
  );
}
