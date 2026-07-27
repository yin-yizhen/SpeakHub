import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const speakSubTrackingEndpoint = 'https://sonic-analysis.cn-shanghai.log.aliyuncs.com/logstores/speaksub-event/track'

type AnalyticsEventName = 'app_open' | 'app_heartbeat' | 'app_close'

type AnalyticsFields = {
  app_name: 'speaksub'
  event: AnalyticsEventName
  distinct_id: string
  session_id: string
  app_version: string
  os: string
  arch: string
  is_first_launch: 'true' | 'false'
  duration_seconds?: string
}

export type AnalyticsTransport = (url: URL) => Promise<unknown>

export type AnonymousAnalyticsOptions = {
  userDataDirectory: string
  appVersion: string
  platform: string
  arch: string
  endpoint?: string
  heartbeatMs?: number
  now?: () => number
  createId?: () => string
  transport?: AnalyticsTransport
}

type StoredIdentity = { distinctId: string }

/** Sends the small anonymous lifecycle event allowlist. It never receives practice content or settings. */
export class AnonymousAnalytics {
  private readonly identityPath: string
  private readonly endpoint: string
  private readonly heartbeatMs: number
  private readonly now: () => number
  private readonly createId: () => string
  private readonly transport: AnalyticsTransport
  private distinctId = ''
  private sessionId = ''
  private firstLaunch = false
  private startedAt = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private started = false

  constructor(private readonly options: AnonymousAnalyticsOptions) {
    this.identityPath = join(options.userDataDirectory, 'anonymous-analytics.json')
    this.endpoint = options.endpoint ?? speakSubTrackingEndpoint
    this.heartbeatMs = options.heartbeatMs ?? 60_000
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
    this.transport = options.transport ?? ((url) => fetch(url, { method: 'GET' }))
  }

  async start(): Promise<void> {
    if (this.started) return
    const identity = this.readIdentity()
    this.firstLaunch = !identity
    this.distinctId = identity?.distinctId ?? this.createId()
    if (!identity) this.writeIdentity({ distinctId: this.distinctId })
    this.sessionId = this.createId()
    this.startedAt = this.now()
    this.started = true
    await this.send('app_open')
    this.heartbeatTimer = setInterval(() => { void this.send('app_heartbeat') }, this.heartbeatMs)
  }

  async close(): Promise<void> {
    if (!this.started) return
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
    this.started = false
    await this.send('app_close', Math.max(0, Math.floor((this.now() - this.startedAt) / 1_000)))
  }

  private async send(event: AnalyticsEventName, durationSeconds?: number): Promise<void> {
    const fields: AnalyticsFields = {
      app_name: 'speaksub', event, distinct_id: this.distinctId, session_id: this.sessionId,
      app_version: this.options.appVersion, os: this.options.platform, arch: this.options.arch,
      is_first_launch: this.firstLaunch ? 'true' : 'false'
    }
    if (durationSeconds !== undefined) fields.duration_seconds = String(durationSeconds)
    try {
      const url = new URL(this.endpoint)
      url.search = new URLSearchParams({ APIVersion: '0.6.0', ...fields }).toString()
      await this.transport(url)
    } catch {
      // Telemetry must never prevent a user from opening or closing SpeakSub.
    }
  }

  private readIdentity(): StoredIdentity | undefined {
    if (!existsSync(this.identityPath)) return undefined
    try {
      const value = JSON.parse(readFileSync(this.identityPath, 'utf8')) as Partial<StoredIdentity>
      return typeof value.distinctId === 'string' && value.distinctId.length > 0 ? { distinctId: value.distinctId } : undefined
    } catch { return undefined }
  }

  private writeIdentity(identity: StoredIdentity): void {
    try {
      const temporaryPath = `${this.identityPath}.tmp`
      writeFileSync(temporaryPath, JSON.stringify(identity), 'utf8')
      renameSync(temporaryPath, this.identityPath)
    } catch {
      // If local persistence fails, the event remains anonymous for this run.
    }
  }
}
