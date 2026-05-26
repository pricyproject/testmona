import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  History,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Webhook,
  XCircle,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { webhooksAPI, getApiErrorMessage } from '@/lib/api';

interface WebhookRow {
  id: number;
  project_id: number;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
}

interface DeliveryRow {
  id: number;
  subscription_id: number;
  event: string;
  status: string;
  attempts: number;
  response_status?: number | null;
  response_body?: string | null;
  error?: string | null;
  delivered_at?: string | null;
  created_at: string;
}

const formatWhen = (value?: string | null): string => {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
};

const isPrivateWebhookHost = (host: string): boolean => {
  const normalized = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

const isValidWebhookUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value.trim());
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash &&
      !isPrivateWebhookHost(parsed.hostname)
    );
  } catch {
    return false;
  }
};

const STATUS_BADGE: Record<string, { variant: 'default' | 'destructive' | 'secondary' | 'outline'; tone: string }> = {
  success: { variant: 'default', tone: 'bg-emerald-100 text-emerald-700' },
  failed: { variant: 'destructive', tone: '' },
  pending: { variant: 'secondary', tone: '' },
};

export function Webhooks() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const numericProjectId = projectId ? Number(projectId) : null;
  const { t } = useTranslation();
  const { toast } = useToast();

  const [hooks, setHooks] = useState<WebhookRow[]>([]);
  const [supportedEvents, setSupportedEvents] = useState<string[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [formActive, setFormActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<WebhookRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [deliveriesFor, setDeliveriesFor] = useState<WebhookRow | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [isDeliveriesLoading, setIsDeliveriesLoading] = useState(false);
  const [busyDeliveryId, setBusyDeliveryId] = useState<number | null>(null);

  const load = async () => {
    if (!numericProjectId) return;
    setIsLoading(true);
    setError(null);
    setEventsError(null);
    try {
      const rows = await webhooksAPI.list(numericProjectId);
      setHooks(Array.isArray(rows) ? rows : []);
      try {
        const events = await webhooksAPI.supportedEvents();
        setSupportedEvents(Array.isArray(events) ? events : []);
      } catch (eventsErr) {
        setSupportedEvents([]);
        setEventsError(getApiErrorMessage(eventsErr, t('failedToLoadWebhookEvents')));
      }
    } catch (err) {
      setError(getApiErrorMessage(err, t('failedToLoadWebhooks')));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const resetForm = () => {
    setFormName('');
    setFormUrl('');
    setFormEvents([]);
    setFormActive(true);
    setCreatedSecret(null);
  };

  const toggleEvent = (event: string) => {
    setFormEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  };

  const handleCreate = async () => {
    if (!numericProjectId) return;
    if (!formName.trim() || !formUrl.trim() || formEvents.length === 0) {
      toast({
        title: t('error'),
        description: t('webhookFormIncomplete'),
        variant: 'destructive',
      });
      return;
    }
    if (!isValidWebhookUrl(formUrl)) {
      toast({
        title: t('error'),
        description: t('invalidWebhookUrl'),
        variant: 'destructive',
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await webhooksAPI.create(numericProjectId, {
        name: formName.trim(),
        url: formUrl.trim(),
        events: formEvents,
        is_active: formActive,
      });
      setCreatedSecret(created.secret);
      setHooks((prev) => [created as WebhookRow, ...prev]);
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToCreateWebhook')),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (hook: WebhookRow, nextActive: boolean) => {
    if (!numericProjectId) return;
    const updated = await webhooksAPI
      .update(numericProjectId, hook.id, { is_active: nextActive })
      .catch((err) => {
        toast({
          title: t('error'),
          description: getApiErrorMessage(err, t('failedToUpdateWebhook')),
          variant: 'destructive',
        });
        return null;
      });
    if (updated) {
      setHooks((prev) => prev.map((h) => (h.id === hook.id ? { ...h, is_active: updated.is_active } : h)));
    }
  };

  const handleDelete = async () => {
    if (!numericProjectId || !deleteTarget) return;
    setIsDeleting(true);
    try {
      await webhooksAPI.remove(numericProjectId, deleteTarget.id);
      setHooks((prev) => prev.filter((h) => h.id !== deleteTarget.id));
      toast({ title: t('success'), description: t('webhookDeleted') });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToDeleteWebhook')),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSendTest = async (hook: WebhookRow) => {
    if (!numericProjectId) return;
    try {
      await webhooksAPI.test(numericProjectId, hook.id);
      toast({ title: t('success'), description: t('webhookPingSent') });
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToSendWebhookPing')),
        variant: 'destructive',
      });
    }
  };

  const openDeliveries = async (hook: WebhookRow) => {
    if (!numericProjectId) return;
    setDeliveriesFor(hook);
    setIsDeliveriesLoading(true);
    setDeliveries([]);
    try {
      const rows = await webhooksAPI.deliveries(numericProjectId, hook.id, 50);
      setDeliveries(Array.isArray(rows) ? rows : []);
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToLoadWebhookDeliveries')),
        variant: 'destructive',
      });
    } finally {
      setIsDeliveriesLoading(false);
    }
  };

  const redeliver = async (delivery: DeliveryRow) => {
    if (!numericProjectId || !deliveriesFor) return;
    setBusyDeliveryId(delivery.id);
    try {
      const updated = await webhooksAPI.redeliver(numericProjectId, deliveriesFor.id, delivery.id);
      setDeliveries((prev) => prev.map((d) => (d.id === delivery.id ? updated : d)));
      toast({ title: t('success'), description: t('webhookDeliveryQueued') });
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToRedeliverWebhook')),
        variant: 'destructive',
      });
    } finally {
      setBusyDeliveryId(null);
    }
  };

  const copySecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      toast({ title: t('copied'), description: t('webhookSecretCopied') });
    } catch {
      toast({ title: t('error'), description: t('failedToCopy'), variant: 'destructive' });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${projectId}`)} className="gap-1">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t('back')}
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              {t('webhooks')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('webhooksSubtitle')}</p>
          </div>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setCreateOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          {t('createWebhook')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('configuredWebhooks')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          ) : isLoading ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('loading')}
            </div>
          ) : hooks.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">{t('noWebhooksYet')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('url')}</TableHead>
                  <TableHead>{t('events')}</TableHead>
                  <TableHead>{t('active')}</TableHead>
                  <TableHead className="text-end">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hooks.map((hook) => (
                  <TableRow key={hook.id}>
                    <TableCell className="font-medium">{hook.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[260px]" title={hook.url}>
                      {hook.url}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {hook.events.map((event) => (
                          <Badge key={event} variant="outline" className="text-[10px]">
                            {event}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={hook.is_active}
                        onCheckedChange={(value) => handleToggleActive(hook, value)}
                      />
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => handleSendTest(hook)} title={t('webhookSendPing')}>
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openDeliveries(hook)} title={t('webhookViewDeliveries')}>
                          <History className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(hook)}
                          title={t('delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog (and post-create secret reveal) */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{createdSecret ? t('webhookCreated') : t('createWebhook')}</DialogTitle>
            <DialogDescription>
              {createdSecret ? t('webhookSecretWarning') : t('createWebhookDescription')}
            </DialogDescription>
          </DialogHeader>

          {createdSecret ? (
            <div className="space-y-4 py-2">
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>{t('webhookSecretTitle')}</AlertTitle>
                <AlertDescription>{t('webhookSecretBody')}</AlertDescription>
              </Alert>
              <div className="rounded-lg border bg-muted p-3">
                <code className="break-all font-mono text-sm">{createdSecret}</code>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={copySecret} className="gap-2">
                  <Copy className="h-4 w-4" />
                  {t('copy')}
                </Button>
                <Button
                  onClick={() => {
                    setCreateOpen(false);
                    resetForm();
                  }}
                >
                  {t('done')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>{t('name')}</Label>
                  <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('webhookNamePlaceholder')} autoFocus />
                </div>
                <div className="space-y-2">
                  <Label>{t('url')}</Label>
                  <Input type="url" dir="ltr" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} placeholder="https://example.com/hook" />
                </div>
                <div className="space-y-2">
                  <Label>{t('events')}</Label>
                  <div className="rounded-lg border p-3 space-y-2">
                    {supportedEvents.length === 0 ? (
                      <p className={`text-xs ${eventsError ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {eventsError || t('webhookNoEventsAvailable')}
                      </p>
                    ) : (
                      supportedEvents.map((event) => (
                        <label key={event} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox checked={formEvents.includes(event)} onCheckedChange={() => toggleEvent(event)} />
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{event}</code>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{t('active')}</p>
                    <p className="text-xs text-muted-foreground">{t('webhookActiveHelp')}</p>
                  </div>
                  <Switch checked={formActive} onCheckedChange={setFormActive} />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCreateOpen(false);
                    resetForm();
                  }}
                  disabled={isSubmitting}
                >
                  {t('cancel')}
                </Button>
                <Button onClick={handleCreate} disabled={isSubmitting || Boolean(eventsError) || supportedEvents.length === 0}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {t('createWebhook')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteWebhook')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? t('deleteWebhookConfirm', { name: deleteTarget.name }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deliveries viewer */}
      <Dialog open={Boolean(deliveriesFor)} onOpenChange={(open) => !open && setDeliveriesFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('webhookDeliveries')}</DialogTitle>
            <DialogDescription>{deliveriesFor?.name}</DialogDescription>
          </DialogHeader>
          {isDeliveriesLoading ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('loading')}
            </div>
          ) : deliveries.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">{t('noWebhookDeliveriesYet')}</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('webhookDeliveryStatus')}</TableHead>
                    <TableHead>{t('event')}</TableHead>
                    <TableHead>{t('webhookAttempts')}</TableHead>
                    <TableHead>{t('webhookResponse')}</TableHead>
                    <TableHead>{t('created')}</TableHead>
                    <TableHead className="text-end">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((delivery) => {
                    const tone = STATUS_BADGE[delivery.status] || STATUS_BADGE.pending;
                    return (
                      <TableRow key={delivery.id}>
                        <TableCell>
                          <Badge variant={tone.variant} className="gap-1 text-xs">
                            {delivery.status === 'success' && <CheckCircle2 className="h-3 w-3" />}
                            {delivery.status === 'failed' && <XCircle className="h-3 w-3" />}
                            {delivery.status === 'pending' && <Activity className="h-3 w-3 animate-pulse" />}
                            {delivery.status}
                          </Badge>
                        </TableCell>
                        <TableCell><code className="text-xs">{delivery.event}</code></TableCell>
                        <TableCell className="text-sm">{delivery.attempts}</TableCell>
                        <TableCell className="text-sm">
                          {delivery.response_status != null ? `HTTP ${delivery.response_status}` : delivery.error || '-'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatWhen(delivery.created_at)}</TableCell>
                        <TableCell className="text-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => redeliver(delivery)}
                            disabled={busyDeliveryId === delivery.id}
                          >
                            {busyDeliveryId === delivery.id ? <Loader2 className="h-4 w-4 animate-spin" /> : t('redeliver')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
