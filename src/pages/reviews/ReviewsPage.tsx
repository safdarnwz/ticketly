import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, MessageSquareReply, Star } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Modal, PageLoader, Select, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { REPORT_REASONS, reviewsApi, type OperatorReview, type ReviewFilter } from '@/lib/api/content';
import { masterDataApi } from '@/lib/api/masterData';
import { cn, formatDateLabel, formatDateTime } from '@/lib/utils';

const FILTERS: { key: ReviewFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unanswered', label: 'Unanswered' },
  { key: 'low', label: '1–2 stars' },
  { key: 'reported', label: 'Reported' },
];

function Stars({ value, size = 'h-4 w-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex text-accent" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={size} fill={i <= Math.round(value) ? 'currentColor' : 'none'} />)}
    </span>
  );
}

/**
 * What travellers say about the operator's buses — only people who travelled
 * can review. Staff answer publicly and can report abuse to the platform; a
 * review can never be hidden by the operator itself.
 */
export function ReviewsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [routeId, setRouteId] = useState('');
  const [rating, setRating] = useState('');
  const [replying, setReplying] = useState<OperatorReview | null>(null);
  const [reporting, setReporting] = useState<OperatorReview | null>(null);

  const routes = useQuery({ queryKey: ['routes'], queryFn: () => masterDataApi.listRoutes() });
  const list = useInfiniteQuery({
    queryKey: ['operator-reviews', filter, routeId, rating],
    queryFn: ({ pageParam }) => reviewsApi.list({ filter, routeId: routeId || undefined, rating: rating ? Number(rating) : undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const summary = list.data?.pages[0]?.summary;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ['operator-reviews'] });
  const total = summary?.count ?? 0;

  return (
    <>
      <PageHeader title="Reviews & Ratings" subtitle="What travellers say — reviews come only from people who travelled with you" />

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardBody className="flex items-center gap-4">
            <div className="text-4xl font-semibold text-text">{summary ? summary.average.toFixed(1) : '–'}</div>
            <div>
              <Stars value={summary?.average ?? 0} />
              <div className="text-sm text-text-muted">{total} review{total === 1 ? '' : 's'}{routeId ? ' on this route' : ''}</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-1">
            {[5, 4, 3, 2, 1].map((s) => {
              const n = summary?.counts[String(s)] ?? 0;
              return (
                <button key={s} className={cn('flex items-center gap-2 text-xs', rating === String(s) && 'font-semibold')} onClick={() => setRating(rating === String(s) ? '' : String(s))} aria-pressed={rating === String(s)}>
                  <span className="w-3">{s}</span><Star className="h-3 w-3 text-accent" fill="currentColor" />
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"><span className="block h-2 rounded-full bg-accent" style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></span>
                  <span className="w-6 text-right text-text-muted">{n}</span>
                </button>
              );
            })}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="grid grid-cols-2 gap-3">
            <div><div className="text-xs text-text-muted">Waiting for your answer</div><div className="text-2xl font-semibold text-text">{summary?.unanswered ?? 0}</div></div>
            <div><div className="text-xs text-text-muted">Reported to the platform</div><div className="text-2xl font-semibold text-text">{summary?.reported ?? 0}</div></div>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="flex overflow-hidden rounded-md border border-border text-sm" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
                className={cn('px-3 py-2', filter === f.key ? 'bg-primary text-white' : 'bg-surface text-text hover:bg-surface-muted')}>{f.label}</button>
            ))}
          </div>
          <div className="w-64"><Select label="Route" value={routeId} onChange={(e) => setRouteId(e.target.value)}
            options={[{ label: 'All routes', value: '' }, ...(routes.data?.items ?? []).map((r) => ({ label: r.name, value: r.id }))]} /></div>
          {rating && <Button variant="ghost" size="sm" onClick={() => setRating('')}>Clear {rating}-star filter</Button>}
        </CardBody>
      </Card>

      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : items.length === 0 ? (
        <EmptyState title={filter === 'unanswered' ? 'Every review has an answer' : 'No reviews here yet'} description="Travellers can review a trip once the bus has left." icon={<Star className="h-10 w-10" />} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((r) => (
            <Card key={r.id}>
              <CardBody className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Stars value={r.rating} />
                    {r.title && <span className="font-semibold text-text">{r.title}</span>}
                    {r.verified && <Badge tone="success">Travelled</Badge>}
                    {r.reportedAt && <Badge tone="warning">Reported</Badge>}
                  </div>
                  <div className="text-xs text-text-muted">
                    {r.routeName ?? 'Route'}{r.journeyDate ? ` · travelled ${formatDateLabel(r.journeyDate, { day: '2-digit', month: 'short' })}` : ''} · <Link className="font-mono text-primary hover:underline" to={`/bookings/${r.pnr}`}>{r.pnr}</Link> · {formatDateTime(r.createdAt)}
                  </div>
                </div>
                {r.body ? <p className="whitespace-pre-line text-sm text-text">{r.body}</p> : <p className="text-sm italic text-text-muted">Stars only, no comment.</p>}
                {r.reply && (
                  <div className="rounded-md border-l-4 border-primary bg-surface-muted p-3 text-sm">
                    <div className="mb-1 text-xs font-semibold text-text-muted">Your answer · {r.repliedAt ? formatDateTime(r.repliedAt) : ''}</div>
                    <p className="whitespace-pre-line text-text">{r.reply}</p>
                  </div>
                )}
                {r.reportReason && <div className="text-xs text-text-muted">Reported: {r.reportReason.replace(/_/g, ' ')}</div>}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" leftIcon={<MessageSquareReply className="h-4 w-4" />} onClick={() => setReplying(r)}>{r.reply ? 'Edit answer' : 'Answer'}</Button>
                  {!r.reportedAt && <Button size="sm" variant="ghost" leftIcon={<Flag className="h-4 w-4" />} onClick={() => setReporting(r)}>Report</Button>}
                </div>
              </CardBody>
            </Card>
          ))}
          {list.hasNextPage && <div className="flex justify-center"><Button variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button></div>}
        </div>
      )}

      {replying && <ReplyModal review={replying} onClose={() => setReplying(null)} onDone={() => { setReplying(null); refresh(); }} />}
      {reporting && <ReportModal review={reporting} onClose={() => setReporting(null)} onDone={() => { setReporting(null); refresh(); }} />}
    </>
  );
}

