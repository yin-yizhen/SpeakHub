import { contextBridge, ipcRenderer } from 'electron'
import type { SpeakSubApi } from '../shared/types'

const api: SpeakSubApi = {
  startPractice: (topic, level, strength, source, mode) => ipcRenderer.invoke('practice:start', topic, level, strength, source, mode),
  sendPracticeMessage: (message) => ipcRenderer.invoke('practice:sendMessage', message),
  sendApiMessage: (message) => ipcRenderer.invoke('api:sendMessage', message),
  startVoiceCapture: () => ipcRenderer.invoke('voice:capture:start'),
  stopVoiceCapture: () => ipcRenderer.invoke('voice:capture:stop'),
  sendVoiceAudio: (pcm16) => ipcRenderer.invoke('voice:audio', pcm16),
  endPractice: () => ipcRenderer.invoke('practice:end'),
  cancelPracticeStart: () => ipcRenderer.invoke('practice:cancel-start'),
  getState: () => ipcRenderer.invoke('app:state'),
  completeConnection: () => ipcRenderer.invoke('connection:complete'),
  showConnectionPage: () => ipcRenderer.invoke('connection:show'),
  clearPendingCleanup: () => ipcRenderer.invoke('connection:clear-pending-cleanup'),
  hideConnectionPage: () => ipcRenderer.invoke('connection:hide'),
  updateSubtitle: (settings) => ipcRenderer.invoke('subtitle:update', settings),
  toggleOverlay: () => ipcRenderer.invoke('subtitle:toggle'),
  setOverlayInteractive: (interactive) => ipcRenderer.invoke('subtitle:interactive', interactive),
  resizeOverlay: (direction, origin, deltaX, deltaY) => ipcRenderer.invoke('subtitle:resize', direction, origin, deltaX, deltaY),
  lookup: (selection, sentence) => ipcRenderer.invoke('learning:lookup', selection, sentence),
  saveSessionFavorite: (word) => ipcRenderer.invoke('session:save-favorite', word),
  getArchiveDirectory: () => ipcRenderer.invoke('archive:get-directory'),
  chooseArchiveDirectory: () => ipcRenderer.invoke('archive:choose-directory'),
  getProviderSettings: () => ipcRenderer.invoke('providers:get'),
  saveProviderSettings: (settings) => ipcRenderer.invoke('providers:save', settings),
  clearAllData: () => ipcRenderer.invoke('data:clear'),
  onTranscript: (listener) => { const handler = (_: Electron.IpcRendererEvent, event: Parameters<typeof listener>[0]) => listener(event); ipcRenderer.on('transcript:event', handler); return () => ipcRenderer.removeListener('transcript:event', handler) },
  onSubtitleSettings: (listener) => { const handler = (_: Electron.IpcRendererEvent, settings: Parameters<typeof listener>[0]) => listener(settings); ipcRenderer.on('subtitle:settings', handler); return () => ipcRenderer.removeListener('subtitle:settings', handler) },
  onAutomationStatus: (listener) => { const handler = (_: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status); ipcRenderer.on('automation:status', handler); return () => ipcRenderer.removeListener('automation:status', handler) },
  onConnectionState: (listener) => { const handler = (_: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state); ipcRenderer.on('connection:state', handler); return () => ipcRenderer.removeListener('connection:state', handler) },
  onVoiceAudio: (listener) => { const handler = (_: Electron.IpcRendererEvent, pcm16: ArrayBuffer) => listener(pcm16); ipcRenderer.on('voice:audio', handler); return () => ipcRenderer.removeListener('voice:audio', handler) },
  onVoiceInterrupt: (listener) => { const handler = () => listener(); ipcRenderer.on('voice:interrupt', handler); return () => ipcRenderer.removeListener('voice:interrupt', handler) }
}

contextBridge.exposeInMainWorld('speaksub', api)
