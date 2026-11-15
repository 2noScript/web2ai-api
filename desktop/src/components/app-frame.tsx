import type { ReactNode } from "react";

interface AppFrameProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppFrame({ title = "Web2AI API", actions, children }: AppFrameProps) {
  return (
    <div className="app-frame flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground selection:bg-primary/20">
      <header
        className="app-titlebar relative shrink-0 border-b border-border bg-sidebar select-none"
        data-tauri-drag-region
      >
        <div
          className="app-titlebar-content relative flex h-full items-center px-3"
          data-tauri-drag-region
        >
          <span
            className="pointer-events-none absolute inset-0 flex items-center justify-center px-40 text-xs font-medium text-muted-foreground"
            data-tauri-drag-region
          >
            <span className="truncate">{title}</span>
          </span>
          <div className="app-titlebar-actions relative ml-auto flex items-center gap-1.5">
            {actions}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
