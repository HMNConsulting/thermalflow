'use client';

import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTaskStore } from '@/lib/store';
import { getPrintServerUrl } from '@/lib/utils';

export function ReceiptModal() {
    const [open, setOpen] = useState(false);
    const [printing, setPrinting] = useState(false);
    const tasks = useTaskStore(state => state.tasks);
    const activeFilters = useTaskStore(state => state.activeFilters);

    // Flatten tasks for receipt: Just show incomplete tasks for now or all?
    // Let's grab the top level tasks or all tasks.
    // For a nice receipt, maybe just a flattened list of "Todo".
    // We'll traverse.
    const getFlattenedTasks = () => {
        const result: { title: string, level: number, completed: boolean }[] = [];
        const traverse = (id: string, level: number) => {
            if (!tasks[id]) return;
            const task = tasks[id];
            if (id !== 'root' && !task.completed) {
                // Apply active creator filter
                if (!activeFilters.creator || task.createdBy === activeFilters.creator) {
                    result.push({ title: task.title, level, completed: task.completed });
                }
            }
            task.children.forEach(childId => traverse(childId, level + 1));
        };
        traverse('root', 0);
        return result;
    };

    const taskList = getFlattenedTasks();

    const handlePrint = async () => {
        setPrinting(true);
        try {
            // Try to hit local print server
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

            const payload = {
                title: "THERMALFLOW",
                date: new Date().toLocaleString(),
                tasks: taskList.map(t => `${t.completed ? '[x]' : '[ ]'} ${'  '.repeat(t.level - 1)}${t.title}`)
            };

            if (activeFilters.creator) {
                payload.title = `THERMALFLOW - ${activeFilters.creator.toUpperCase()}`;
            }

            const printServerUrl = getPrintServerUrl();

            const res = await fetch(`${printServerUrl}/print`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                toast.success("Sent to printer!");
            } else {
                const errorData = await res.json().catch(() => ({}));
                const msg = errorData.error || "Printer server error";
                toast.error(`Print Failed: ${msg}`);
                throw new Error(msg);
            }
        } catch (e) {
            console.log("Printer not found, simulating...", e);
            simulatePrint();
        } finally {
            setPrinting(false);
            setOpen(false);
        }
    };

    const simulatePrint = () => {
        try {
            // Web Audio API Whirring Sound
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContext();

            // White noise buffer
            const bufferSize = 2 * ctx.sampleRate;
            const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            const whiteNoise = ctx.createBufferSource();
            whiteNoise.buffer = noiseBuffer;
            whiteNoise.loop = true;

            // Filter for "mechanical" sound
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 400; // Low rumble

            // Gain envelope
            const gainNode = ctx.createGain();
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.1);
            gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 1.5);
            gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.6);

            // Connect
            whiteNoise.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(ctx.destination);

            whiteNoise.start();
            whiteNoise.stop(ctx.currentTime + 1.6);

            // Add high pitched servo noise
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 1.5);
            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(0.1, ctx.currentTime);
            oscGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);

            osc.connect(oscGain);
            oscGain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 1.5);

        } catch (e) { console.error("Audio error", e) }

        toast("Simulating Print... [Success]", {
            description: "Sent to thermal printer (Simulated)",
            icon: <Printer className="w-4 h-4" />
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2 font-mono border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 md:px-4">
                    <Printer size={16} />
                    <span className="hidden md:inline">PRINT</span>
                </Button>
            </DialogTrigger>
            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-xs bg-transparent border-none shadow-none p-0 overflow-y-visible">
                <DialogTitle className="sr-only">Receipt Preview</DialogTitle>
                <div className="bg-white p-6 relative w-full shadow-2xl filter drop-shadow-xl text-black font-mono text-xs max-h-[80vh] flex flex-col group">
                    <DialogClose className="absolute top-4 right-4 opacity-70 hover:opacity-100 transition-opacity z-50">
                        <X size={16} />
                    </DialogClose>
                    {/* Jagged top - Using SVG for cleaner edge */}
                    <svg className="absolute -top-2 left-0 w-full h-3 text-white" preserveAspectRatio="none" viewBox="0 0 100 10">
                        <polygon points="0,10 5,0 10,10 15,0 20,10 25,0 30,10 35,0 40,10 45,0 50,10 55,0 60,10 65,0 70,10 75,0 80,10 85,0 90,10 95,0 100,10" fill="currentColor" />
                    </svg>

                    <div className="text-center mb-6 border-b-2 border-black pb-4 border-dashed shrink-0">
                        <h2 className="text-xl font-bold uppercase tracking-widest leading-none mb-2">THERMALFLOW</h2>
                        <p className="mt-1 font-bold">TASK MANIFEST {activeFilters.creator ? `(${activeFilters.creator})` : ''}</p>
                        <p className="text-[10px] mt-1">{new Date().toLocaleString().toUpperCase()}</p>
                    </div>

                    <div className="space-y-2 mb-6 overflow-y-auto flex-1 pr-2 scrollbar-hide">
                        <p className="font-bold border-b border-black inline-block mb-2">PENDING TASKS</p>
                        {taskList.slice(0, 20).map((t, i) => (
                            <div key={i} className="flex justify-between items-start gap-2">
                                <span className="truncate flex-1">
                                    {t.completed ? '[x]' : '[ ]'} {t.title}
                                </span>
                                <span className="shrink-0 opacity-50">L{t.level}</span>
                            </div>
                        ))}
                        {taskList.length > 20 && <p className="text-center italic mt-2">...and {taskList.length - 20} more</p>}
                    </div>

                    <div className="border-t-2 border-black pt-4 border-dashed text-center shrink-0">
                        <p className="uppercase text-[10px] mb-4 font-bold">*** END OF TRANSMISSION ***</p>
                        <Button
                            className="w-full bg-black text-white hover:bg-zinc-800 rounded-none h-12 text-sm font-bold uppercase transition-transform active:scale-95"
                            onClick={handlePrint}
                            disabled={printing}
                        >
                            {printing ? <Loader2 className="animate-spin mr-2" /> : <Printer className="mr-2" />}
                            {printing ? 'PRINTING...' : 'CONFIRM PRINT'}
                        </Button>
                    </div>

                    {/* Jagged bottom */}
                    <svg className="absolute -bottom-2 left-0 w-full h-3 text-white rotate-180" preserveAspectRatio="none" viewBox="0 0 100 10">
                        <polygon points="0,10 5,0 10,10 15,0 20,10 25,0 30,10 35,0 40,10 45,0 50,10 55,0 60,10 65,0 70,10 75,0 80,10 85,0 90,10 95,0 100,10" fill="currentColor" />
                    </svg>
                </div>
            </DialogContent>
        </Dialog>
    );
}
