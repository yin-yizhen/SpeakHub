import type { MicrophoneInputSelection } from '../shared/types'

export const defaultMicrophoneInput: MicrophoneInputSelection = { deviceId: 'default', label: '系统默认', labelIndex: 0 }

export function microphoneInputChoices(devices: MediaDeviceInfo[]): MicrophoneInputSelection[] {
  const counts = new Map<string, number>()
  return devices.filter(device => device.kind === 'audioinput' && device.label && !['default', 'communications'].includes(device.deviceId)).map((device) => {
    const label = device.label
    const labelIndex = counts.get(label) ?? 0; counts.set(label, labelIndex + 1)
    return { deviceId: device.deviceId, label, labelIndex }
  })
}

export async function requestMicrophoneStream(selection: MicrophoneInputSelection = defaultMicrophoneInput): Promise<MediaStream> {
  let deviceId = selection.deviceId
  if (deviceId !== 'default') {
    let devices = await navigator.mediaDevices.enumerateDevices()
    if (devices.length && !devices.some(device => device.kind === 'audioinput' && device.label)) {
      const bootstrap = await navigator.mediaDevices.getUserMedia({ audio: true })
      try { devices = await navigator.mediaDevices.enumerateDevices() }
      finally { bootstrap.getTracks().forEach(track => track.stop()) }
    }
    const choices = microphoneInputChoices(devices)
    const match = choices.find(device => device.label === selection.label && device.labelIndex === selection.labelIndex)
      ?? choices.find(device => device.deviceId === selection.deviceId)
    if (!match) throw new Error('选择的麦克风不可用，请在设置中刷新并重新选择语音输入设备。')
    deviceId = match.deviceId
  }
  return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
}
