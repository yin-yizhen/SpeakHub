import { contextBridge, ipcRenderer } from 'electron'
import type { SpeakSubApi } from '../shared/types'

const api: SpeakSubApi = {
  startPractice: (topic, level, strength, source) => ipcRenderer.invoke('practice:start', topic, level, strength, source),
  sendApiMessage: (message) => ipcRenderer.invoke('api:sendMessage', message),
  endPractice: () => ipcRenderer.invoke('practice:end'),
  getState: () => ipcRenderer.invoke('app:state'),
  completeConnection: () => ipcRenderer.invoke('connection:complete'),
  showConnectionPage: (source) => ipcRenderer.invoke('connection:show', source),
  hideConnectionPage: () => ipcRenderer.invoke('connection:hide'),
  updateSubtitle: (settings) => ipcRenderer.invoke('subtitle:update', settings),
  toggleOverlay: () => ipcRenderer.invoke('subtitle:toggle'),
  setOverlayInteractive: (interactive) => ipcRenderer.invoke('subtitle:interactive', interactive),
  resizeOverlay: (direction, origin, deltaX, deltaY) => ipcRenderer.invoke('subtitle:resize', direction, origin, deltaX, deltaY),
  lookup: (selection, sentence) => ipcRenderer.invoke('learning:lookup', selection, sentence),
  saveStudyItem: (item) => ipcRenderer.invoke('study:save', item),
  listStudyItems: () => ipcRenderer.invoke('study:list'),
  getProviderSettings: () => ipcRenderer.invoke('providers:get'),
  saveProviderSettings: (settings) => ipcRenderer.invoke('providers:save', settings),
  clearAllData: () => ipcRenderer.invoke('data:clear'),
  onTranscript: (listener) => { const handler = (_: Electron.IpcRendererEvent, event: Parameters<typeof listener>[0]) => listener(event); ipcRenderer.on('transcript:event', handler); return () => ipcRenderer.removeListener('transcript:event', handler) },
  onSubtitleSettings: (listener) => { const handler = (_: Electron.IpcRendererEvent, settings: Parameters<typeof listener>[0]) => listener(settings); ipcRenderer.on('subtitle:settings', handler); return () => ipcRenderer.removeListener('subtitle:settings', handler) },
  onAutomationStatus: (listener) => { const handler = (_: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status); ipcRenderer.on('automation:status', handler); return () => ipcRenderer.removeListener('automation:status', handler) },
  onConnectionState: (listener) => { const handler = (_: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state); ipcRenderer.on('connection:state', handler); return () => ipcRenderer.removeListener('connection:state', handler) }
}

contextBridge.exposeInMainWorld('speaksub', api)
