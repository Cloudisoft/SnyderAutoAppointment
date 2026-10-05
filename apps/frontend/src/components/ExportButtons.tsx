import { useState } from 'react';
import { downloadFile } from '../lib/api';
import { errorMessage, toast } from '../lib/toast';
import { Button } from './ui';

/** CSV and Excel download buttons for an export endpoint; `query` carries the page's current filters. */
export function ExportButtons({ path, query, name }: { path: string; query: URLSearchParams; name: string }) {
  const [busy, setBusy] = useState<'csv' | 'xlsx' | null>(null);
  async function run(format: 'csv' | 'xlsx') {
    const qs = new URLSearchParams(query);
    qs.delete('limit');
    qs.delete('offset');
    qs.set('format', format);
    setBusy(format);
    try {
      await downloadFile(`${path}?${qs}`, `${name}.${format}`);
      toast.success(`Downloaded ${name}.${format}`);
    } catch (err) {
      toast.error(`Export failed: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <Button size="sm" loading={busy === 'csv'} disabled={!!busy} onClick={() => void run('csv')}>
        <DownloadIcon /> CSV
      </Button>
      <Button size="sm" loading={busy === 'xlsx'} disabled={!!busy} onClick={() => void run('xlsx')}>
        <DownloadIcon /> Excel
      </Button>
    </>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12m0 0l-5-5m5 5l5-5M4 21h16" />
    </svg>
  );
}
