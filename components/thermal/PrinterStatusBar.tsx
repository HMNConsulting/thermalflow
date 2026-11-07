'use client';

import { useState, useEffect } from 'react';
import { useTaskStore } from '@/lib/store';
import { Printer, CheckCircle2, AlertTriangle, RefreshCw, QrCode, Volume2, VolumeX, Sparkles, ChevronDown, KeyRound, Eye, EyeOff, Check, Trash2, Copy, Terminal, Download } from 'lucide-react';
import { getPrintServerUrl, cn } from '@/lib/utils';
import { toast } from 'sonner';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PrinterStatus {
    connected: boolean;
    printerFound?: boolean;
    availablePrinters?: number;
    error?: string;
}

interface GeminiConfig {
    configured: boolean;
    source: 'ui' | 'env' | 'none';
    masked: string;
    model: string;
    valid?: boolean;
    statusCode?: number;
    keyError?: string | null;
}

interface McpOAuthConfig {
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    passkey: string;
    activeTokens: number;
}

export function PrinterStatusBar() {
    const [status, setStatus] = useState<PrinterStatus | null>(null);
    const [queueLength, setQueueLength] = useState(0);
    const [loading, setLoading] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const [geminiConfig, setGeminiConfig] = useState<GeminiConfig | null>(null);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [savingKey, setSavingKey] = useState(false);
    const [mcpOAuth, setMcpOAuth] = useState<McpOAuthConfig | null>(null);
    const [showMcpPasskey, setShowMcpPasskey] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

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

    const fetchGeminiConfig = async (verify = false) => {
        try {
            const res = await fetch(`/api/config/gemini${verify ? '?verify=1' : ''}`);
            if (res.ok) {
                const data = await res.json();
                setGeminiConfig(data);
            }
        } catch {
            // ignore
        }
    };

    const fetchMcpOAuth = async () => {
        try {
            const res = await fetch('/api/config/mcp-oauth');
            if (res.ok) {
                const data = await res.json();
                setMcpOAuth(data);
            }
        } catch {
            // ignore
        }
    };

    const handleToggleMcpOAuth = async () => {
        if (!mcpOAuth) return;
        try {
            const res = await fetch('/api/config/mcp-oauth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !mcpOAuth.enabled })
            });
            if (res.ok) {
                const data = await res.json();
                setMcpOAuth(data);
                toast.success(data.enabled ? 'MCP OAuth 2.1 protection enabled' : 'MCP OAuth protection disabled');
            }
        } catch {
            toast.error('Failed to update MCP OAuth setting');
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchGeminiConfig(true);
            fetchMcpOAuth();
        }
    }, [isOpen]);

    useEffect(() => {
        fetchStatus();
        fetchGeminiConfig();
        const interval = setInterval(fetchStatus, 8000);

        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
        };
        const handleAppInstalled = () => {
            setDeferredPrompt(null);
            toast.success('ThermalFlow installed as an app!');
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            clearInterval(interval);
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const handleSaveGeminiKey = async () => {
        if (!apiKeyInput.trim()) return;
        setSavingKey(true);
        try {
            const res = await fetch('/api/config/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: apiKeyInput.trim() })
            });
            if (res.ok) {
                const data = await res.json();
                setGeminiConfig(data);
                setApiKeyInput('');
                setShowKey(false);
                if (data.keyError) {
                    toast.warning(data.keyError);
                } else {
                    toast.success('Gemini API key verified & saved!');
                }
            } else {
                toast.error('Failed to save API key');
            }
        } catch {
            toast.error('Error saving API key');
        } finally {
            setSavingKey(false);
        }
    };

    const handleClearGeminiKey = async () => {
        setSavingKey(true);
        try {
            const res = await fetch('/api/config/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: '' })
            });
            if (res.ok) {
                const data = await res.json();
                setGeminiConfig(data);
                setApiKeyInput('');
                toast.info('Custom Gemini API key cleared');
            }
        } catch {
            toast.error('Error clearing API key');
        } finally {
            setSavingKey(false);
        }
    };

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
                type="button"
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 sm:px-2.5 sm:py-1 rounded-full text-[11px] font-mono border transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
                    isOnline
                        ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                        : "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300"
                )}
                title="Thermal Printer Status (Click for settings)"
            >
                <span className={cn(
                    "w-2 h-2 rounded-full",
                    isOnline ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-amber-500"
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
                    <div
                        role="dialog"
                        aria-label="Hardware and Chits Settings"
                        className="fixed left-4 right-4 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 bg-card border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-xl p-3 z-50 font-mono text-xs text-zinc-900 dark:text-zinc-100 animate-in fade-in zoom-in-95 duration-150"
                    >
                        <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800 mb-3">
                            <div className="flex items-center gap-2">
                                <Printer size={15} />
                                <span className="font-bold uppercase tracking-wider text-[11px]">Hardware & Chits</span>
                            </div>
                            <button
                                type="button"
                                aria-label="Refresh printer status"
                                onClick={fetchStatus}
                                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 p-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                                title="Refresh status"
                            >
                                <RefreshCw size={12} />
                            </button>
                        </div>

                        {/* Status Summary */}
                        <div className="bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded-lg mb-3 border border-zinc-200 dark:border-zinc-800 text-[11px] space-y-1">
                            <div className="flex justify-between">
                                <span className="text-zinc-500 dark:text-zinc-400">Status:</span>
                                <span className={cn("font-bold", isOnline ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                                    {isOnline ? 'Online (ESC/POS USB)' : 'Simulated Audio'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-500 dark:text-zinc-400">Queue:</span>
                                <span>{queueLength} pending</span>
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="space-y-1.5 mb-3">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={autoPrintEnabled}
                                onClick={toggleAutoPrint}
                                className="w-full flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                            >
                                <span className="text-[11px]">Auto-Print on Task Add</span>
                                <span className={cn("font-bold text-[10px] px-1.5 py-0.5 rounded", autoPrintEnabled ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400")}>
                                    {autoPrintEnabled ? 'ON' : 'OFF'}
                                </span>
                            </button>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={qrOnChits}
                                onClick={toggleQrOnChits}
                                className="w-full flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                            >
                                <div className="flex items-center gap-1.5">
                                    <QrCode size={13} className="text-zinc-500 dark:text-zinc-400" />
                                    <span className="text-[11px]">Scan-to-Done QR</span>
                                </div>
                                <span className={cn("font-bold text-[10px] px-1.5 py-0.5 rounded", qrOnChits ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400")}>
                                    {qrOnChits ? 'ON' : 'OFF'}
                                </span>
                            </button>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={soundEnabled}
                                onClick={toggleSound}
                                className="w-full flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                            >
                                <div className="flex items-center gap-1.5">
                                    {soundEnabled ? <Volume2 size={13} className="text-zinc-500 dark:text-zinc-400" /> : <VolumeX size={13} className="text-zinc-500 dark:text-zinc-400" />}
                                    <span className="text-[11px]">Audio Simulation</span>
                                </div>
                                <span className={cn("font-bold text-[10px] px-1.5 py-0.5 rounded", soundEnabled ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400")}>
                                    {soundEnabled ? 'ON' : 'MUTED'}
                                </span>
                            </button>
                        </div>

                        {/* Gemini AI Configuration */}
                        <div className="pt-2.5 mt-2 border-t border-zinc-100 dark:border-zinc-800 mb-3">
                            <div className="flex items-center justify-between mb-1.5 px-1">
                                <label htmlFor="gemini-api-key-input" className="flex items-center gap-1.5 cursor-pointer">
                                    <Sparkles size={12} className="text-amber-500" />
                                    <span className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 dark:text-zinc-400">Gemini API Key</span>
                                </label>
                                {geminiConfig?.configured ? (
                                    geminiConfig.keyError ? (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400">
                                            {geminiConfig.statusCode === 402 ? 'CREDITS DEPLETED' : 'KEY ERROR'} ({geminiConfig.masked})
                                        </span>
                                    ) : (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                                            {geminiConfig.source === 'env' ? 'ENV ACTIVE' : geminiConfig.masked}
                                        </span>
                                    )
                                ) : (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                                        NOT SET
                                    </span>
                                )}
                            </div>
                            {geminiConfig?.keyError && (
                                <div className="mb-1.5 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/25 text-[10px] text-red-700 dark:text-red-300 leading-snug">
                                    {geminiConfig.keyError}
                                </div>
                            )}
                            <div className="flex items-center gap-1.5">
                                <div className="relative flex-1">
                                    <input
                                        id="gemini-api-key-input"
                                        type={showKey ? 'text' : 'password'}
                                        value={apiKeyInput}
                                        onChange={(e) => setApiKeyInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleSaveGeminiKey();
                                            }
                                        }}
                                        placeholder={geminiConfig?.configured ? 'Replace API key...' : 'Paste AIza... key'}
                                        className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-2.5 pr-7 py-1.5 text-[11px] font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/60"
                                    />
                                    <button
                                        type="button"
                                        aria-label={showKey ? 'Hide API key' : 'Show API key'}
                                        onClick={() => setShowKey(!showKey)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                        title={showKey ? 'Hide key' : 'Show key'}
                                    >
                                        {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                                    </button>
                                </div>
                                {apiKeyInput.trim() ? (
                                    <button
                                        type="button"
                                        onClick={handleSaveGeminiKey}
                                        disabled={savingKey}
                                        className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[10px] rounded-lg transition-colors flex items-center gap-1 shrink-0 disabled:opacity-50"
                                        title="Save Gemini API Key"
                                    >
                                        <Check size={12} />
                                        <span>SAVE</span>
                                    </button>
                                ) : geminiConfig?.source === 'ui' ? (
                                    <button
                                        type="button"
                                        aria-label="Clear saved Gemini API key"
                                        onClick={handleClearGeminiKey}
                                        disabled={savingKey}
                                        className="p-1.5 text-zinc-500 hover:text-red-500 border border-zinc-200 dark:border-zinc-800 hover:border-red-500/30 rounded-lg transition-colors shrink-0"
                                        title="Clear saved API key"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {/* Gemini MCP Server Link & OAuth 2.1 Security */}
                        <div className="pt-2.5 mt-2 border-t border-zinc-100 dark:border-zinc-800 mb-3 space-y-1.5">
                            <div className="flex items-center justify-between px-1">
                                <div className="flex items-center gap-1.5">
                                    <Terminal size={12} className="text-emerald-500" />
                                    <span className="font-bold uppercase tracking-wider text-[10px] text-zinc-600 dark:text-zinc-400">Gemini MCP URL</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    {mcpOAuth && (
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={mcpOAuth.enabled}
                                            onClick={handleToggleMcpOAuth}
                                            className={cn(
                                                "text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors",
                                                mcpOAuth.enabled
                                                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                                                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                                            )}
                                            title="Toggle OAuth 2.1 protection on /mcp"
                                        >
                                            {mcpOAuth.enabled ? 'OAUTH ON' : 'OAUTH OFF'}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const mcpUrl = 'https://print.nebulous.space/mcp';
                                            navigator.clipboard.writeText(mcpUrl);
                                            toast.success('Copied MCP Server URL!');
                                        }}
                                        className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center gap-1 transition-colors"
                                        title="Copy MCP URL for Gemini Connected Apps"
                                    >
                                        <Copy size={10} />
                                        <span>COPY</span>
                                    </button>
                                </div>
                            </div>
                            <div className="px-2 py-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded text-[10px] text-zinc-600 dark:text-zinc-400 truncate select-all">
                                https://print.nebulous.space/mcp
                            </div>
                            {mcpOAuth?.enabled && (
                                <div className="flex items-center justify-between px-2 py-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded text-[10px]">
                                    <span className="text-zinc-500 dark:text-zinc-400">OAuth Passkey:</span>
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-mono text-zinc-800 dark:text-zinc-200">
                                            {showMcpPasskey ? mcpOAuth.passkey : '••••••••••••'}
                                        </span>
                                        <button
                                            type="button"
                                            aria-label={showMcpPasskey ? 'Hide MCP passkey' : 'Show MCP passkey'}
                                            onClick={() => setShowMcpPasskey(!showMcpPasskey)}
                                            className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                            title={showMcpPasskey ? 'Hide passkey' : 'Show passkey'}
                                        >
                                            {showMcpPasskey ? <EyeOff size={11} /> : <Eye size={11} />}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="Copy MCP passkey"
                                            onClick={() => {
                                                navigator.clipboard.writeText(mcpOAuth.passkey);
                                                toast.success('Copied MCP OAuth Passkey!');
                                            }}
                                            className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                                            title="Copy OAuth Passkey"
                                        >
                                            <Copy size={11} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Install PWA Button (if installable) */}
                        {deferredPrompt && (
                            <button
                                type="button"
                                onClick={async () => {
                                    await deferredPrompt.prompt();
                                    const choice = await deferredPrompt.userChoice;
                                    if (choice.outcome === 'accepted') {
                                        setDeferredPrompt(null);
                                    }
                                }}
                                className="w-full mb-2 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            >
                                <Download size={13} />
                                INSTALL APP (PWA)
                            </button>
                        )}

                        {/* Test Print Button */}
                        <button
                            type="button"
                            onClick={handleTestPrint}
                            disabled={isTesting}
                            className="w-full py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:opacity-90 active:scale-98 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
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
