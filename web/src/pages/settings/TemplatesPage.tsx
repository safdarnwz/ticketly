import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Save } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiError } from '@/lib/api/client';
import { notificationsApi, type NotificationTemplate } from '@/lib/api/notifications';
import { cn } from '@/lib/utils';

const CHANNELS: NotificationTemplate['channel'][] = ['sms', 'whatsapp', 'email'];
const CHANNEL_LABELS: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };
const SMS_MAX = 480;
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Same checks as the API: known placeholders only, closed braces, SMS length, email subject. */
function problem(channel: string, subject: string, body: string, allowed: string[]): { field: 'subject' | 'body'; message: string } | null {
  if (!body.trim()) return { field: 'body', message: 'Write the message' };
  if (channel === 'email' && !subject.trim()) return { field: 'subject', message: 'An email needs a subject' };
  if (channel === 'sms' && body.length > SMS_MAX) return { field: 'body', message: `At most ${SMS_MAX} characters (3 SMS)` };
  for (const [field, text] of [['subject', subject], ['body', body]] as const) {
    if ((text.match(/\{\{/g)?.length ?? 0) !== (text.match(/\}\}/g)?.length ?? 0)) return { field, message: 'A placeholder is not closed — write {{name}}' };
    const unknown = [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).find((p) => !allowed.includes(p));
    if (unknown) return { field, message: `{{${unknown}}} is not filled in for this event` };
  }
  return null;
}

function TemplateEditor({ eventType, channel, template, placeholders, onSaved }: {
  eventType: string; channel: NotificationTemplate['channel']; template?: NotificationTemplate; placeholders: string[]; onSaved: () => void;
}) {
  const toast = useToast();
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [adding, setAdding] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = subject !== (template?.subject ?? '') || body !== (template?.body ?? '');
  const local = dirty ? problem(channel, subject, body, placeholders) : null;
  const save = useMutation({
    mutationFn: () => notificationsApi.upsertTemplate({ eventType, channel, subject: channel === 'email' ? subject.trim() : undefined, body: body.trim() }),
    onSuccess: () => { toast.success(`${CHANNEL_LABELS[channel]} message saved`); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save template'),
  });
  const server = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const insert = (p: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    setBody((b) => `${b.slice(0, at)}{{${p}}}${b.slice(el?.selectionEnd ?? at)}`);
    requestAnimationFrame(() => el?.focus());
  };

  if (!template && !adding) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-3">
        <div className="text-xs font-semibold text-text-muted">{CHANNEL_LABELS[channel]}</div>
        <p className="text-xs text-text-muted">Not sent on this channel.</p>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add {CHANNEL_LABELS[channel]} message</Button>
      </div>
    );
  }
  const bodyError = (local?.field === 'body' ? local.message : undefined) ?? server.body;
  const subjectError = (local?.field === 'subject' ? local.message : undefined) ?? server.subject;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between text-xs font-semibold text-text-muted">
        <span>{CHANNEL_LABELS[channel]}</span>
        {channel === 'sms' && <span className={cn(body.length > SMS_MAX && 'text-danger')}>{body.length}/{SMS_MAX} · {Math.max(1, Math.ceil(body.length / 160))} SMS</span>}
      </div>
      {channel === 'email' && (
        <>
          <input aria-label={`${eventType} email subject`} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" aria-invalid={!!subjectError}
            className={cn('rounded-md border bg-surface px-3 py-2 text-sm text-text', subjectError ? 'border-danger' : 'border-border')} />
          {subjectError && <span className="text-xs text-danger" role="alert">{subjectError}</span>}
        </>
      )}
      <textarea ref={area} aria-label={`${eventType} ${channel} message`} value={body} onChange={(e) => setBody(e.target.value)} rows={channel === 'sms' ? 4 : 6} aria-invalid={!!bodyError}
        className={cn('rounded-md border bg-surface px-3 py-2 text-sm text-text', bodyError ? 'border-danger' : 'border-border')} />
      {bodyError && <span className="text-xs text-danger" role="alert">{bodyError}</span>}
      <div className="flex flex-wrap gap-1">
        {placeholders.map((p) => (
          <button key={p} type="button" onClick={() => insert(p)} className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-text-muted hover:text-text" title="Insert at the cursor">{`{{${p}}}`}</button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        {dirty && <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => { setSubject(template?.subject ?? ''); setBody(template?.body ?? ''); if (!template) setAdding(false); }}>Undo</Button>}
        <Button size="sm" leftIcon={<Save className="h-3.5 w-3.5" />} onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !!local || save.isPending}>Save</Button>
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
  const catalogue = templates.data?.catalogue ?? {};
  const find = (e: string, c: string) => items.find((t) => t.eventType === e && t.channel === c);

  return (
    <>
      <PageHeader title="Message Templates" subtitle="What your passengers receive for every trip event — click a placeholder to insert it where the cursor is" />
      <div className="flex flex-col gap-6">
        {Object.entries(catalogue).map(([eventType, entry]) => (
          <Card key={eventType}>
            <CardHeader title={<span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> {entry.label}</span>} />
            <CardBody>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {CHANNELS.map((c) => (
                  <TemplateEditor key={`${c}-${find(eventType, c)?.body ?? ''}`} eventType={eventType} channel={c} template={find(eventType, c)} placeholders={entry.placeholders}
                    onSaved={() => void qc.invalidateQueries({ queryKey: ['notification-templates'] })} />
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
