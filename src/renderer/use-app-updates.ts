import { useEffect, useState } from 'react'
import type { AvailableUpdateInfo, UpdateDownloadProgress } from '../shared/types'
import { readSkippedUpdateVersion, shouldShowUpdatePrompt, writeSkippedUpdateVersion } from './update-prompt'

export function formatUpdateBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function useAppUpdates() {
  const [available, setAvailable] = useState<AvailableUpdateInfo>()
  const [showPrompt, setShowPrompt] = useState(false)
  const [status, setStatus] = useState('')
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<UpdateDownloadProgress>()
  const [showReleaseFallback, setShowReleaseFallback] = useState(false)
  const [skippedVersion, setSkippedVersion] = useState(readSkippedUpdateVersion)

  async function check(manual = false): Promise<void> {
    setChecking(true)
    if (manual) setStatus('正在检查更新…')
    try {
      const info = await window.speaksub.checkForUpdates()
      if (!info.updateAvailable) {
        setAvailable(undefined)
        if (manual) setStatus(info.message || `当前已是最新版本 ${info.currentVersion}`)
        return
      }
      setAvailable(info)
      setProgress(undefined)
      setShowReleaseFallback(!info.asset)
      setStatus(info.message || `发现新版本 ${info.latestVersion}`)
      if (manual || shouldShowUpdatePrompt(info.latestVersion, skippedVersion)) setShowPrompt(true)
    } catch (error) {
      console.warn('Unable to check for SpeakHub updates:', error)
      if (manual) setStatus(error instanceof Error ? error.message : '检查更新失败，请稍后再试。')
    } finally {
      setChecking(false)
    }
  }

  async function downloadAndInstall(): Promise<void> {
    setDownloading(true)
    setShowReleaseFallback(false)
    setStatus('正在准备下载安装包…')
    try {
      const result = await window.speaksub.downloadAndInstallUpdate()
      if (result.ok) {
        setStatus('安装程序已打开，请按提示完成更新。')
        return
      }
      setStatus(result.error || '下载安装包失败。')
      setShowReleaseFallback(true)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '下载安装包失败。')
      setShowReleaseFallback(true)
    } finally {
      setDownloading(false)
    }
  }

  async function openRelease(): Promise<void> {
    const result = await window.speaksub.openUpdateRelease()
    if (!result.ok) setStatus(result.error || '无法打开 GitHub Release 页面。')
  }

  function remindLater(): void {
    if (!downloading) setShowPrompt(false)
  }

  function skipVersion(): void {
    if (downloading || !available?.latestVersion) return
    writeSkippedUpdateVersion(available.latestVersion)
    setSkippedVersion(available.latestVersion)
    setShowPrompt(false)
  }

  useEffect(() => {
    const removeProgress = window.speaksub.onUpdateProgress((next) => {
      setProgress(next)
      if (next.status === 'connecting') setStatus(`正在连接 ${next.channel}…`)
      if (next.status === 'downloading') {
        const amount = next.total > 0
          ? `${formatUpdateBytes(next.received)} / ${formatUpdateBytes(next.total)}`
          : `已下载 ${formatUpdateBytes(next.received)}`
        setStatus(`正在通过 ${next.channel} 下载… ${amount}`)
      }
      if (next.message) setStatus(next.message)
    })
    const timer = window.setTimeout(() => void check(false), 5_000)
    return () => {
      window.clearTimeout(timer)
      removeProgress()
    }
  }, [])

  return {
    available,
    showPrompt,
    status,
    checking,
    downloading,
    progress,
    showReleaseFallback,
    check,
    downloadAndInstall,
    openRelease,
    remindLater,
    skipVersion
  }
}
