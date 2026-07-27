import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: { index: resolve(__dirname, 'src/main/index.ts'), 'speech-asr-worker': resolve(__dirname, 'src/main/speech-asr-worker.ts'), 'speech-tts-worker': resolve(__dirname, 'src/main/speech-tts-worker.ts') }, formats: ['cjs'], fileName: '[name]' } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: { preload: resolve(__dirname, 'src/main/preload.ts'), 'chatgpt-microphone': resolve(__dirname, 'src/main/chatgpt-microphone-preload.ts') }, formats: ['cjs'], fileName: '[name]' } }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html')
        }
      }
    }
  }
})
