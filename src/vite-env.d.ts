/// <reference types="vite/client" />

interface Window {
  apex?: {
    minimize: () => Promise<void>;
    maximizeToggle: () => Promise<boolean>;
    close: () => Promise<void>;
  };
}
