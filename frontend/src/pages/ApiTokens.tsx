import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { apiTokensAPI, getApiErrorMessage } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { usePermissions } from '@/hooks/usePermissions';

interface TokenRow {
  id: number;
  name: string;
  prefix: string;
  last_used_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
}

const formatWhen = (value?: string | null, fallback = '-'): string => {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleString();
};

export function ApiTokens() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { canWrite } = usePermissions();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newExpires, setNewExpires] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<TokenRow | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await apiTokensAPI.list();
      setTokens(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(getApiErrorMessage(err, t('failedToLoadApiTokens')));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();

  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast({
        title: t('error'),
        description: t('apiTokenNameRequired'),
        variant: 'destructive',
      });
      return;
    }
    setIsCreating(true);
    try {
      const expiresIso = newExpires ? new Date(newExpires).toISOString() : null;
      const created = await apiTokensAPI.create({ name, expires_at: expiresIso });
      setCreatedToken(created.token);
      setTokens((prev) => [
        {
          id: created.id,
          name: created.name,
          prefix: created.prefix,
          last_used_at: created.last_used_at,
          expires_at: created.expires_at,
          revoked_at: created.revoked_at,
          created_at: created.created_at,
        },
        ...prev,
      ]);
      setNewName('');
      setNewExpires('');
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToCreateApiToken')),
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setIsRevoking(true);
    try {
      await apiTokensAPI.revoke(revokeTarget.id);
      setTokens((prev) => prev.filter((t) => t.id !== revokeTarget.id));
      toast({ title: t('success'), description: t('apiTokenRevoked') });
      setRevokeTarget(null);
    } catch (err) {
      toast({
        title: t('error'),
        description: getApiErrorMessage(err, t('failedToRevokeApiToken')),
        variant: 'destructive',
      });
    } finally {
      setIsRevoking(false);
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCreatedToken(null);
    setNewName('');
    setNewExpires('');
  };

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      toast({ title: t('copied'), description: t('apiTokenCopied') });
    } catch {
      toast({ title: t('error'), description: t('failedToCopy'), variant: 'destructive' });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('apiTokens')}</h1>
          <p className="text-sm text-muted-foreground">{t('apiTokensSubtitle')}</p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t('createApiToken')}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            {t('yourTokens')}
          </CardTitle>
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
          ) : tokens.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">{t('noApiTokensYet')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('apiTokenPrefix')}</TableHead>
                  <TableHead>{t('apiTokenLastUsed')}</TableHead>
                  <TableHead>{t('apiTokenExpires')}</TableHead>
                  <TableHead>{t('created')}</TableHead>
                  <TableHead className="text-end">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.prefix}…</code>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatWhen(row.last_used_at, t('apiTokenNeverUsed'))}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatWhen(row.expires_at, t('apiTokenNoExpiry'))}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatWhen(row.created_at)}</TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRevokeTarget(row)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) closeCreate();
          else setCreateOpen(true);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createdToken ? t('apiTokenCreated') : t('createApiToken')}</DialogTitle>
            <DialogDescription>
              {createdToken ? t('apiTokenShownOnceDescription') : t('createApiTokenDescription')}
            </DialogDescription>
          </DialogHeader>

          {createdToken ? (
            <div className="space-y-4 py-2">
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>{t('apiTokenSecretWarningTitle')}</AlertTitle>
                <AlertDescription>{t('apiTokenSecretWarning')}</AlertDescription>
              </Alert>
              <div className="rounded-lg border bg-muted p-3">
                <code className="break-all font-mono text-sm">{createdToken}</code>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={copyToken} className="gap-2">
                  <Copy className="h-4 w-4" />
                  {t('copy')}
                </Button>
                <Button onClick={closeCreate}>{t('done')}</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>{t('name')}</Label>
                  <Input
                    placeholder={t('apiTokenNamePlaceholder')}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && newName.trim() && !isCreating) {
                        e.preventDefault();
                        void handleCreate();
                      }
                    }}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('apiTokenExpires')} <span className="text-xs text-muted-foreground">({t('optional')})</span></Label>
                  <Input
                    type="datetime-local"
                    value={newExpires}
                    onChange={(e) => setNewExpires(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeCreate} disabled={isCreating}>{t('cancel')}</Button>
                <Button onClick={handleCreate} disabled={isCreating || !newName.trim()}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {t('createApiToken')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revokeApiToken')}</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget ? t('revokeApiTokenConfirm', { name: revokeTarget.name }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleRevoke();
              }}
              disabled={isRevoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('apiTokenHowToUseTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{t('apiTokenHowToUseBody')}</p>
          <pre className="rounded-lg bg-muted p-3 text-xs overflow-auto">
{`curl -X POST http://localhost:8000/test-runs/123/import-results \\
  -H "Authorization: Bearer tmona_..." \\
  -F "file=@junit.xml"`}
          </pre>
          <p>
            <Badge variant="outline">{t('apiTokenScopeBadge')}</Badge>{' '}
            {t('apiTokenScopeNote')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
