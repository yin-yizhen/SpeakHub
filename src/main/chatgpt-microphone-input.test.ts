// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChatGPTMicrophoneGate } from './chatgpt-microphone-input'

let getUserMedia: ReturnType<typeof vi.fn>
const gate = () => (window as unknown as Window & { __speaksubMicrophoneGate: { setActive(active: boolean): { ok: boolean }; setInputDevice(input: {deviceId: string;label: string;labelIndex: number}): {ok: boolean} } }).__speaksubMicrophoneGate
beforeEach(() => {
  getUserMedia = vi.fn(async () => ({ getAudioTracks: () => [] }))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  expect(installChatGPTMicrophoneGate()).toEqual({ ok: true })
})
afterEach(() => { delete (window as Window & { __speaksubMicrophoneGate?: unknown }).__speaksubMicrophoneGate; vi.unstubAllGlobals() })

describe('ChatGPT microphone input', () => {
  it.each(['communications', { exact: 'communications' }, { ideal: 'communications' }, ['communications']])('routes communications alias %j to the tested default microphone', async deviceId => {
    const input = { audio: { deviceId, echoCancellation: true, channelCount: 1 }, video: false }
    await navigator.mediaDevices.getUserMedia(input)
    const normalized = getUserMedia.mock.calls[0][0] as MediaStreamConstraints
    expect(JSON.stringify((normalized.audio as MediaTrackConstraints).deviceId)).toContain('default')
    expect(JSON.stringify((normalized.audio as MediaTrackConstraints).deviceId)).not.toContain('communications')
    expect(normalized.audio).toMatchObject({ echoCancellation: true, channelCount: 1 })
    expect(input.audio.deviceId).toEqual(deviceId)
  })

  it('preserves an explicit user-selected device, default alias and video-only requests', async () => {
    for (const input of [{ audio: { deviceId: { exact: 'selected-hardware-id' } } }, { audio: { deviceId: 'default' } }, { audio: true }, { video: true }, { audio: { deviceId: ['selected-hardware-id', 'communications'] } }]) {
      await navigator.mediaDevices.getUserMedia(input)
      expect(getUserMedia).toHaveBeenLastCalledWith(input)
    }
  })

  it('keeps pending and existing tracks in sync with the shared on/off state', async () => {
    const track = { enabled: true, addEventListener: vi.fn() }
    getUserMedia.mockResolvedValueOnce({ getAudioTracks: () => [track] })
    gate().setActive(false)
    await navigator.mediaDevices.getUserMedia({ audio: true })
    expect(track.enabled).toBe(false)
    gate().setActive(true)
    expect(track.enabled).toBe(true)
    expect(installChatGPTMicrophoneGate()).toEqual({ ok: true })
  })

  it('maps the saved renderer selection to this origins device ID by name', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn(async () => [{ kind: 'audioinput', deviceId: 'chatgpt-device-id', label: 'Selected microphone' }] as MediaDeviceInfo[])
    gate().setInputDevice({ deviceId: 'renderer-device-id', label: 'Selected microphone', labelIndex: 0 })
    await navigator.mediaDevices.getUserMedia({ audio: { deviceId: 'communications', echoCancellation: true } })
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'chatgpt-device-id' }, echoCancellation: true } })
  })

  it('does not silently use another microphone when the selected input is disconnected', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn(async () => [{ kind: 'audioinput', deviceId: 'other', label: 'Other microphone' }] as MediaDeviceInfo[])
    gate().setInputDevice({ deviceId: 'renderer-device-id', label: 'Disconnected microphone', labelIndex: 0 })
    await expect(navigator.mediaDevices.getUserMedia({ audio: true })).rejects.toThrow('选择的麦克风不可用')
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('makes an explicit system-default app selection authoritative over old page preferences', async () => {
    gate().setInputDevice({ deviceId: 'default', label: '系统默认', labelIndex: 0 })
    await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: 'old-browser-preference' } } })
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'default' } } })
  })
})
