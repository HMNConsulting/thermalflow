'use client';

import { useState, useEffect } from 'react';
import { useTaskStore } from '@/lib/store';
import { Printer, CheckCircle2, AlertTriangle, RefreshCw, QrCode, Volume2, VolumeX, Sparkles, ChevronDown } from 'lucide-react';
import { getPrintServerUrl, cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PrinterStatus {
    connected: boolean;
    printerFound?: boolean;
    availablePrinters?: number;
    error?: string;
}

export function PrinterStatusBar() {
    const [status, setStatus] = useState<PrinterStatus | null>(null);
    const [queueLength, setQueueLength] = useState(0);
    const [loading, setLoading] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const autoPrintEnabled = useTaskStore((state) => state.autoPrintEnabled);
    const toggleAutoPrint = useTaskStore((state) => state.toggleAutoPrint);
    const soundEnabled = useTaskStore((state) => state.soundEnabled);
    const toggleSound = useTaskStore((state) => state.toggleSound);
    const qrOnChits = useTaskStore((state) => state.qrOnChits);
    const toggleQrOnChits = useTaskStore((state) => state.toggleQrOnChits);

    const fetchStatus = async () => {
        try {
            const printServerUrl = getPrintServerUrl();
            const res = await fetch(`${printServerUrl}/printer-status`);
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
            } else {
                setStatus({ connected: false, error: 'Print server offline' });
            }

            const qRes = await fetch(`${printServerUrl}/queue`);
            if (qRes.ok) {
                const qData = await qRes.json();
                setQueueLength(qData.length || 0);
            }
        } catch {
            setStatus({ connected: false, error: 'Print server not reachable' });
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 8000);
        return () => clearInterval(interval);
    }, []);

    const handleTestPrint = async () => {
        setIsTesting(true);
        try {
            const printServerUrl = getPrintServerUrl();
            const res = await fetch(`${printServerUrl}/print-single`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskName: 'THERMALFLOW OK',
                    priority: 'normal'
                })
            });
            if (res.ok) {
                toast.success("Test chit sent to printer!");
            } else {
                toast.info("Printer offline. Test simulated.");
            }
        } catch {
            toast.info("Printer offline. Test simulated.");
        } finally {
            setIsTesting(false);
        }
    };

    const isOnline = status?.connected && status?.printerFound;

    return (
        <div className="relative">
            {/* Status Pill */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border transition-all hover:opacity-90",
                    isOnline
                        ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                        : "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400"
                )}
                title="Thermal Printer Status (Click for settings)"
            >
                <span className={cn(
                    "w-2 h-2 rounded-full",
                    isOnline ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                )} />
                <span className="hidden sm:inline font-bold">
                    {isOnline ? 'PRINTER READY' : 'SIMULATION'}
                </span>
                {queueLength > 0 && (
                    <span className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full px-1.5 py-0.2 text-[9px] font-bold">
                        {queueLength}
                    </span>
                )}
                <ChevronDown size={12} className={cn("transition-transform opacity-60", isOpen && "rotate-180")} />
            </button>

            {/* Dropdown Popover */}
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-xl p-3 z-50 font-mono text-xs text-zinc-900 dark:text-zinc-100 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800 mb-3">
                            <div className="flex items-center gap-2">
                                <Printer size={15} />
                                <span className="font-bold uppercase tracking-wider text-[11px]">Hardware & Chits</span>
                            </div>
                            <button
                                onClick={fetchStatus}
                                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1"
                                title="Refresh status"
                            >
                                <RefreshCw size={12} />
                            </button>
                        </div>

                        {/* Status Summary */}
                        <div className="bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded-lg mb-3 border border-zinc-200 dark:border-zinc-800 text-[11px] space-y-1">
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Status:</span>
                                <span className={cn("font-bold", isOnline ? "text-emerald-500" : "text-amber-500")}>
                                    {isOnline ? 'Online (ESC/POS USB)' : 'Simulated Audio'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-400">Queue:</span>
                                <span>{queueLength} pending</span>
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="space-y-2 mb-3">
                            <button
                                onClick={toggleAutoPrint}
                                className="w-full flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
                            >
                                <span className="text-[11px]">Auto-Print on Task Add</span>
                                <span className={cn("font-bold text-[10px] px-1.5 py-0.5 rounded", autoPrintEnabled ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400")}>
                                    {autoPrintEnabled ? 'ON' : 'OFF'}
                                </span>
                            </button>

                            <button
                                onClick={toggleQrOnChits}
                                className="w-full flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
                            >
                                <div className="flex items-center gap-1.5">
                                    <QrCode size={13} className="text-zinc-400" />
                                    <span className="text-[11px]">Scan-to-Done QR</span>
                                </div>
                                <span className={cn("font-bold text-[10px] px-1.5 py-0.5 rounded", qrOnChits ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400")}>
                                    {qrOnChits ? 'ON' : 'OFF'}
                                </span>
                            </button>

                            <button
                                onClick={toggleSound}
                                className="w-full flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
                            >
                                <div className="flex items-center gap-1.5">
                                    {soundEnabled ? <Volume2 size={13} className="text-zinc-400" /> : <VolumeX size={13} className="text-zinc-400" />}
                                    <span className="text-[11px]">Audio Simulation</span>
                                </div>
                                <span className={cn("font-bold text-[10px] px-1.5 py-0.5 rounded", soundEnabled ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400")}>
                                    {soundEnabled ? 'ON' : 'MUTED'}
                                </span>
                            </button>
                        </div>

                        {/* Test Print Button */}
                        <button
                            onClick={handleTestPrint}
                            disabled={isTesting}
                            className="w-full py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:opacity-90 active:scale-98 transition-all"
                        >
                            <Printer size={13} />
                            {isTesting ? 'PRINTING TEST...' : 'PRINT TEST CHIT'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
