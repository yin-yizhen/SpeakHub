import { contextBridge, ipcRenderer } from 'electron'

type GateResult = { ok: boolean; message?: string }

const installGate = () => contextBridge.executeInMainWorld({
  func: () => {
    const page = window as Window & { __speaksubMicrophoneGate?: { setActive: (active: boolean) => GateResult } }
    if (page.__speaksubMicrophoneGate) return page.__speaksubMicrophoneGate.setActive(false)
    const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
    if (!original) return { ok: false, message: 'getUserMedia is unavailable.' }
    const tracks = new Set<MediaStreamTrack>()
    let active = false
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints)
      if (constraints && constraints.audio !== false) for (const track of stream.getAudioTracks()) {
        track.enabled = active; tracks.add(track); track.addEventListener('ended', () => tracks.delete(track), { once: true })
      }
      return stream
    }
    page.__speaksubMicrophoneGate = { setActive(next) { active = Boolean(next); for (const track of tracks) track.enabled = active; return { ok: true } } }
    return { ok: true }
  },
  args: []
}) as GateResult

const applyGate = (active: boolean) => contextBridge.executeInMainWorld({
  func: (next: boolean) => {
    const page = window as Window & { __speaksubMicrophoneGate?: { setActive: (active: boolean) => GateResult } }
    return page.__speaksubMicrophoneGate?.setActive(next) ?? { ok: false, message: 'Microphone gate is not installed.' }
  },
  args: [active]
}) as GateResult

const installed = installGate()
ipcRenderer.on('speaksub:microphone-gate', (_event, active: boolean) => {
  const result = applyGate(active)
  ipcRenderer.send('speaksub:microphone-gate:applied', result)
})
ipcRenderer.send('speaksub:microphone-gate:ready', installed)
