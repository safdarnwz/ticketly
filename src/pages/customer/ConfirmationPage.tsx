import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Ticket, ExternalLink, PartyPopper } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Modal, PageLoader } from '@/components/ui';
import { useBooking } from '@/stores/booking';
import { bookingsApi } from '@/lib/api/bookings';

export function ConfirmationPage() {
  const navigate = useNavigate();
  const b = useBooking();
  const [celebrate, setCelebrate] = useState(true);

  const tickets = useQuery({
    queryKey: ['tickets', b.bookingId],
    queryFn: () => bookingsApi.tickets(b.bookingId!),
    enabled: Boolean(b.bookingId),
  });

  if (!b.bookingId || !b.pnr) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-text-muted">No recent booking to show.</p>
        <Button className="mt-4" onClick={() => navigate('/')}>Book a trip</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* The ONE modal in the app — the booking confirmation. */}
      <Modal open={celebrate} onClose={() => setCelebrate(false)} title="Booking confirmed" size="sm"
        footer={<Button onClick={() => setCelebrate(false)}>View ticket</Button>}>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success"><PartyPopper className="h-7 w-7" /></div>
          <p className="text-text">Your seats are booked. PNR <b>{b.pnr}</b>.</p>
          <p className="text-sm text-text-muted">We’ve emailed your e-ticket.</p>
        </div>
      </Modal>

      <div className="mb-6 flex items-center gap-3">
        <CheckCircle2 className="h-8 w-8 text-success" />
        <div>
          <h1 className="text-2xl font-semibold text-text">You’re all set</h1>
          <p className="text-sm text-text-muted">PNR <span className="font-semibold text-text">{b.pnr}</span></p>
        </div>
      </div>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Ticket className="h-4 w-4" /> Your e-ticket</span>}
          action={<a href={bookingsApi.ticketHtmlUrl(b.bookingId)} target="_blank" rel="noreferrer"><Button variant="outline" size="sm" leftIcon={<ExternalLink className="h-4 w-4" />}>Print</Button></a>}
        />
        <CardBody>
          {tickets.isLoading ? <PageLoader /> : (
            <div className="flex flex-col gap-2">
              {(tickets.data?.tickets ?? []).map((t) => (
                <div key={t.seat} className="flex items-center justify-between rounded-md border border-border p-3">
                  <span className="font-medium text-text">Seat {t.seat}</span>
                  <code className="max-w-[60%] truncate rounded bg-surface-muted px-2 py-1 text-[11px]">{t.boardingToken}</code>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-6 flex gap-3">
        <Button variant="outline" onClick={() => { b.reset(); navigate('/'); }}>Book another</Button>
        <Button onClick={() => navigate('/account')}>My trips</Button>
      </div>
    </div>
  );
}
