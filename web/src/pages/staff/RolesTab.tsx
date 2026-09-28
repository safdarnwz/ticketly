import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, PageLoader, useToast } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { staffApi, type PermissionGroup, type Role } from '@/lib/api/staff';
import { cn } from '@/lib/utils';

const toCode = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'r_$1').slice(0, 40);
const CODE_RE = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * Roles are bundles of permissions given to staff. Built-in roles are fixed —
 * duplicate one to change it. Nobody builds a role bigger than their own, and
 * a role still held by someone cannot be deleted.
 */
export function RolesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ['roles'], queryFn: staffApi.roles });
  const catalogue = useQuery({ queryKey: ['permission-catalogue'], queryFn: staffApi.permissionCatalogue });
  const templates = useQuery({ queryKey: ['role-templates'], queryFn: staffApi.roleTemplates });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [copying, setCopying] = useState<Role | null>(null);
  const [applying, setApplying] = useState<{ id: string; name: string; code: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['roles'] });
  const remove = useMutation({
    mutationFn: (r: Role) => staffApi.deleteRole(r.id),
    onSuccess: () => { toast.success('Role deleted'); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const labels = new Map((catalogue.data?.groups ?? []).flatMap((g) => g.items.map((i) => [i.code, i.label] as const)));
  const items = roles.data?.items ?? [];
  const existingCodes = new Set(items.map((r) => r.code));
  const unusedTemplates = (templates.data?.items ?? []).filter((t) => !existingCodes.has(t.code));

  if (roles.isLoading) return <PageLoader />;
  if (roles.isError) return <ErrorState error={roles.error} onRetry={roles.refetch} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">A person can hold several roles; they get everything those roles allow.</p>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')} disabled={!catalogue.data}>New role</Button>
      </div>

      {items.length === 0 ? <EmptyState title="No roles yet" icon={<ShieldCheck className="h-10 w-10" />} /> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {items.map((r) => {
            const held = r.holders ?? 0;
            return (
              <Card key={r.id}>
                <CardBody className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-text">{r.name}</span>
                    <span className="font-mono text-xs text-text-muted">{r.code}</span>
                    {r.isSystem && <Badge tone="neutral"><Lock className="mr-1 inline h-3 w-3" />Built-in</Badge>}
                    <span className="ml-auto text-xs text-text-muted">{held} {held === 1 ? 'person' : 'people'}</span>
                  </div>
                  {r.description && <p className="text-sm text-text-muted">{r.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {r.permissions.includes('*') ? <Badge tone="success">Everything</Badge> : r.permissions.slice(0, 8).map((p) => <Badge key={p}>{labels.get(p) ?? p}</Badge>)}
                    {!r.permissions.includes('*') && r.permissions.length > 8 && <Badge>+{r.permissions.length - 8} more</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" leftIcon={<Pencil className="h-3.5 w-3.5" />} disabled={r.isSystem} title={r.isSystem ? 'Built-in roles are fixed — duplicate it and change the copy' : undefined} onClick={() => setEditing(r)}>Edit</Button>
                    <Button size="sm" variant="ghost" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => setCopying(r)}>Duplicate</Button>
                    <Button size="sm" variant="ghost" className="text-danger" leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                      disabled={r.isSystem || held > 0 || remove.isPending}
                      title={r.isSystem ? 'Built-in roles cannot be deleted' : held > 0 ? 'Take it away from everyone first' : undefined}
                      onClick={() => { if (window.confirm(`Delete the role "${r.name}"?`)) remove.mutate(r); }}>Delete</Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {unusedTemplates.length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <div className="font-semibold text-text">Ready-made roles from Ticketly</div>
            {unusedTemplates.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{t.name}</span><span className="text-text-muted">{t.description}</span>
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => setApplying({ id: t.id, name: t.name, code: t.code })}>Add to my roles</Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {editing && catalogue.data && <RoleEditor role={editing === 'new' ? null : editing} groups={catalogue.data.groups} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
      {copying && <NameModal title={`Duplicate "${copying.name}"`} initialName={`${copying.name} (copy)`} action="Duplicate"
        submit={(v) => staffApi.duplicateRole(copying.id, v)} onClose={() => setCopying(null)} onDone={() => { setCopying(null); refresh(); toast.success('Copied — edit the copy as you like'); }} />}
      {applying && <NameModal title={`Add "${applying.name}"`} initialName={applying.name} initialCode={applying.code} action="Add role"
        submit={(v) => staffApi.applyTemplate(applying.id, v)} onClose={() => setApplying(null)} onDone={() => { setApplying(null); refresh(); toast.success('Role added'); }} />}
    </div>
  );
}

function useFieldErrors(error: unknown) {
  return error instanceof ApiError ? error.fieldErrors : {};
}

function RoleEditor({ role, groups, onClose, onDone }: { role: Role | null; groups: PermissionGroup[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(role?.name ?? '');
  const [code, setCode] = useState(role?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(!!role);
  const [description, setDescription] = useState(role?.description ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [tried, setTried] = useState(false);
  const save = useMutation({
    mutationFn: (): Promise<unknown> => role
      ? staffApi.setRolePermissions(role.id, [...picked])
      : staffApi.createRole({ name: name.trim(), code, description: description.trim() || undefined, permissions: [...picked] }),
    onSuccess: () => { toast.success(role ? 'Permissions saved — they apply on the next click' : 'Role created'); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const server = useFieldErrors(save.error);
  const errors: Record<string, string> = {};
  if (!role && name.trim().length < 2) errors.name = 'At least 2 characters';
  if (!role && !CODE_RE.test(code)) errors.code = 'Lower-case letters, digits and _ — starts with a letter';
  if (picked.size === 0) errors.permissions = 'Pick at least one permission';
  const shown = (k: string) => (tried ? errors[k] : undefined) ?? server[k];
  const toggle = (c: string) => { const n = new Set(picked); if (n.has(c)) n.delete(c); else n.add(c); setPicked(n); };
  const kept = [...picked].filter((p) => !groups.some((g) => g.items.some((i) => i.code === p)));

  return (
    <Modal open onClose={onClose} size="lg" title={role ? `Permissions of "${role.name}"` : 'New role'}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (Object.keys(errors).length === 0) save.mutate(); }}>{role ? 'Save' : 'Create role'}</Button>
      </>}>
      <div className="flex flex-col gap-3 text-sm">
        {!role && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" placeholder="e.g. Dispatch Manager" value={name} maxLength={80} error={shown('name')} onChange={(e) => { setName(e.target.value); if (!codeTouched) setCode(toCode(e.target.value)); }} />
            <Input label="Code" value={code} maxLength={40} error={shown('code')} hint="Used by integrations; cannot change later" onChange={(e) => { setCode(e.target.value); setCodeTouched(true); }} />
            <div className="col-span-2"><Input label="Description (optional)" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="font-semibold text-text">Permissions <span className="font-normal text-text-muted">({picked.size})</span></span>
          {shown('permissions') && <span role="alert" className="text-xs text-danger">{shown('permissions')}</span>}
        </div>
        {kept.length > 0 && <p className="text-xs text-text-muted">Also keeps: {kept.join(', ')}</p>}
        <div className="grid max-h-[55vh] grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g.group} className="rounded-md border border-border p-2">
              <legend className="px-1 text-xs font-semibold text-text-muted">{g.group}</legend>
              {g.items.map((i) => (
                <label key={i.code} className={cn('flex items-start gap-2 py-0.5', !i.grantable && 'opacity-50')} title={i.grantable ? i.code : 'You do not hold this yourself, so you cannot hand it out'}>
                  <input type="checkbox" className="mt-0.5" checked={picked.has(i.code)} disabled={!i.grantable || save.isPending} onChange={() => toggle(i.code)} />
                  <span>{i.label}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function NameModal({ title, initialName, initialCode, action, submit, onClose, onDone }: {
  title: string; initialName: string; initialCode?: string; action: string;
  submit: (v: { code: string; name: string }) => Promise<unknown>; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode ?? toCode(initialName));
  const [tried, setTried] = useState(false);
  const run = useMutation({ mutationFn: () => submit({ code, name: name.trim() }), onSuccess: onDone, onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed') });
  const server = useFieldErrors(run.error);
  const errors: Record<string, string> = {};
  if (name.trim().length < 2) errors.name = 'At least 2 characters';
  if (!CODE_RE.test(code)) errors.code = 'Lower-case letters, digits and _ — starts with a letter';
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><Button variant="ghost" onClick={onClose} disabled={run.isPending}>Cancel</Button>
        <Button loading={run.isPending} disabled={run.isPending} onClick={() => { setTried(true); if (Object.keys(errors).length === 0) run.mutate(); }}>{action}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Name" value={name} maxLength={80} error={(tried ? errors.name : undefined) ?? server.name} onChange={(e) => setName(e.target.value)} />
        <Input label="Code" value={code} maxLength={40} error={(tried ? errors.code : undefined) ?? server.code} onChange={(e) => setCode(e.target.value)} />
      </div>
    </Modal>
  );
}
