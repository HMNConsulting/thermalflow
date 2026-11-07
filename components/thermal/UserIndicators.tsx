'use client';

import { useTaskStore, useUniqueCreators } from '@/lib/store';
import { getUserColor, getUserInitial } from '@/lib/users';
import { cn } from '@/lib/utils';

export function UserIndicators() {
    const creators = useUniqueCreators();
    const currentUser = useTaskStore(state => state.currentUser);
    const activeFilters = useTaskStore(state => state.activeFilters);
    const setCreatorFilter = useTaskStore(state => state.setCreatorFilter);

    return (
        <div className="flex items-center gap-3" role="group" aria-label="Filter by collaborator">
            <div className="flex -space-x-1 p-1">
                {creators.map((email: string) => {
                    const color = getUserColor(email);
                    const isMe = email === currentUser;
                    const isFiltered = activeFilters.creator === email;
                    const isOtherFiltered = activeFilters.creator !== null && activeFilters.creator !== email;

                    return (
                        <button
                            key={email}
                            type="button"
                            aria-pressed={isFiltered}
                            aria-label={`Filter tasks by ${email}${isMe ? ' (you)' : ''}`}
                            title={`Filter by ${email}`}
                            onClick={() => setCreatorFilter(isFiltered ? null : email)}
                            className={cn(
                                "relative inline-flex h-7 w-7 sm:h-6 sm:w-6 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-background transition-transform hover:z-10 hover:scale-110 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 focus-visible:z-20",
                                color.bg,
                                color.text,
                                isMe && "ring-offset-1 ring-zinc-900 dark:ring-zinc-100",
                                isFiltered && "scale-110 z-10 ring-zinc-900 dark:ring-zinc-100",
                                isOtherFiltered && "opacity-35 grayscale"
                            )}
                        >
                            {getUserInitial(email)}
                            {isMe && (
                                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full border border-background" />
                            )}
                        </button>
                    );
                })}
            </div>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono hidden lg:block uppercase tracking-tighter">
                {creators.length} COLLABORATOR{creators.length !== 1 ? 'S' : ''}
            </span>
        </div>
    );
}
