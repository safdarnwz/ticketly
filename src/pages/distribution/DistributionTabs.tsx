import { useState } from 'react';
import { Handshake, KeyRound, Users, Webhook } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';
import { cn } from '@/lib/utils';
import { AgentsTab } from './AgentsTab';
import { ApiKeysTab, PartnersTab } from './PartnersTab';
import { WebhooksTab } from './DistributionPage';

const TABS = [
  { key: 'agents', label: 'Travel agents', icon: Users },
  { key: 'partners', label: 'OTA partners', icon: Handshake },
  { key: 'keys', label: 'API keys', icon: KeyRound },
  { key: 'webhooks', label: 'Webhooks', icon: Webhook },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Everyone who sells your seats besides you: travel agents, OTAs, and the systems that talk to yours. */
export function DistributionPage() {
  const [tab, setTab] = useState<Tab>('agents');
  return (
    <>
      <PageHeader title="Distribution" subtitle="Travel agents, OTA partners and integrations that sell your seats" />
      <div className="mb-4 flex gap-2 border-b border-border" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === key ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {tab === 'agents' ? <AgentsTab /> : tab === 'partners' ? <PartnersTab /> : tab === 'keys' ? <ApiKeysTab /> : <WebhooksTab />}
    </>
  );
}
