import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getPrintServerUrl(): string {
  if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_PRINT_SERVER_URL || 'http://localhost:3001';

  // We now proxy all print requests through the main server (port 3000)
  // via the /api/print and /api/print-single endpoints.
  // This ensures accessibility via Cloudflare tunnels or other network addresses.
  return '/api';
}

export async function printGroceryListReceipt(
  listTitle: string,
  items: { title: string; completed?: boolean }[]
): Promise<{ ok: boolean; error?: string }> {
  const printServerUrl = getPrintServerUrl();
  const unchecked = items.filter(i => !i.completed);
  const targetItems = unchecked.length > 0 ? unchecked : items;

  const formattedLines = targetItems.map(item => `[${item.completed ? 'x' : ' '}] ${item.title}`);

  try {
    const res = await fetch(`${printServerUrl}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `GROCERY: ${listTitle.toUpperCase()}`,
        date: new Date().toLocaleString(),
        tasks: formattedLines.length > 0 ? formattedLines : ['[ ] (Empty grocery list)'],
        template: 'grocery'
      })
    });
    if (res.ok) {
      return { ok: true };
    }
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || 'Printer offline' };
  } catch {
    return { ok: false, error: 'Printer unreachable' };
  }
}
