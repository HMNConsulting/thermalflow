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
        <div className="flex items-center gap-3">
            <div className="flex -space-x-1.5 p-1">
                {creators.map((email: string) => {
                    const color = getUserColor(email);
                    const isMe = email === currentUser;
                    const isFiltered = activeFilters.creator === email;
                    const isOtherFiltered = activeFilters.creator !== null && activeFilters.creator !== email;


                    return (
                        <div
                            key={email}
                            title={email}
                            onClick={() => setCreatorFilter(isFiltered ? null : email)}
                            className={cn(
                                "relative inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-white dark:ring-zinc-950 transition-transform hover:z-10 hover:scale-110 cursor-pointer",
                                color.bg,
                                color.text,
                                isMe && "ring-offset-1 ring-zinc-900 dark:ring-zinc-100",
                                isOtherFiltered && "opacity-30 grayscale"
                            )}
                        >
                            {getUserInitial(email)}
                            {isMe && (
                                <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full border border-white dark:border-zinc-950" />
                            )}
                        </div>
                    );
                })}
            </div>
            <span className="text-[10px] text-zinc-400 font-mono hidden lg:block uppercase tracking-tighter">
                {creators.length} COLLABORATOR{creators.length !== 1 ? 'S' : ''}
            </span>
        </div>
    );
}
