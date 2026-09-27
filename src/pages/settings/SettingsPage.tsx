import { Building2, Landmark, Receipt, RotateCcw, MessageSquare, Image as ImageIcon, Shuffle, ListOrdered, Luggage, PackagePlus } from 'lucide-react';

import { SettingsShell } from '@/components/common/SettingsShell';

const SECTIONS = [
  { to: '/settings/profile', label: 'Company Profile', icon: Building2, description: 'Name, contacts and registered address' },
  { to: '/settings/bank-details', label: 'Bank Details', icon: Landmark, description: 'Where your payouts are sent' },
  { to: '/settings/refund-policy', label: 'Cancellation Policy', icon: RotateCcw, description: 'Your own cancellation/refund tiers' },
  { to: '/settings/luggage', label: 'Luggage', icon: Luggage, description: 'Free allowance and extra-luggage charges' },
  { to: '/settings/add-ons', label: 'Add-ons', icon: PackagePlus, description: 'Extra bags, meals, insurance at checkout' },
  { to: '/settings/waitlist', label: 'Waitlist', icon: ListOrdered, description: 'How many may wait, when the list closes, when entries lapse' },
  { to: '/settings/connections', label: 'Connections', icon: Shuffle, description: 'Two-bus journeys: taking part and change times' },
  { to: '/settings/templates', label: 'Message Templates', icon: MessageSquare, description: 'SMS, WhatsApp and email content' },
  { to: '/settings/branding', label: 'Branding', icon: ImageIcon, description: 'Your logo on tickets and invoices' },
  { to: '/settings/bills', label: 'Ticketly Bills', icon: Receipt, description: 'Invoices Ticketly issued to you' },
];

/** Every operator-facing settings section lives under here — one place, not scattered through the main nav between Fleet and Customers. */
export function SettingsPage() {
  return (
    <SettingsShell
      title="Settings"
      subtitle="Everything specific to how your operation runs — payouts, cancellation terms, customer messaging, and your brand"
      sections={SECTIONS}
    />
  );
}
