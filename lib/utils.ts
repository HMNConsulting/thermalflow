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
