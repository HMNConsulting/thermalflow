'use client';

import { useTaskStore } from '@/lib/store';
import { TaskColumn } from './TaskColumn';
import { useRef, useEffect, useState, useLayoutEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

import { HotkeysModal } from './HotkeysModal';
import { CompletedColumn } from './CompletedColumn';
import { CommandPalette } from './CommandPalette';
import GridView from './GridView';
import GlobalTaskInput from './GlobalTaskInput';


export function ColumnView() {
    const path = useTaskStore(state => state.path);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [isHotkeysOpen, setIsHotkeysOpen] = useState(false);
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

    const showCompleted = useTaskStore(state => state.showCompleted);
    const setShowCompleted = useTaskStore(state => state.setShowCompleted);
    const toggleCompletedColumn = useTaskStore(state => state.toggleCompletedColumn);
    const viewMode = useTaskStore(state => state.viewMode);
    const undo = useTaskStore(state => state.undo);
    const redo = useTaskStore(state => state.redo);


    // Mobile default: hide completed column
    useLayoutEffect(() => {
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            setShowCompleted(false);
        }
    }, [setShowCompleted]);

    const lastAction = useTaskStore(state => state.lastAction);

    // Auto-scroll to end when path changes (navigation)
    useEffect(() => {
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

        // On mobile, if we just added a task, don't jump horizontally to the new empty column
        if (isMobile && lastAction === 'add') {
            return;
        }

        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                left: scrollContainerRef.current.scrollWidth,
                behavior: 'smooth'
            });
        }
    }, [path, lastAction]);

    // Hotkeys & Type-to-focus
    const selectTask = useTaskStore(state => state.selectTask);
    const selectNextTask = useTaskStore(state => state.selectNextTask);
    const selectPrevTask = useTaskStore(state => state.selectPrevTask);
    const selectParentTask = useTaskStore(state => state.selectParentTask);
    const selectChildTask = useTaskStore(state => state.selectChildTask);
    const toggleSelectedTask = useTaskStore(state => state.toggleSelectedTask);
    const deleteTask = useTaskStore(state => state.deleteTask);
    const selectedTaskId = useTaskStore(state => state.selectedTaskId);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tasks = useTaskStore.getState().tasks;
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

            // Global Command Palette Toggle: Ctrl+K or Cmd+K
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setIsCommandPaletteOpen(prev => !prev);
                return;
            }

            // Global Undo / Redo: Ctrl+Z / Ctrl+Y
            if ((e.ctrlKey || e.metaKey) && !isInput) {
                if (e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        redo();
                    } else {
                        undo();
                    }
                    return;
                } else if (e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    redo();
                    return;
                }
            }

            // Special handling for Help Toggle (Global)
            if (e.key === '/' || e.key === '?') {
                if (!isInput || isHotkeysOpen) {
                    e.preventDefault();
                    setIsHotkeysOpen(prev => !prev);
                    return;
                }
            }


            // [ etc hotkeys ...]

            // Input Navigation Overrides
            if (isInput) {
                const inputElement = target as HTMLInputElement;
                const isEmpty = inputElement.value === '';

                // If input is empty, allow navigation and deletion keys to supersede
                if (isEmpty && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Delete' || e.key === '-')) {
                    e.preventDefault();
                    // Fall through to main switch
                } else if (e.key === 'Escape') {
                    // Allow Escape to fall through to deselect even in input
                    // Fall through to main switch
                } else {
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        selectPrevTask();
                        return;
                    }
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        selectNextTask();
                        return;
                    }
                    if (e.key === 'Enter') {
                        // Usually Enter in input adds task (handled by Input's onKeyDown).
                        // We should NOT toggle selected task here if in input.
                        return;
                    }
                    // Allow other keys (Left/Right etc) in input when not empty
                    return;
                }
            }

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (!selectedTaskId) {
                        // Init selection: select first task in root
                        const rootTask = tasks['root'];
                        const firstChild = rootTask?.children?.find(id => !tasks[id]?.completed);
                        if (firstChild) selectTask(firstChild);
                    } else {
                        selectNextTask();
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (!selectedTaskId) {
                        // Init selection: select first task in root
                        const rootTask = tasks['root'];
                        const firstChild = rootTask?.children?.find(id => !tasks[id]?.completed);
                        if (firstChild) selectTask(firstChild);
                    } else {
                        selectPrevTask();
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    selectParentTask();
                    break;
                case '-':
                case 'ArrowRight':
                    e.preventDefault();
                    if (selectedTaskId) {
                        const selectedTask = tasks[selectedTaskId];
                        const hasChildren = selectedTask?.children?.some(id => !tasks[id]?.completed);
                        if (hasChildren) {
                            selectChildTask();
                        } else {
                            // No children - focus global input
                            const input = document.getElementById('global-task-input');
                            if (input) input.focus();
                        }
                    }
                    break;
                case 'Enter':
                    e.preventDefault();
                    toggleSelectedTask();
                    break;
                case 'Delete':
                    e.preventDefault();
                    if (selectedTaskId) {
                        deleteTask(selectedTaskId);
                    }
                    break;
                case 'Escape':
                    // Optional: Close modal if open
                    if (isHotkeysOpen) {
                        setIsHotkeysOpen(false);
                    } else {
                        selectTask(null);
                    }
                    break;
                case '[':
                    // Hotkey to toggle completed column
                    e.preventDefault();
                    toggleCompletedColumn();
                    break;
                default:
                    // Type to focus logic
                    // If single char alphanumeric, focus input
                    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !isHotkeysOpen) {
                        const input = document.getElementById('global-task-input');
                        if (input) {
                            input.focus();
                        }
                    }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectNextTask, selectPrevTask, selectParentTask, selectChildTask, toggleSelectedTask, selectedTaskId, path, isHotkeysOpen, toggleCompletedColumn, selectTask, deleteTask, undo, redo]);

    return (
        <div className="flex-1 flex overflow-hidden bg-background relative min-h-0">
            {/* Main Content Areas */}
            {viewMode === 'column' ? (
                <div
                    ref={scrollContainerRef}
                    onTouchMove={() => {
                        const isMobile = window.innerWidth < 768;
                        if (isMobile && showCompleted) {
                            setShowCompleted(false);
                        }
                    }}
                    className="flex-1 flex overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800 min-h-0 snap-x snap-mandatory"
                >
                    <AnimatePresence>
                        {path.map((taskId, index) => (
                            <div key={`${taskId}-${index}`} className="snap-center sm:snap-align-none">
                                <TaskColumn
                                    parentId={taskId}
                                    depth={index}
                                    activeTaskId={path[index + 1]}
                                    isActiveColumn={index === path.length - 1}
                                />
                            </div>
                        ))}
                    </AnimatePresence>

                    {/* Spacer for comfortable viewing of the last column */}
                    <div className="w-8 sm:w-20 flex-shrink-0" />
                </div>
            ) : (
                <GridView />
            )}

            {/* Global Contextual Input */}
            <GlobalTaskInput />

            {/* Pinned Completed Column - Always visible on right */}
            <AnimatePresence initial={false}>
                {showCompleted && (
                    <motion.aside
                        aria-label="Completed Tasks"
                        initial={{ x: '100%', opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: '100%', opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="h-full w-80 flex-shrink-0 overflow-hidden z-20"
                    >
                        <CompletedColumn />
                    </motion.aside>
                )}
            </AnimatePresence>

            <HotkeysModal open={isHotkeysOpen} onOpenChange={setIsHotkeysOpen} />
            <CommandPalette open={isCommandPaletteOpen} onOpenChange={setIsCommandPaletteOpen} />
        </div>
    );
}


// Helper for cn is now imported from @/lib/utils
