import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Ticket } from 'lucide-react';

import { Button, Card, CardBody, Input, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';

export function BookingsPage() {
  const navigate = useNavigate();
  const [pnr, setPnr] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pnr.trim()) navigate(`/bookings/${pnr.trim().toUpperCase()}`);
  };

  return (
    <>
      <PageHeader title="Bookings" subtitle="Look up a booking by PNR to manage tickets, refunds and invoices" />
      <Card className="mb-6">
        <CardBody>
          <form onSubmit={onSubmit} className="flex items-end gap-3">
            <div className="flex-1">
              <Input label="PNR" placeholder="e.g. YB12AB" value={pnr} onChange={(e) => setPnr(e.target.value)} leftIcon={<Ticket className="h-4 w-4" />} />
            </div>
            <Button type="submit" leftIcon={<Search className="h-4 w-4" />}>Find</Button>
          </form>
        </CardBody>
      </Card>
      <EmptyState
        title="Look up a booking"
        description="Enter a PNR above to open its full detail — status, tickets, refunds and GST invoices."
        icon={<Ticket className="h-10 w-10" />}
      />
    </>
  );
}
