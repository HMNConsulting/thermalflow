'use client';

import { useTaskStore } from '@/lib/store';
import StickyNote from './StickyNote';
import { useShallow } from 'zustand/react/shallow';

export default function GridView() {
    const selectTask = useTaskStore(state => state.selectTask);
    const topLevelIds = useTaskStore(useShallow(state =>
        (state.tasks['root']?.children || [])
            .filter(id => {
                const task = state.tasks[id];
                if (!task || task.completed) return false;
                if (state.activeFilters.creator && task.createdBy !== state.activeFilters.creator) return false;
                return true;
            })
    ));

    return (
        <div
            className="flex-1 overflow-y-auto p-8 bg-zinc-100 dark:bg-zinc-900/50 scroll-smooth min-h-0"
            onClick={() => selectTask(null)}
        >
            {topLevelIds.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-500 dark:text-zinc-400 gap-2">
                    <span className="font-handwriting text-3xl">No sticky notes yet</span>
                    <span className="text-xs font-mono uppercase tracking-wider">Type below to pin your first task</span>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-10 max-w-[2000px] mx-auto pb-32 items-start">
                    {topLevelIds.map(id => (
                        <StickyNote key={id} taskId={id} />
                    ))}
                </div>
            )}
        </div>
    );
}
