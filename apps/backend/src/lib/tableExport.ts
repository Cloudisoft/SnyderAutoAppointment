import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';
import { DateTime } from 'luxon';
import { toCsv } from './csv';

export type ExportColumn<R> = [header: string, value: (row: R) => unknown];

// Excel rejects cells longer than this; long transcripts are truncated in XLSX only.
const XLSX_CELL_MAX = 32_000;

/** Sends rows as a CSV or XLSX download named `<name>-<timestamp>.<ext>`. */
export async function sendTableExport<R>(
  reply: FastifyReply,
  opts: { format: 'csv' | 'xlsx'; name: string; sheet: string; columns: ExportColumn<R>[]; rows: R[]; now: Date },
) {
  const stamp = DateTime.fromJSDate(opts.now).toFormat('yyyyLLdd-HHmm');
  const headers = opts.columns.map(([h]) => h);
  const values = opts.rows.map((r) => opts.columns.map(([, f]) => cell(f(r))));
  if (opts.format === 'csv') {
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${opts.name}-${stamp}.csv"`)
      .send('﻿' + toCsv(headers, values));
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheet);
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(60, Math.max(12, h.length + 2)) }));
  for (const row of values) {
    ws.addRow(row.map((v) => (typeof v === 'string' && v.length > XLSX_CELL_MAX ? `${v.slice(0, XLSX_CELL_MAX)}…` : (v ?? ''))));
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return reply
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('content-disposition', `attachment; filename="${opts.name}-${stamp}.xlsx"`)
    .send(Buffer.from(buf as ArrayBuffer));
}

function cell(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
