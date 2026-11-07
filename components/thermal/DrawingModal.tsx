'use client';

import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Printer, X, Eraser, Palette, RefreshCw, ShieldAlert } from 'lucide-react';
import { getPrintServerUrl, cn } from '@/lib/utils';

const GRID_SIZE = 24;

export function DrawingModal({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [redeploying, setRedeploying] = useState(false);
    const [showSystem, setShowSystem] = useState(false);
    const [redeployKey, setRedeployKey] = useState('');
    const [confirmRedeploy, setConfirmRedeploy] = useState(false);

    // 2D Array representing the 24x24 grid. false = empty, true = filled
    const [grid, setGrid] = useState<boolean[][]>(
        Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(false))
    );

    const [isDrawing, setIsDrawing] = useState(false);
    const [isErasing, setIsErasing] = useState(false); // To support erasing toggled by tool

    // Reset grid when modal closes/opens
    useEffect(() => {
        if (!open) {
            setGrid(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(false)));
            setIsErasing(false);
        }
    }, [open]);

    const handleCellAction = useCallback((row: number, col: number, forceErase?: boolean) => {
        setGrid(prev => {
            const newGrid = prev.map(r => [...r]);
            newGrid[row][col] = forceErase !== undefined ? !forceErase : !isErasing;
            return newGrid;
        });
    }, [isErasing]);

    const handlePointerDown = (row: number, col: number) => {
        setIsDrawing(true);
        handleCellAction(row, col);
    };

    const handlePointerEnter = (row: number, col: number) => {
        if (isDrawing) {
            handleCellAction(row, col);
        }
    };

    const handlePointerUp = () => {
        setIsDrawing(false);
    };

    // Attach global pointer up to catch releases outside the grid
    useEffect(() => {
        window.addEventListener('pointerup', handlePointerUp);
        return () => window.removeEventListener('pointerup', handlePointerUp);
    }, []);

    const handleClear = () => {
        setGrid(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(false)));
    };

    const handlePrint = async () => {
        if (grid.every(row => row.every(cell => !cell))) {
            toast.error("Canvas is empty!");
            return;
        }

        setPrinting(true);
        try {
            // Create an offscreen canvas to rasterize the drawing
            const canvas = document.createElement('canvas');
            const CELL_SIZE = 16;
            const TOTAL_SIZE = GRID_SIZE * CELL_SIZE; // 24 * 16 = 384px (standard 58mm printer width)
            canvas.width = TOTAL_SIZE;
            canvas.height = TOTAL_SIZE;

            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error("Could not get 2d context");

            // Fill white background
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, TOTAL_SIZE, TOTAL_SIZE);

            // Draw filled black pixels
            ctx.fillStyle = '#000000';
            for (let r = 0; r < GRID_SIZE; r++) {
                for (let c = 0; c < GRID_SIZE; c++) {
                    if (grid[r][c]) {
                        ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                    }
                }
            }

            // Extract base64
            const dataUrl = canvas.toDataURL('image/png');

            const payload = {
                title: "THERMALFLOW STUDIO",
                date: new Date().toLocaleString(),
                image: dataUrl
            };

            const printServerUrl = getPrintServerUrl();
            const res = await fetch(`${printServerUrl}/print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                toast.success("Artwork sent to printer!");
                setOpen(false); // Close on success
            } else {
                throw new Error("Printer server error");
            }
        } catch (e) {
            console.error(e);
            toast.error("Failed to print artwork.");
        } finally {
            setPrinting(false);
        }
    };

    const handleRedeploy = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!redeployKey.trim()) {
            toast.error("Please enter the redeploy authorization key.");
            return;
        }

        setRedeploying(true);
        try {
            const res = await fetch('/api/admin/redeploy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-redeploy-key': redeployKey.trim()
                }
            });

            if (res.ok) {
                toast.success("Redeploy triggered! This page will reload in 60s.");
                setConfirmRedeploy(false);
                setRedeployKey('');
                setTimeout(() => {
                    window.location.reload();
                }, 60000);
            } else {
                throw new Error("Unauthorized or failed to trigger redeploy");
            }
        } catch (e) {
            console.error(e);
            toast.error("Redeploy initiation failed. Check your authorization key.");
        } finally {
            setRedeploying(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>

            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-md bg-card text-foreground border border-zinc-200 dark:border-zinc-800 p-0 overflow-hidden font-mono shadow-2xl rounded-2xl">
                <DialogTitle className="sr-only">Drawing Studio</DialogTitle>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/50">
                    <div className="flex items-center gap-2">
                        <Palette size={18} className="text-zinc-500 dark:text-zinc-400" />
                        <h2 className="text-sm font-bold tracking-widest uppercase">ThermalFlow Studio</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            aria-label="System Administration"
                            aria-expanded={showSystem}
                            onClick={() => setShowSystem(!showSystem)}
                            className={cn("p-2 rounded-md transition-colors", showSystem ? "bg-red-500/15 text-red-600 dark:text-red-400" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white")}
                            title="System Administration"
                        >
                            <ShieldAlert size={18} />
                        </button>
                        <button
                            type="button"
                            aria-label="Close studio"
                            onClick={() => setOpen(false)}
                            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors p-1"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="p-6 flex flex-col items-center gap-6">
                    {/* Retro Canvas Wrapper */}
                    <div className="bg-white p-2 rounded shrink-0 shadow-md border border-zinc-200 dark:border-zinc-700 relative group">
                        <div
                            role="grid"
                            aria-label="24 by 24 pixel drawing canvas"
                            className="grid bg-zinc-100 touch-none"
                            style={{
                                gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))`
                            }}
                            onPointerLeave={() => setIsDrawing(false)}
                        >
                            {grid.map((row, rIdx) => (
                                row.map((cell, cIdx) => (
                                    <div
                                        key={`${rIdx}-${cIdx}`}
                                        onPointerDown={(e) => {
                                            if (e.button !== 0 && e.pointerType === 'mouse') return;
                                            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                                            handlePointerDown(rIdx, cIdx);
                                        }}
                                        onPointerEnter={() => handlePointerEnter(rIdx, cIdx)}
                                        className={cn(
                                            "w-3 h-3 md:w-4 md:h-4 border-[0.5px] border-zinc-200/50 transition-colors duration-75 select-none",
                                            cell ? "bg-black border-black" : "bg-white hover:bg-zinc-100"
                                        )}
                                    />
                                ))
                            ))}
                        </div>
                    </div>

                    {/* Tools & Controls */}
                    <div className="flex items-center justify-between w-full">
                        <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-lg p-1 border border-zinc-200 dark:border-zinc-800" role="group" aria-label="Drawing Tools">
                            <button
                                type="button"
                                aria-pressed={!isErasing}
                                onClick={() => setIsErasing(false)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md transition-colors text-xs font-bold flex items-center gap-2",
                                    !isErasing ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                                )}
                            >
                                <div className="w-3 h-3 bg-zinc-900 dark:bg-white rounded-xs" />
                                Draw
                            </button>
                            <button
                                type="button"
                                aria-pressed={isErasing}
                                onClick={() => setIsErasing(true)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md transition-colors text-xs font-bold flex items-center gap-2",
                                    isErasing ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                                )}
                            >
                                <Eraser size={14} />
                                Erase
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={handleClear}
                            className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400 uppercase tracking-widest font-bold px-3 py-2 transition-colors"
                        >
                            Clear
                        </button>
                    </div>

                    {showSystem && (
                        <div className="w-full bg-red-500/10 border border-red-500/30 p-4 rounded-xl animate-in fade-in slide-in-from-top-2 space-y-3">
                            <h3 className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-widest flex items-center gap-2">
                                <ShieldAlert size={14} /> Master Control
                            </h3>
                            {!confirmRedeploy ? (
                                <Button
                                    type="button"
                                    onClick={() => setConfirmRedeploy(true)}
                                    variant="destructive"
                                    className="w-full font-bold uppercase tracking-widest h-10 bg-red-600 hover:bg-red-700 text-white"
                                >
                                    <RefreshCw className="mr-2" size={15} />
                                    Rebuild System
                                </Button>
                            ) : (
                                <form onSubmit={handleRedeploy} className="space-y-2.5">
                                    <label htmlFor="redeploy-auth-key" className="block text-[10px] font-bold uppercase text-red-600 dark:text-red-400">
                                        Enter Redeploy Authorization Key
                                    </label>
                                    <input
                                        id="redeploy-auth-key"
                                        type="password"
                                        value={redeployKey}
                                        onChange={(e) => setRedeployKey(e.target.value)}
                                        placeholder="REDEPLOY_KEY..."
                                        autoFocus
                                        className="w-full bg-white dark:bg-zinc-950 border border-red-500/40 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-red-500"
                                    />
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => { setConfirmRedeploy(false); setRedeployKey(''); }}
                                            className="flex-1 text-xs"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="submit"
                                            size="sm"
                                            disabled={redeploying || !redeployKey.trim()}
                                            variant="destructive"
                                            className="flex-1 text-xs font-bold bg-red-600 hover:bg-red-700 text-white"
                                        >
                                            {redeploying ? <RefreshCw className="animate-spin mr-1.5" size={13} /> : null}
                                            {redeploying ? 'Rebuilding...' : 'Confirm Rebuild'}
                                        </Button>
                                    </div>
                                </form>
                            )}
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 text-center leading-relaxed">
                                Pulls latest git main, rebuilds frontend, and restarts services (~60s downtime).
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer Action */}
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30">
                    <Button
                        type="button"
                        onClick={handlePrint}
                        disabled={printing}
                        className="w-full bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 border-none font-bold uppercase tracking-widest h-11"
                    >
                        {printing ? 'Rasterizing...' : 'Print Artist Edition'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
