import { headers } from "next/headers";
import { ColumnView } from "@/components/thermal/ColumnView";
import { ReceiptModal } from "@/components/thermal/ReceiptModal";
import { HeaderInfo } from "@/components/thermal/HeaderInfo";
import { UserInitializer } from "@/components/thermal/UserInitializer";
import { UserIndicators } from "@/components/thermal/UserIndicators";
import { DailyProgress } from "@/components/thermal/DailyProgress";
import { ScheduledPrintModal } from "@/components/thermal/ScheduledPrintModal";
import { PrinterStatusBar } from "@/components/thermal/PrinterStatusBar";
import { CircleDashed } from "lucide-react";

export default async function Home() {
  const headerList = await headers();
  const userEmail = headerList.get('cf-access-authenticated-user-email') || 'local';

  return (
    <main className="h-[100dvh] w-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden font-mono">
      <UserInitializer email={userEmail} />
      <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex justify-between md:grid md:grid-cols-3 items-center px-4 md:px-6 flex-shrink-0 bg-white dark:bg-zinc-950 z-10">
        {/* Left Side: Brand & Mode */}
        <div className="flex items-center gap-3 justify-self-start">
          <div className="bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 p-1.5 rounded-md">
            <CircleDashed size={18} className="animate-spin-slow" />
          </div>
          <HeaderInfo />
        </div>

        {/* Center: Workspace Label */}
        <div className="hidden md:block text-[10px] font-mono text-zinc-500 dark:text-zinc-400 justify-self-center text-center uppercase tracking-widest">
          ThermalFlow // Press <kbd className="font-bold border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">Ctrl+K</kbd>
        </div>

        {/* Right Side: Actions */}
        <div className="flex items-center gap-1.5 md:gap-3 justify-self-end">
          <DailyProgress />
          <UserIndicators />
          <div className="h-4 w-[1px] bg-zinc-200 dark:border-zinc-800 hidden sm:block" />
          <PrinterStatusBar />
          <ScheduledPrintModal />
          <ReceiptModal />
        </div>
      </header>

      <ColumnView />
    </main>
  );
}

