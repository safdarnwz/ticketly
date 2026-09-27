import { useState } from 'react';
import { TabBar } from '@/components/ui';
import { Handshake, KeyRound, Users, Webhook } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';
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
      <TabBar className="mb-4" value={tab} onChange={setTab} items={TABS} />
      {tab === 'agents' ? <AgentsTab /> : tab === 'partners' ? <PartnersTab /> : tab === 'keys' ? <ApiKeysTab /> : <WebhooksTab />}
    </>
  );
}
