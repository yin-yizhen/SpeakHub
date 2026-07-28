export const ALIYUN_HELP_LINKS = {
  console: 'https://bailian.console.aliyun.com/',
  apiKeyGuide: 'https://help.aliyun.com/zh/model-studio/get-api-key/',
  freeQuotaGuide: 'https://help.aliyun.com/zh/model-studio/new-free-quota/'
} as const

export const SPEECH_MODEL_DOWNLOAD_LINKS = {
  vad: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
  kokoro: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2'
} as const

export type ExternalHelpUrl =
  | (typeof ALIYUN_HELP_LINKS)[keyof typeof ALIYUN_HELP_LINKS]
  | (typeof SPEECH_MODEL_DOWNLOAD_LINKS)[keyof typeof SPEECH_MODEL_DOWNLOAD_LINKS]

const allowedExternalHelpUrls = new Set<string>([
  ...Object.values(ALIYUN_HELP_LINKS),
  ...Object.values(SPEECH_MODEL_DOWNLOAD_LINKS)
])

export function isExternalHelpUrl(value: string): value is ExternalHelpUrl {
  return allowedExternalHelpUrls.has(value)
}
