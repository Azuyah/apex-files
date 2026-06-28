/// <reference types="vite/client" />

interface Window {
  apex?: {
    minimize: () => Promise<void>;
    maximizeToggle: () => Promise<boolean>;
    close: () => Promise<void>;
    getBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
    setBounds: (bounds: Partial<{ x: number; y: number; width: number; height: number }>) => Promise<{ x: number; y: number; width: number; height: number } | null>;
  };
}
