export const ALIYUN_HELP_LINKS = {
  console: 'https://bailian.console.aliyun.com/',
  apiKeyGuide: 'https://help.aliyun.com/zh/model-studio/get-api-key/',
  freeQuotaGuide: 'https://help.aliyun.com/zh/model-studio/new-free-quota/'
} as const

export type ExternalHelpUrl = (typeof ALIYUN_HELP_LINKS)[keyof typeof ALIYUN_HELP_LINKS]

const allowedExternalHelpUrls = new Set<string>(Object.values(ALIYUN_HELP_LINKS))

export function isExternalHelpUrl(value: string): value is ExternalHelpUrl {
  return allowedExternalHelpUrls.has(value)
}
