import { Palette, Languages, UserRound, Plug, ShieldCheck, Scale, UsersRound, Server, Landmark } from 'lucide-react';

import { SettingsShell } from '@/components/common/SettingsShell';

const SECTIONS = [
  { to: '/settings/integrations', label: 'Integrations', icon: Plug, description: 'Payment gateways, SMS, WhatsApp and email credentials' },
  { to: '/settings/security', label: 'Security', icon: ShieldCheck, description: 'Password rules, admin sign-in addresses, alerts, encryption' },
  { to: '/settings/business-rules', label: 'Business rules', icon: Scale, description: 'GST slabs, agent credit, OTA release, data retention' },
  { to: '/settings/state-rules', label: 'State rules', icon: Landmark, description: 'Government rules per state (liquor, smoking…) every route carries' },
  { to: '/settings/role-templates', label: 'Role templates', icon: UsersRound, description: 'Ready-made staff roles operators copy' },
  { to: '/settings/system', label: 'System', icon: Server, description: 'Maintenance mode and windows, caches, audit log' },
  { to: '/settings/appearance', label: 'Appearance', icon: Palette, description: 'The design system for the whole platform' },
  { to: '/settings/i18n', label: 'i18n & Currency', icon: Languages, description: 'Shared translation and FX-rate catalog' },
  { to: '/settings/privacy', label: 'Privacy (DPDP)', icon: UserRound, description: 'Data-subject access/erasure requests' },
];

/** Platform-wide configuration lives here — one place, separate from day-to-day cross-tenant admin work (Operators, Applications, Analytics). */
export function PlatformSettingsPage() {
  return (
    <SettingsShell
      title="Settings"
      subtitle="Platform-wide configuration — integrations, security, rules, appearance and localization"
      sections={SECTIONS}
    />
  );
}
