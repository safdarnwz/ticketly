import { useState } from 'react';
import { Printer } from 'lucide-react';

import { Button, useToast } from '@/components/ui';
import { bookingsApi } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';

/**
 * Opens the printable e-ticket. It is fetched with the caller's credentials
 * (staff / signed-in customer, or the booking's mobile for a guest) — a plain
 * link to the API would carry none. The tab is opened on the click itself so
 * pop-up blockers allow it; if one blocks it anyway, the ticket downloads.
 */
export function PrintTicketButton({ bookingId, mobile, label = 'Print / save ticket' }: { bookingId: string; mobile?: string; label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    const win = window.open('', '_blank');
    setBusy(true);
    try {
      const html = await bookingsApi.ticketHtml(bookingId, mobile);
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
      } else {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ticket.html';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5_000);
      }
    } catch (e) {
      win?.close();
      toast.error(e instanceof ApiError ? e.message : 'Could not open the ticket');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" loading={busy} leftIcon={<Printer className="h-4 w-4" />} onClick={() => void open()}>
      {label}
    </Button>
  );
}
