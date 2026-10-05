import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

/** Row selection for a paged table. `pageIds` are the ids currently shown. */
export function useSelection(pageIds: string[], resetKey = '') {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // "All matching" means every row matching the filters, beyond the current page.
  const [allMatching, setAllMatching] = useState(false);
  useEffect(() => {
    setSelected(new Set());
    setAllMatching(false);
  }, [resetKey]);
  const pageKey = pageIds.join(',');
  return useMemo(() => {
    const onPage = pageIds.filter((id) => selected.has(id)).length;
    return {
      selected,
      ids: [...selected],
      count: selected.size,
      allMatching,
      allOnPage: pageIds.length > 0 && onPage === pageIds.length,
      someOnPage: onPage > 0 && onPage < pageIds.length,
      has: (id: string) => allMatching || selected.has(id),
      toggle(id: string) {
        setAllMatching(false);
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
      togglePage() {
        setAllMatching(false);
        setSelected((prev) => {
          const next = new Set(prev);
          const all = pageIds.every((id) => next.has(id));
          for (const id of pageIds) {
            if (all) next.delete(id);
            else next.add(id);
          }
          return next;
        });
      },
      selectAllMatching() {
        setSelected(new Set(pageIds));
        setAllMatching(true);
      },
      clear() {
        setSelected(new Set());
        setAllMatching(false);
      },
    };
  }, [selected, allMatching, pageKey]);
}
export type Selection = ReturnType<typeof useSelection>;

export function Checkbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange(): void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border-border accent-[var(--primary)] transition-transform duration-150 active:scale-90"
    />
  );
}

/** Header checkbox for a selectable table. */
export function SelectAllCheckbox({ sel }: { sel: Selection }) {
  return <Checkbox label="Select all on this page" checked={sel.allOnPage || sel.allMatching} indeterminate={sel.someOnPage} onChange={sel.togglePage} />;
}

/** Floating action bar shown while rows are selected. */
export function BulkBar({ sel, total, noun, children }: { sel: Selection; total?: number; noun: string; children: ReactNode }) {
  if (!sel.count && !sel.allMatching) return null;
  const n = sel.allMatching && total != null ? total : sel.count;
  const canSelectAll = !sel.allMatching && total != null && sel.allOnPage && total > sel.count;
  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4" role="region" aria-label="Bulk actions">
      <div className="flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-2xl shadow-black/15 backdrop-blur animate-toast-in">
        <span className={cx('grid h-7 min-w-7 place-items-center rounded-full bg-primary px-2 text-xs font-bold text-primary-fg')}>{n.toLocaleString()}</span>
        <span className="text-sm font-medium">{noun}{n === 1 ? '' : 's'} selected</span>
        {canSelectAll && (
          <button className="text-sm font-semibold text-primary hover:underline" onClick={sel.selectAllMatching}>
            Select all {total!.toLocaleString()}
          </button>
        )}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <div className="flex flex-wrap items-center gap-2">{children}</div>
        <button className="ml-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-fg" onClick={sel.clear}>
          Clear
        </button>
      </div>
    </div>
  );
}

export interface BulkResult {
  affected: number;
  skipped: number;
  message: string;
}
