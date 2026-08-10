'use client';

import { useTaskStore } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { getUserColor, getUserInitial } from '@/lib/users';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

export function UserIndicators() {
    const tasks = useTaskStore(state => state.tasks);
    const currentUser = useTaskStore(state => state.currentUser);
    const activeFilters = useTaskStore(state => state.activeFilters);
    const setCreatorFilter = useTaskStore(state => state.setCreatorFilter);

    // Get unique creators from all existing tasks
    const creators = useMemo(() => {
        const unique = new Set<string>();
        Object.values(tasks).forEach(task => {
            const creator = task.createdBy || 'local';
            if (creator !== 'system') {
                unique.add(creator);
            }
        });
        // Ensure current user is in the list even if no tasks yet
        if (currentUser) unique.add(currentUser);
        return Array.from(unique).sort();
    }, [tasks, currentUser]);

    return (
        <div className="flex items-center gap-3">
            <div className="flex -space-x-1.5 p-1">
                {creators.map((email) => {
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
