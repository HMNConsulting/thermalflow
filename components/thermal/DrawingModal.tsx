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

    const handleRedeploy = async () => {
        if (!confirm("Are you sure? This will REBUILD and RESTART the entire ThermalFlow server. The site will be offline for ~60 seconds.")) return;

        const key = prompt("Enter redeploy authorization key:");
        if (!key) return;

        setRedeploying(true);
        try {
            const res = await fetch('/api/admin/redeploy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-redeploy-key': key
                }
            });

            if (res.ok) {
                toast.success("Redeploy triggered! This page will stop responding soon.");
                setTimeout(() => {
                    window.location.reload();
                }, 60000); // Reload after 60s
            } else {
                throw new Error("Failed to trigger redeploy");
            }
        } catch (e) {
            console.error(e);
            toast.error("Redeploy initiation failed.");
        } finally {
            setRedeploying(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>

            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-md bg-zinc-950 text-white border-zinc-800 p-0 overflow-hidden font-mono shadow-2xl">
                <DialogTitle className="sr-only">Drawing Studio</DialogTitle>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center gap-2">
                        <Palette size={18} className="text-zinc-400" />
                        <h2 className="text-sm font-bold tracking-widest uppercase">ThermalFlow Studio</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowSystem(!showSystem)}
                            className={cn("p-2 rounded-md transition-colors", showSystem ? "bg-red-900/40 text-red-500" : "text-zinc-500 hover:text-white")}
                            title="System Administration"
                        >
                            <ShieldAlert size={18} />
                        </button>
                        <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="p-6 flex flex-col items-center gap-6">
                    {/* Retro Canvas Wrapper */}
                    <div className="bg-white p-2 rounded shrink-0 shadow-[0_0_15px_rgba(255,255,255,0.1)] relative group">
                        <div
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
                                            // Ensure left-click / touch only
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
                        <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                            <button
                                onClick={() => setIsErasing(false)}
                                className={cn(
                                    "p-2 rounded-md transition-all text-sm flex items-center gap-2",
                                    !isErasing ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-300"
                                )}
                            >
                                <div className="w-3 h-3 bg-white rounded-sm outline outline-1 outline-white/20" />
                                Draw
                            </button>
                            <button
                                onClick={() => setIsErasing(true)}
                                className={cn(
                                    "p-2 rounded-md transition-all text-sm flex items-center gap-2",
                                    isErasing ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-300"
                                )}
                            >
                                <Eraser size={14} />
                                Erase
                            </button>
                        </div>

                        <button
                            onClick={handleClear}
                            className="text-xs text-zinc-500 hover:text-red-400 uppercase tracking-widest font-bold px-3 py-2 transition-colors"
                        >
                            Clear
                        </button>
                    </div>

                    {showSystem && (
                        <div className="w-full bg-red-950/30 border border-red-900/50 p-4 rounded-lg animate-in fade-in slide-in-from-top-2">
                            <h3 className="text-xs font-bold text-red-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <ShieldAlert size={14} /> Master Control
                            </h3>
                            <Button
                                onClick={handleRedeploy}
                                disabled={redeploying}
                                variant="destructive"
                                className="w-full font-bold uppercase tracking-widest h-10 border-red-900 bg-red-900/50 hover:bg-red-800"
                            >
                                {redeploying ? <RefreshCw className="animate-spin mr-2" size={16} /> : <RefreshCw className="mr-2" size={16} />}
                                {redeploying ? 'Rebuilding...' : 'Rebuild System'}
                            </Button>
                            <p className="text-[10px] text-zinc-500 mt-2 text-center leading-relaxed">
                                Forces server to run npm install, rebuild frontend, and restart services. This will interrupt all connections.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer Action */}
                <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
                    <Button
                        onClick={handlePrint}
                        disabled={printing}
                        className="w-full bg-white text-black hover:bg-zinc-200 border-none font-bold uppercase tracking-widest h-12"
                    >
                        {printing ? 'Rasterizing...' : 'Print Artist Edition'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
