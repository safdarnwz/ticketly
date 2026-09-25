import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, Upload, Trash2, Receipt } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { logoApi, invoicePrefixApi } from '@/lib/api/logo';

const MAX_BYTES = 500 * 1024; // matches the backend's ~700KB-encoded cap with headroom for base64 overhead

function InvoicePrefixCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [prefix, setPrefix] = useState('');
  const [touched, setTouched] = useState(false);

  const current = useQuery({ queryKey: ['invoice-prefix'], queryFn: invoicePrefixApi.get });
  const save = useMutation({
    mutationFn: () => invoicePrefixApi.set(prefix.toUpperCase()),
    onSuccess: () => { toast.success(prefix ? 'Invoice prefix updated' : 'Reverted to the platform default (INV)'); qc.invalidateQueries({ queryKey: ['invoice-prefix'] }); setTouched(false); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save invoice prefix'),
  });

  if (current.isLoading) return null;
  const effective = touched ? prefix : (current.data?.prefix ?? '');
  const preview = `${(effective || 'INV').toUpperCase()}/2026-27/000042`;

  return (
    <Card className="max-w-lg">
      <CardHeader title={<span className="flex items-center gap-2"><Receipt className="h-4 w-4" /> Invoice numbering</span>} />
      <CardBody className="flex flex-col gap-3">
        <Input label="Invoice prefix" value={effective} maxLength={10}
          placeholder="INV (platform default)"
          onChange={(e) => { setPrefix(e.target.value.replace(/[^A-Za-z0-9]/g, '')); setTouched(true); }} />
        <p className="text-xs text-text-muted">Preview: <code className="rounded bg-surface-muted px-1.5 py-0.5">{preview}</code></p>
        <p className="text-xs text-text-muted">Leave blank to use the platform default ("INV"). Applies to invoices raised from now on — never renumbers past invoices.</p>
        <div>
          <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!touched}>Save</Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function BrandingPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const logo = useQuery({ queryKey: ['operator-logo'], queryFn: logoApi.get });

  const save = useMutation({
    mutationFn: (dataUri: string) => logoApi.set(dataUri),
    onSuccess: () => { toast.success('Logo updated — it will appear on new tickets and invoices from now on'); qc.invalidateQueries({ queryKey: ['operator-logo'] }); setPreview(null); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save logo'),
  });

  const remove = useMutation({
    mutationFn: () => logoApi.set(''),
    onSuccess: () => { toast.success('Logo removed'); qc.invalidateQueries({ queryKey: ['operator-logo'] }); },
  });

  const onFile = (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error('Logo must be under 500KB — please use a smaller or more compressed image');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  if (logo.isLoading) return <PageLoader />;
  if (logo.isError) return <ErrorState error={logo.error} onRetry={logo.refetch} />;

  const current = preview ?? logo.data?.dataUri ?? null;

  return (
    <>
      <PageHeader title="Branding" subtitle="Your logo — shown on e-tickets and GST invoices your passengers receive" />
      <Card className="max-w-lg">
        <CardHeader title={<span className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Logo</span>} />
        <CardBody className="flex flex-col gap-4">
          <div className="flex h-24 w-48 items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted">
            {current ? <img src={current} alt="Logo preview" className="max-h-20 max-w-44 object-contain" /> : <span className="text-xs text-text-muted">No logo set</span>}
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <div className="flex gap-2">
            <Button variant="outline" leftIcon={<Upload className="h-4 w-4" />} onClick={() => fileInput.current?.click()}>
              Choose image
            </Button>
            {logo.data?.dataUri && !preview && (
              <Button variant="outline" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => remove.mutate()} loading={remove.isPending}>
                Remove
              </Button>
            )}
          </div>
          {preview && (
            <div className="flex gap-2">
              <Button onClick={() => save.mutate(preview)} loading={save.isPending}>Save logo</Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          )}
          <p className="text-xs text-text-muted">PNG, JPEG, WebP or SVG, under 500KB. Applies to new tickets and invoices only — already-issued documents don't change.</p>
        </CardBody>
      </Card>
      <div className="mt-6">
        <InvoicePrefixCard />
      </div>
    </>
  );
}
