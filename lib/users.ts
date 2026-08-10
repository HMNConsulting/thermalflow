export interface UserColor {
    bg: string;
    text: string;
    border: string;
    ring: string;
    light: string;
    nested: string;
}

export const USER_PALETTE: UserColor[] = [
    { bg: 'bg-rose-500', border: 'border-rose-600', text: 'text-white', ring: 'ring-rose-500', light: 'bg-rose-100 dark:bg-rose-900/30', nested: 'bg-rose-200 dark:bg-rose-800/40' },
    { bg: 'bg-orange-500', border: 'border-orange-600', text: 'text-white', ring: 'ring-orange-500', light: 'bg-orange-100 dark:bg-orange-900/30', nested: 'bg-orange-200 dark:bg-orange-800/40' },
    { bg: 'bg-amber-500', border: 'border-amber-600', text: 'text-white', ring: 'ring-amber-500', light: 'bg-amber-100 dark:bg-amber-900/30', nested: 'bg-amber-200 dark:bg-amber-800/40' },
    // Removed Emerald/Teal to avoid collision with 'local' gray/green confusion and ensure high contrast
    { bg: 'bg-cyan-500', border: 'border-cyan-600', text: 'text-white', ring: 'ring-cyan-500', light: 'bg-cyan-100 dark:bg-cyan-900/30', nested: 'bg-cyan-200 dark:bg-cyan-800/40' },
    { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-white', ring: 'ring-blue-500', light: 'bg-blue-100 dark:bg-blue-900/30', nested: 'bg-blue-200 dark:bg-blue-800/40' },
    { bg: 'bg-indigo-500', border: 'border-indigo-600', text: 'text-white', ring: 'ring-indigo-500', light: 'bg-indigo-100 dark:bg-indigo-900/30', nested: 'bg-indigo-200 dark:bg-indigo-800/40' },
    { bg: 'bg-violet-500', border: 'border-violet-600', text: 'text-white', ring: 'ring-violet-500', light: 'bg-violet-100 dark:bg-violet-900/30', nested: 'bg-violet-200 dark:bg-violet-800/40' },
    { bg: 'bg-purple-500', border: 'border-purple-600', text: 'text-white', ring: 'ring-purple-500', light: 'bg-purple-100 dark:bg-purple-900/30', nested: 'bg-purple-200 dark:bg-purple-800/40' },
    { bg: 'bg-fuchsia-500', border: 'border-fuchsia-600', text: 'text-white', ring: 'ring-fuchsia-500', light: 'bg-fuchsia-100 dark:bg-fuchsia-900/30', nested: 'bg-fuchsia-200 dark:bg-fuchsia-800/40' },
    { bg: 'bg-pink-500', border: 'border-pink-600', text: 'text-white', ring: 'ring-pink-500', light: 'bg-pink-100 dark:bg-pink-900/30', nested: 'bg-pink-200 dark:bg-pink-800/40' },
];

export function getUserColor(email: string): UserColor {
    if (email.toLowerCase() === 'local') {
        return {
            bg: 'bg-yellow-500',
            border: 'border-yellow-600',
            text: 'text-white',
            ring: 'ring-yellow-500',
            light: 'bg-yellow-100 dark:bg-yellow-800/50',
            nested: 'bg-yellow-200 dark:bg-yellow-700/50'
        };
    }

    let hash = 0;
    for (let i = 0; i < email.length; i++) {
        hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % USER_PALETTE.length;
    return USER_PALETTE[index];
}

export function getUserInitial(email: string): string {
    if (!email) return '?';
    if (email.toLowerCase() === 'local') return 'LOC';
    return email.charAt(0).toUpperCase();
}
