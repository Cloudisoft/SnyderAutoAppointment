import { useSyncExternalStore } from 'react';

export type ToastTone = 'error' | 'success' | 'info';
export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Shows a toast. Identical messages already on screen are not repeated. */
export function toast(message: string, tone: ToastTone = 'info') {
  if (toasts.some((t) => t.message === message && t.tone === tone)) return;
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, tone, message }];
  emit();
  setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 3500);
}
toast.error = (message: string) => toast(message, 'error');
toast.success = (message: string) => toast(message, 'success');

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Something went wrong. Please try again.';
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