function ReplyModal({ review, onClose, onDone }: { review: OperatorReview; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(review.reply ?? '');
  const tooLong = text.trim().length > 1000;
  const save = useMutation({
    mutationFn: (value: string) => reviewsApi.reply(review.id, value),
    onSuccess: (_r, value) => { toast.success(value ? 'Answer published under the review' : 'Answer removed'); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <Modal open onClose={onClose} title={review.reply ? 'Edit your answer' : 'Answer this review'} size="lg"
      footer={<>
        {review.reply && <Button variant="ghost" className="mr-auto text-danger" disabled={save.isPending} onClick={() => save.mutate('')}>Remove answer</Button>}
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button loading={save.isPending} disabled={save.isPending || !text.trim() || tooLong} onClick={() => save.mutate(text.trim())}>Publish answer</Button>
      </>}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="rounded-md bg-surface-muted p-3"><Stars value={review.rating} /> {review.body ?? <i>Stars only</i>}</div>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text">Your answer <span className="font-normal text-text-muted">— shown publicly under the review</span></span>
          <textarea className="min-h-32 rounded-md border border-border bg-surface p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={tooLong} />
          <span className={cn('text-xs', tooLong ? 'text-danger' : 'text-text-muted')} role={tooLong ? 'alert' : undefined}>{text.trim().length}/1000</span>
        </label>
      </div>
    </Modal>
  );
}

function ReportModal({ review, onClose, onDone }: { review: OperatorReview; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const report = useMutation({
    mutationFn: () => reviewsApi.report(review.id, reason, note.trim()),
    onSuccess: () => { toast.success('Reported — the platform will review it. It stays visible until then.'); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <Modal open onClose={onClose} title="Report this review"
      footer={<><Button variant="ghost" onClick={onClose} disabled={report.isPending}>Cancel</Button><Button loading={report.isPending} disabled={!reason || report.isPending} onClick={() => report.mutate()}>Report</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Report reviews that break the rules. A bad rating on its own is not a reason — answer it instead. You cannot hide reviews yourself.</p>
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={[{ label: 'Choose a reason…', value: '' }, ...REPORT_REASONS.map((r) => ({ label: r.label, value: r.value }))]} />
        <label className="flex flex-col gap-1"><span className="font-medium text-text">Details (optional)</span>
          <textarea className="min-h-20 rounded-md border border-border bg-surface p-2 text-sm" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Modal>
  );
}
