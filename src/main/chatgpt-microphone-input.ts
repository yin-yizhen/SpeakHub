import type { MicrophoneInputSelection } from '../shared/types'

/** Self-contained for contextBridge serialization into the real page world. */
export function installChatGPTMicrophoneGate(): { ok: boolean; message?: string } {
  const page = window as Window & { __speaksubMicrophoneGate?: { setActive: (active: boolean) => { ok: boolean }; setInputDevice: (selection: MicrophoneInputSelection) => { ok: boolean } } }
  if (page.__speaksubMicrophoneGate) return { ok: true }
  const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
  if (!original) return { ok: false, message: 'getUserMedia is unavailable.' }
  const tracks = new Set<MediaStreamTrack>()
  let active = true
  let inputDevice: MicrophoneInputSelection | undefined
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    let normalized = constraints
    if (constraints?.audio && inputDevice) {
      let deviceId = inputDevice.deviceId
      if (deviceId !== 'default') {
        let devices = await navigator.mediaDevices.enumerateDevices()
        let bootstrap: MediaStream | undefined
        try {
          if (!devices.some(device => device.kind === 'audioinput' && device.label)) {
            bootstrap = await original({ audio: true })
            devices = await navigator.mediaDevices.enumerateDevices()
          }
          const matches = devices.filter(device => device.kind === 'audioinput' && !['default', 'communications'].includes(device.deviceId) && device.label === inputDevice!.label)
          const match = matches[inputDevice.labelIndex]
          if (!match) throw new Error('选择的麦克风不可用，请在 SpeakHub 设置中重新选择语音输入设备。')
          deviceId = match.deviceId
        } finally { bootstrap?.getTracks().forEach(track => track.stop()) }
      }
      normalized = { ...constraints, audio: { ...(typeof constraints.audio === 'object' ? constraints.audio : {}), deviceId: { exact: deviceId } } }
    } else if (constraints && constraints.audio && typeof constraints.audio === 'object') {
      const device = constraints.audio.deviceId
      const communicationsOnly = (value: unknown): boolean => value === 'communications' || (Array.isArray(value) && value.length === 1 && value[0] === 'communications')
      let replacement: ConstrainDOMString | undefined
      if (communicationsOnly(device)) replacement = 'default'
      else if (device && typeof device === 'object' && !Array.isArray(device)) {
        if (communicationsOnly(device.exact)) replacement = { ...device, exact: 'default' }
        else if (communicationsOnly(device.ideal)) replacement = { ...device, ideal: 'default' }
      }
      if (replacement !== undefined) normalized = { ...constraints, audio: { ...constraints.audio, deviceId: replacement } }
    }
    const stream = await original(normalized)
    if (constraints && constraints.audio !== false) for (const track of stream.getAudioTracks()) {
      track.enabled = active; tracks.add(track); track.addEventListener('ended', () => tracks.delete(track), { once: true })
    }
    return stream
  }
  page.__speaksubMicrophoneGate = {
    setActive(next) { active = Boolean(next); for (const track of tracks) track.enabled = active; return { ok: true } },
    setInputDevice(selection) { inputDevice = { ...selection }; return { ok: true } }
  }
  return { ok: true }
}
