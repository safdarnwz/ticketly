import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UsersRound } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageLoader,
  usePaged,
  useToast,
} from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { platformAdminApi, type RoleTemplate } from '@/lib/api/platformAdmin';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Role templates every operator can start from (#22–#25): a named set of
 * permissions ("Booking clerk", "Depot manager"). Operators copy a template
 * into their own role and may change it there; editing a template does not
 * change roles already copied.
 */
export function RoleTemplatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['role-templates'], queryFn: platformAdminApi.roleTemplates });
  const templates = usePaged(q.data?.items ?? []);
  const [editing, setEditing] = useState<RoleTemplate | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => platformAdminApi.deleteRoleTemplate(id),
    onSuccess: () => {
      toast.success('Template removed — roles operators already made from it stay');
      void qc.invalidateQueries({ queryKey: ['role-templates'] });
    },
    onError: (e) => toast.error(errText(e, 'Could not remove it')),
  });
  return (
    <>
      <PageHeader
        title="Role templates"
        subtitle="Ready-made staff roles operators can copy"
        action={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            New template
          </Button>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : q.data!.items.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description="Create one — operators see it when they add a role."
          icon={<UsersRound className="h-10 w-10" />}
          action={<Button onClick={() => setEditing('new')}>New template</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {templates.pageItems.map((t) => (
            <Card key={t.id}>
              <CardBody className="flex flex-col gap-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-text">
                      {t.name} <span className="font-mono text-xs text-text-muted">{t.code}</span>
                    </div>
                    {t.description && <div className="text-text-muted">{t.description}</div>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${t.name}`}
                      loading={remove.isPending && remove.variables === t.id}
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove the template “${t.name}”?`)) remove.mutate(t.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.permissions.map((p) => (
                    <Badge key={p} tone="neutral">
                      {p}
                    </Badge>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
          {templates.pager && <div className="lg:col-span-2">{templates.pager}</div>}
        </div>
      )}
      {editing && <TemplateModal t={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateModal({ t, onClose }: { t: RoleTemplate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cat = useQuery({ queryKey: ['permission-catalogue'], queryFn: platformAdminApi.permissionCatalogue, staleTime: 300_000 });
  const [f, setF] = useState({ code: t?.code ?? '', name: t?.name ?? '', description: t?.description ?? '' });
  const [perms, setPerms] = useState<string[]>(t?.permissions ?? []);
  const [tried, setTried] = useState(false);
  const e = {
    code:
      !t && !/^[a-z][a-z0-9_]{1,39}$/.test(f.code.trim()) ? 'lower_snake_case, 2–40 characters (e.g. booking_clerk)' : undefined,
    name: f.name.trim().length < 2 ? 'At least 2 characters' : undefined,
    perms: perms.length === 0 ? 'Pick at least one permission' : undefined,
  };
  const save = useMutation({
    mutationFn: () =>
      t
        ? platformAdminApi.updateRoleTemplate(t.id, {
            name: f.name.trim(),
            description: f.description.trim() || undefined,
            permissions: perms,
          })
        : platformAdminApi.createRoleTemplate({
            code: f.code.trim(),
            name: f.name.trim(),
            description: f.description.trim() || undefined,
            permissions: perms,
          }),
    onSuccess: () => {
      toast.success(t ? 'Template saved' : 'Template created — operators can copy it now');
      void qc.invalidateQueries({ queryKey: ['role-templates'] });
      onClose();
    },
    onError: (x) => toast.error(errText(x, 'Could not save')),
  });
  const toggle = (code: string, on: boolean) => setPerms(on ? [...perms, code] : perms.filter((p) => p !== code));
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t ? `Edit ${t.name}` : 'New role template'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={save.isPending}
            onClick={() => {
              setTried(true);
              if (!e.code && !e.name && !e.perms) save.mutate();
            }}
          >
            {t ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Code"
            value={f.code}
            disabled={!!t}
            error={tried ? e.code : undefined}
            hint={t ? 'Fixed once created' : undefined}
            onChange={(x) => setF({ ...f, code: x.target.value })}
          />
          <Input
            label="Name"
            value={f.name}
            error={tried ? e.name : undefined}
            onChange={(x) => setF({ ...f, name: x.target.value })}
          />
        </div>
        <Input
          label="What this role does (optional)"
          value={f.description}
          maxLength={500}
          onChange={(x) => setF({ ...f, description: x.target.value })}
        />
        <div className="font-medium text-text">Permissions ({perms.length})</div>
        {tried && e.perms && (
          <p role="alert" className="text-xs text-danger">
            {e.perms}
          </p>
        )}
        {cat.isLoading ? (
          <PageLoader />
        ) : cat.isError ? (
          <ErrorState error={cat.error} onRetry={cat.refetch} />
        ) : (
          <div className="grid max-h-80 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
            {cat.data!.groups.map((g) => (
              <fieldset key={g.group} className="rounded-md border border-border p-2">
                <legend className="px-1 text-xs font-semibold text-text-muted">{g.group}</legend>
                {g.items.map((p) => (
                  <label key={p.code} className="flex items-start gap-2 py-0.5">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={perms.includes(p.code)}
                      onChange={(x) => toggle(p.code, x.target.checked)}
                    />
                    <span>
                      {p.label} <span className="font-mono text-xs text-text-muted">{p.code}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
