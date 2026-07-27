import { isExternalHelpUrl } from '../shared/help-links'

export function openAllowedHelpUrl(
  url: string,
  openExternal: (target: string) => Promise<void>,
  onError: (message: string) => void
): boolean {
  if (!isExternalHelpUrl(url)) return false
  void openExternal(url).catch((error) => {
    onError(error instanceof Error ? error.message : '系统没有成功打开默认浏览器。')
  })
  return true
}
