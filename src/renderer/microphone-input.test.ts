import { afterEach, describe, expect, it, vi } from 'vitest'
import { microphoneInputChoices, requestMicrophoneStream } from './microphone-input'

afterEach(() => vi.unstubAllGlobals())
describe('shared local microphone selection', () => {
  it('uses the selected hardware ID from the current origin and keeps duplicate-name ordering', async () => {
    const devices = [
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Mic' },
      { kind: 'audioinput', deviceId: 'communications', label: 'Communications - Mic' },
      { kind: 'audioinput', deviceId: 'new-id-1', label: 'Mic' },
      { kind: 'audioinput', deviceId: 'new-id-2', label: 'Mic' }
    ] as MediaDeviceInfo[]
    expect(microphoneInputChoices(devices).map(d => d.labelIndex)).toEqual([0, 1])
    const getUserMedia = vi.fn(async () => ({}) as MediaStream)
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: async () => devices, getUserMedia } })
    await requestMicrophoneStream({ deviceId: 'previous-origin-id', label: 'Mic', labelIndex: 1 })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'new-id-2' }, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  })

  it('uses system default explicitly and rejects a missing selected device', async () => {
    const getUserMedia = vi.fn(async () => ({}) as MediaStream)
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: async () => [], getUserMedia } })
    await requestMicrophoneStream()
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.objectContaining({ deviceId: { exact: 'default' } }) }))
    await expect(requestMicrophoneStream({ deviceId: 'gone', label: 'Gone', labelIndex: 0 })).rejects.toThrow('选择的麦克风不可用')
    expect(getUserMedia).toHaveBeenCalledOnce()
  })
})
