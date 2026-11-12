import { DirectionProvider } from "@/components/ui/direction";

export function App() {
  return (
    <DirectionProvider direction="rtl">
      <main className="flex min-h-dvh flex-col items-center justify-center bg-app-canvas p-6 text-foreground">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">تطبيق المحادثة</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            تم تجهيز بيئة المشروع بنجاح.
          </p>
        </div>
      </main>
    </DirectionProvider>
  );
}
