"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Bookmark, Check, Plus, Save, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  applyView,
  deleteView,
  listViews,
  saveAsNewView,
  setDefaultView,
  updateView,
  type SavedViewRow,
} from "../actions";
import type { ViewPayload, ViewScope } from "../types";

type Props = {
  scope: ViewScope;
  currentPayload: ViewPayload;
  activeViewId: string | null;
  onApply: (id: string, payload: ViewPayload) => void;
  className?: string;
};

export function ViewsSwitcher({
  scope,
  currentPayload,
  activeViewId,
  onApply,
  className,
}: Props) {
  const [views, setViews] = useState<SavedViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const reload = useCallback(async () => {
    setLoading(true);
    const next = await listViews(scope);
    setViews(next);
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const defaultView = views.find((v) => v.is_default) ?? null;
  const triggerLabel = activeView?.name ?? "Vue par défaut";

  const handleApply = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await applyView(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onApply(id, res.payload);
      setOpen(false);
    });
  };

  const handleSaveAsNew = () => {
    setSaveError(null);
    setSaveName("");
    setSaveDialogOpen(true);
    setOpen(false);
  };

  const submitSave = (name: string) => {
    setSaveError(null);
    startTransition(async () => {
      const res = await saveAsNewView({ scope, name, payload: currentPayload });
      if (!res.ok) {
        setSaveError(res.error);
        return;
      }
      await reload();
      onApply(res.id, currentPayload);
      setSaveDialogOpen(false);
    });
  };

  const handleUpdateActive = () => {
    if (!activeViewId) return;
    setError(null);
    startTransition(async () => {
      const res = await updateView(activeViewId, { payload: currentPayload });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await reload();
    });
  };

  const handleSetDefault = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await setDefaultView(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await reload();
    });
  };

  const handleDelete = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await deleteView(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await reload();
      if (id === activeViewId) onApply("", currentPayload);
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={cn("gap-1.5", className)}
              aria-label="Vues sauvegardées"
            >
              <Bookmark className="size-3.5" />
              <span className="max-w-[12rem] truncate">{triggerLabel}</span>
            </Button>
          }
        />
        <PopoverContent align="end" className="w-72 p-1">
          <div className="flex flex-col">
            <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
              Vues sauvegardées
            </div>
            {loading ? (
              <div className="text-muted-foreground px-2 py-2 text-xs">Chargement…</div>
            ) : views.length === 0 ? (
              <div className="text-muted-foreground px-2 py-2 text-xs">
                Aucune vue. Sauvegarde la configuration actuelle pour la retrouver plus tard.
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {views.map((v) => {
                  const isActive = v.id === activeViewId;
                  return (
                    <li key={v.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleApply(v.id)}
                        className={cn(
                          "hover:bg-accent flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm",
                          isActive && "bg-accent/60",
                        )}
                      >
                        <Check
                          className={cn(
                            "size-3.5 shrink-0",
                            isActive ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">{v.name}</span>
                        {v.is_default ? (
                          <Star className="size-3 shrink-0 fill-current" aria-label="Par défaut" />
                        ) : null}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetDefault(v.id);
                        }}
                        aria-label="Définir comme vue par défaut"
                        disabled={v.is_default}
                        className="opacity-0 group-hover:opacity-100 data-disabled:opacity-30"
                      >
                        <Star className={cn("size-3.5", v.is_default && "fill-current")} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(v.id);
                        }}
                        aria-label="Supprimer la vue"
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="text-destructive size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="border-border my-1 border-t" />
            <button
              type="button"
              onClick={handleSaveAsNew}
              className="hover:bg-accent flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm"
            >
              <Plus className="size-3.5" />
              Sauvegarder comme nouvelle vue…
            </button>
            <button
              type="button"
              onClick={handleUpdateActive}
              disabled={!activeViewId}
              className="hover:bg-accent flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="size-3.5" />
              Mettre à jour la vue active
            </button>
            {error ? (
              <div className="text-destructive px-2 py-1 text-xs">{error}</div>
            ) : defaultView ? null : null}
          </div>
        </PopoverContent>
      </Popover>

      <SaveViewDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        value={saveName}
        onValueChange={setSaveName}
        error={saveError}
        onSubmit={submitSave}
      />
    </>
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  value,
  onValueChange,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (next: string) => void;
  error: string | null;
  onSubmit: (name: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sauvegarder la vue</DialogTitle>
          <DialogDescription>
            Donne un nom à cette configuration de colonnes, filtres, recherche et tri.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
          className="flex flex-col gap-2"
        >
          <Label htmlFor="view-name">Nom</Label>
          <Input
            id="view-name"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder="ex. Tableau de bord, Fiscal, Détaillée…"
            maxLength={80}
            autoFocus
          />
          {error ? <div className="text-destructive text-xs">{error}</div> : null}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>
              Annuler
            </DialogClose>
            <Button type="submit" disabled={!value.trim()}>
              Sauvegarder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
