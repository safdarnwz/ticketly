import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Save } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { notificationsApi, type NotificationTemplate } from '@/lib/api/notifications';

const EVENT_LABELS: Record<string, string> = {
  'booking.confirmed': 'Booking confirmed',
  'booking.cancelled': 'Booking cancelled (full)',
  'booking.seats_cancelled': 'Booking cancelled (partial — some seats)',
  'trip.reminder.12h': 'Trip reminder — 12 hours before',
  'trip.reminder.4h': 'Trip reminder — 4 hours before (boarding details)',
  'refund.settled': 'Refund completed',
  'trip.delayed': 'Trip delayed',
  'connection.at_risk': 'Connecting journey at risk (delay)',
  'connection.broken': 'Connecting journey broken (missed)',
};

// What each event's payload actually makes available — shown next to the
// editor so an operator writing their own copy doesn't have to guess (or
// worse, invent a placeholder that silently renders as empty text, since
// the template engine has no way to warn about a name that doesn't exist).
const PLACEHOLDERS: Record<string, string[]> = {
  'booking.confirmed': ['{{pnr}}', '{{seats}}'],
  'booking.cancelled': ['{{pnr}}', '{{refundAmount}}'],
  'booking.seats_cancelled': ['{{pnr}}', '{{seats}}', '{{refund}}'],
  'trip.reminder.12h': ['{{pnr}}', '{{fromStopName}}', '{{toStopName}}', '{{boardingAt}}', '{{droppingAt}}', '{{passengerNames}}'],
  'trip.reminder.4h': ['{{pnr}}', '{{busNumber}}', '{{pickup.stopName}}', '{{pickup.landmark}}', '{{pickup.address}}', '{{driver.name}}', '{{driver.phone}}', '{{driversList}}', '{{attendant.name}}', '{{attendant.phone}}', '{{attendantsList}}'],
  'refund.settled': ['{{pnr}}', '{{refundAmount}}'],
  'trip.delayed': ['{{pnr}}', '{{delayMinutes}}'],
  'connection.at_risk': ['{{pnr}}', '{{delayMinutes}}', '{{marginMinutes}}'],
  'connection.broken': ['{{pnr}}', '{{delayMinutes}}', '{{marginMinutes}}'],
};

const CHANNEL_LABELS: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };

function TemplateEditor({ template, onSaved }: { template: NotificationTemplate; onSaved: () => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(template.subject ?? '');
  const [body, setBody] = useState(template.body);
  const dirty = subject !== (template.subject ?? '') || body !== template.body;

  const save = useMutation({
    mutationFn: () => notificationsApi.upsertTemplate({
      eventType: template.eventType, channel: template.channel,
      subject: template.channel === 'email' ? subject : undefined, body,
    }),
    onSuccess: () => { toast.success('Template saved'); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save template'),
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="text-xs font-semibold text-text-muted">{CHANNEL_LABELS[template.channel] ?? template.channel}</div>
      {template.channel === 'email' && (
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" />
      )}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={template.channel === 'sms' ? 3 : 6}
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" />
      <div className="flex justify-end">
        <Button size="sm" leftIcon={<Save className="h-3.5 w-3.5" />} onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function TemplatesPage() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['notification-templates'], queryFn: notificationsApi.listTemplates });

  if (templates.isLoading) return <PageLoader />;
  if (templates.isError) return <ErrorState error={templates.error} onRetry={templates.refetch} />;

  const items = templates.data?.items ?? [];
  const byEvent = new Map<string, NotificationTemplate[]>();
  for (const t of items) {
    if (!byEvent.has(t.eventType)) byEvent.set(t.eventType, []);
    byEvent.get(t.eventType)!.push(t);
  }

  return (
    <>
      <PageHeader title="Message Templates" subtitle="Customize what your passengers see — SMS, WhatsApp and email content for every trip event" />
      <div className="flex flex-col gap-6">
        {Array.from(byEvent.entries()).map(([eventType, channelTemplates]) => (
          <Card key={eventType}>
            <CardHeader title={<span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> {EVENT_LABELS[eventType] ?? eventType}</span>} />
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-1.5">
                {(PLACEHOLDERS[eventType] ?? []).map((p) => (
                  <code key={p} className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-text-muted">{p}</code>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {channelTemplates.map((t) => (
                  <TemplateEditor key={t.channel} template={t} onSaved={() => qc.invalidateQueries({ queryKey: ['notification-templates'] })} />
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
