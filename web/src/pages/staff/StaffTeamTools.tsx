import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, Download, Target, Upload } from 'lucide-react';

import { Badge, Button, Input, Modal, Select, useToast } from '@/components/ui';
import { parseCsv } from '@/lib/csv';
import { reasonLabel, staffApi, WARNING_REASONS, type StaffImportResult, type StaffTarget, type StaffWarning, type WarningReason } from '@/lib/api/staff';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

const MAX_ROWS = 200;

/** Add many staff from the template (Excel → Save as CSV). Each row stands alone. */
export function UploadStaffModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileError, setFileError] = useState('');
  const [result, setResult] = useState<StaffImportResult | null>(null);
  const tpl = useMutation({ mutationFn: staffApi.importTemplate, onError: (e) => toast.error(e instanceof Error ? e.message : 'Download failed') });
  const run = useMutation({
    mutationFn: () => staffApi.bulkImport(rows ?? []),
    onSuccess: (r) => { setResult(r); void qc.invalidateQueries({ queryKey: ['staff'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Upload failed'),
  });

  const pick = async (file: File | undefined) => {
    setResult(null); setRows(null); setFileError('');
    if (!file) return;
    setFileName(file.name);
    if (/\.xlsx?$/i.test(file.name)) { setFileError('Save the sheet as CSV in Excel (File → Save As → CSV) and pick that file'); return; }
    if (file.size > 1_000_000) { setFileError('The file is larger than 1 MB'); return; }
    const parsed = parseCsv(await file.text());
    if (parsed.length === 0) setFileError('The file has no staff rows under the header');
    else if (parsed.length > MAX_ROWS) setFileError(`At most ${MAX_ROWS} people per upload — this file has ${parsed.length}`);
    else if (!('email' in parsed[0]) && !parsed.some((r) => 'email' in r)) setFileError('No "email" column — start from the template');
    else setRows(parsed);
  };

  const copyPasswords = () => {
    const text = (result?.created ?? []).map((c) => `${c.fullName}\t${c.email}\t${c.password}`).join('\n');
    void navigator.clipboard?.writeText(text).then(() => toast.success('Copied'), () => toast.error('Could not copy'));
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Upload staff"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={run.isPending}>{result ? 'Done' : 'Cancel'}</Button>
        {!result && <Button leftIcon={<Upload className="h-4 w-4" />} loading={run.isPending} disabled={!rows || run.isPending} onClick={() => run.mutate()}>Add {rows?.length ?? 0} {rows?.length === 1 ? 'person' : 'people'}</Button>}
      </>}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" leftIcon={<Download className="h-3.5 w-3.5" />} loading={tpl.isPending} onClick={() => tpl.mutate()}>Download template</Button>
          <span className="text-text-muted">Fill it in Excel, save as CSV, then pick the file. Role is a role name or code; branch is optional.</span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text">CSV file</span>
          <input type="file" accept=".csv,text/csv,.xlsx,.xls" aria-label="CSV file" disabled={run.isPending} onChange={(e) => void pick(e.target.files?.[0])} className="text-sm" />
        </label>
        {fileError && <p role="alert" className="text-danger">{fileName}: {fileError}</p>}
        {rows && !result && <p className="text-text-muted">{rows.length} {rows.length === 1 ? 'row' : 'rows'} ready. Anyone already here is skipped with a note — uploading twice adds nobody twice.</p>}

        {result && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2"><Badge tone="success">{result.imported} added</Badge>{result.failed.length > 0 && <Badge tone="danger">{result.failed.length} not added</Badge>}</div>
            {result.created.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-semibold text-text">Starting passwords — shown only now</span>
                  <Button size="sm" variant="outline" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={copyPasswords}>Copy all</Button>
                </div>
                <table className="w-full text-xs"><tbody>
                  {result.created.map((c) => <tr key={c.row}><td className="py-0.5 pr-2">{c.fullName}</td><td className="pr-2 text-text-muted">{c.email}</td><td className="font-mono">{c.password}</td></tr>)}
                </tbody></table>
                <p className="mt-2 text-xs text-text-muted">Share each one privately; they can change it under My account.</p>
              </div>
            )}
            {result.failed.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-text">Not added</div>
                <ul className="max-h-48 overflow-y-auto rounded-md border border-border text-xs">
                  {result.failed.map((f) => <li key={f.row} className="flex gap-2 border-b border-border px-3 py-1 last:border-0"><span className="w-14 shrink-0 text-text-muted">Row {f.row}</span><span className="text-danger">{f.error}</span></li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Daily counter-sales target for one person. */
export function TargetSection({ id, target, disabled, onSaved }: { id: string; target: StaffTarget | null; disabled: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [bookings, setBookings] = useState(target ? String(target.dailyBookings) : '');
  const [rupees, setRupees] = useState(target?.dailyRevenueMinor ? String(target.dailyRevenueMinor / 100) : '');
  const errors: Record<string, string> = {};
  const b = Number(bookings);
  if (!Number.isInteger(b) || b < 1 || b > 1000) errors.bookings = 'A whole number from 1 to 1000';
  if (rupees && !(Number(rupees) >= 1 && Number(rupees) <= 10_000_000)) errors.rupees = '₹1 to ₹1 crore, or leave empty';
  const done = (msg: string) => ({ onSuccess: () => { toast.success(msg); onSaved(); }, onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed') });
  const save = useMutation({ mutationFn: () => staffApi.setTarget(id, { dailyBookings: b, dailyRevenueMinor: rupees ? Math.round(Number(rupees) * 100) : null }), ...done('Target saved') });
  const clear = useMutation({ mutationFn: () => staffApi.clearTarget(id), ...done('Target removed') });
  const busy = save.isPending || clear.isPending;
  const touched = bookings !== '' || rupees !== '';
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3" disabled={busy}>
      <legend className="flex items-center gap-1 px-1 font-semibold text-text"><Target className="h-4 w-4" /> Daily target</legend>
      {disabled && <p className="text-xs text-text-muted">Enable the account to set a target.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Bookings a day" type="number" min={1} max={1000} value={bookings} disabled={disabled} error={touched ? errors.bookings : undefined} onChange={(e) => setBookings(e.target.value)} />
        <Input label="Sales a day (₹, optional)" type="number" min={1} value={rupees} disabled={disabled} error={errors.rupees} onChange={(e) => setRupees(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        {target && <Button size="sm" variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>Remove target</Button>}
        <Button size="sm" loading={save.isPending} disabled={disabled || busy || Object.keys(errors).length > 0} onClick={() => save.mutate()}>Save target</Button>
      </div>
    </fieldset>
  );
}

/** Written warnings: what was issued, whether they read it, and a form to issue one. */
export function WarningsSection({ id, warnings, canIssue, why, onSaved }: { id: string; warnings: StaffWarning[]; canIssue: boolean; why?: string; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<WarningReason | ''>('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = {};
  if (!reason) errors.reason = 'Pick a reason';
  if (note.trim().length < 10) errors.note = 'Say what happened, in at least 10 characters';
  const issue = useMutation({
    mutationFn: () => staffApi.warn(id, reason as WarningReason, note.trim()),
    onSuccess: () => { toast.success('Warning issued — they see it on their account'); setOpen(false); setReason(''); setNote(''); setTried(false); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-text">Warnings ({warnings.length})</span>
        {!open && <Button size="sm" variant="ghost" leftIcon={<AlertTriangle className="h-3.5 w-3.5" />} disabled={!canIssue} title={why} onClick={() => setOpen(true)}>Issue a warning</Button>}
      </div>
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {warnings.map((w) => (
            <li key={w.id} className="rounded-md border border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs"><Badge tone="warning">{reasonLabel(w.reason)}</Badge><span className="text-text-muted">{formatDateTime(w.issuedAt)}{w.issuedByName ? ` · by ${w.issuedByName}` : ''}</span>
                <span className={cn('ml-auto', w.acknowledgedAt ? 'text-success' : 'text-text-muted')}>{w.acknowledgedAt ? `Read ${formatDateTime(w.acknowledgedAt)}` : 'Not read yet'}</span></div>
              <p className="mt-1 whitespace-pre-line">{w.note}</p>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <Select label="Reason" value={reason} error={tried ? errors.reason : undefined} onChange={(e) => setReason(e.target.value as WarningReason)} options={[{ label: 'Choose…', value: '' }, ...WARNING_REASONS]} />
          <label className="flex flex-col gap-1"><span className="text-sm font-medium text-text">What happened</span>
            <textarea className="min-h-20 rounded-md border border-border bg-surface p-2 text-sm" maxLength={1000} value={note} aria-invalid={tried && !!errors.note} onChange={(e) => setNote(e.target.value)} />
            {tried && errors.note && <span role="alert" className="text-xs text-danger">{errors.note}</span>}</label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={issue.isPending} onClick={() => { setOpen(false); setTried(false); }}>Cancel</Button>
            <Button size="sm" variant="danger" loading={issue.isPending} disabled={issue.isPending} onClick={() => { setTried(true); if (Object.keys(errors).length === 0) issue.mutate(); }}>Issue warning</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "12 / 20" with how far along, for the performance table. */
export function TargetProgress({ done, target, money }: { done: number; target: number | null; money?: boolean }) {
  if (!target) return <span className="text-xs text-text-muted">No target</span>;
  const pct = Math.round((done / target) * 100);
  const fmt = (v: number) => (money ? formatMoney(v, 'INR') : String(v));
  return <span className={cn('text-sm', pct >= 100 ? 'text-success' : pct < 50 ? 'text-danger' : 'text-text')}>{fmt(done)} / {fmt(target)} <span className="text-xs">({pct}%)</span></span>;
}
