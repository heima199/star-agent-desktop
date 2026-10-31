import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { pdfjsAssets } from './scripts/vite-pdfjs-assets'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  build: {
    // Vite 8 defaults to baseline-widely-available (safari16.4+), which
    // requires macOS 13+. Tauri on macOS 12 uses Safari 15 WebView.
    target: ['es2021', 'safari15'],
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT') return
        warn(warning)
      },
      output: {
        // Keep the state library in its own leaf chunk. Zustand's `create`
        // runs at the module top of every store (`export const useX =
        // create(...)`). Left to Rollup's automatic splitting, `create` gets
        // hoisted into a chunk that sits in an import cycle with the store
        // chunks, and whichever side initializes first can see `create`
        // before its chunk has run — "create is not a function" at boot. A
        // dedicated vendor chunk has no app imports, so it always initializes
        // before any store that imports from it.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](zustand|immer)[\\/]/.test(id)) return 'vendor-state'
          // The on-demand locales stay their own lazy chunks (the whole point
          // of loading them only when selected); never fold them into the core.
          if (/[\\/]src[\\/]i18n[\\/]locales[\\/](jp|kr|zh-TW)\.ts$/.test(id)) return undefined
          // The tightly-coupled core kept in one chunk: the Zustand stores, the
          // config/model presets they spread into their initial state, and
          // i18n (en/zh). Their init-time cross-references — store↔store
          // (`other.subscribe(...)` inside a `create`), store←presets
          // (`[...PRESETS]`), store→`t()` — are then all intra-chunk, where
          // rolldown orders modules by dependency. Split across chunks these
          // form initialization cycles with the entry that crash at boot
          // ("X is not a function" / "reading 'subscribe' of undefined").
          if (/[\\/]src[\\/](stores|config|constants|i18n)[\\/]/.test(id)) return 'app-core'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      // `bun build --compile` (the sidecar build) leaves a locked
      // `.<hash>.bun-build` file in its working directory while it runs;
      // watching it fails with EBUSY, which used to take the dev server down.
      ignored: ['**/src-tauri/**', /\.bun-build$/],
    },
  },
})
