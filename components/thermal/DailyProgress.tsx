'use client';

import { useTaskStore } from "@/lib/store";
import { useEffect, useState } from "react";

export function DailyProgress() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const completedToday = useTaskStore((state) => {
        const today = new Date();
        const todayDate = today.getDate();
        const todayMonth = today.getMonth();
        const todayYear = today.getFullYear();

        let count = 0;
        for (const id in state.tasks) {
            const t = state.tasks[id];
            if (t.completed && t.completedAt) {
                const d = new Date(t.completedAt);
                if (d.getDate() === todayDate && d.getMonth() === todayMonth && d.getFullYear() === todayYear) {
                    count++;
                }
            }
        }
        return count;
    });

    if (!mounted || completedToday === 0) return null;



    return (
        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-500">
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest hidden md:inline-block">Today</span>
            <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-900 px-2 py-1 rounded-full border border-zinc-200 dark:border-zinc-800">
                <span className="text-xs">⚡</span>
                <span className="text-xs font-bold font-mono">{completedToday}</span>
            </div>
        </div>
    );
}
