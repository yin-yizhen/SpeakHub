import { contextBridge, ipcRenderer } from 'electron'
import { installChatGPTMicrophoneGate } from './chatgpt-microphone-input'
import type { MicrophoneInputSelection } from '../shared/types'

type GateResult = { ok: boolean; message?: string }

const installGate = () => contextBridge.executeInMainWorld({ func: installChatGPTMicrophoneGate, args: [] }) as GateResult

const applyGate = (active: boolean) => contextBridge.executeInMainWorld({
  func: (next: boolean) => {
    const page = window as Window & { __speaksubMicrophoneGate?: { setActive: (active: boolean) => GateResult } }
    return page.__speaksubMicrophoneGate?.setActive(next) ?? { ok: false, message: 'Microphone gate is not installed.' }
  },
  args: [active]
}) as GateResult

const installed = installGate()
ipcRenderer.on('speaksub:microphone-input', (_event, selection: MicrophoneInputSelection) => {
  contextBridge.executeInMainWorld({
    func: (input: MicrophoneInputSelection) => {
      const page = window as Window & { __speaksubMicrophoneGate?: { setInputDevice: (value: MicrophoneInputSelection) => GateResult } }
      return page.__speaksubMicrophoneGate?.setInputDevice(input)
    },
    args: [selection]
  })
})
ipcRenderer.on('speaksub:microphone-gate', (_event, active: boolean) => {
  const result = applyGate(active)
  ipcRenderer.send('speaksub:microphone-gate:applied', result)
})
ipcRenderer.send('speaksub:microphone-gate:ready', installed)
