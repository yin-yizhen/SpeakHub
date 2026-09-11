export type TopicDocumentKind = 'txt' | 'pdf' | 'docx'

const MAX_EXTRACTED_CHARS = 20_000

export function detectTopicDocumentKind(fileName: string): TopicDocumentKind | undefined {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.txt')) return 'txt'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  return undefined
}

export async function parseTopicDocument(fileName: string, data: Uint8Array): Promise<string> {
  const kind = detectTopicDocumentKind(fileName)
  if (!kind) throw new Error('仅支持 .txt、.pdf 或 .docx 格式的文档。')
  let text: string
  try {
    if (kind === 'txt') text = new TextDecoder('utf-8', { fatal: false }).decode(data)
    else if (kind === 'pdf') text = await extractPdfText(data)
    else text = await extractDocxText(data)
  } catch (error) {
    throw new Error(`文档解析失败：${error instanceof Error ? error.message : '未知错误'}`)
  }
  const trimmed = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!trimmed) throw new Error('文档内容为空，无法提取任何文本。')
  if (trimmed.length > MAX_EXTRACTED_CHARS) throw new Error(`文档文本过长（${trimmed.length} 字符），请上传少于 ${MAX_EXTRACTED_CHARS} 字符的文档。`)
  return trimmed
}

async function extractPdfText(data: Uint8Array): Promise<string> {
  const parsePdf = (await import('pdf-parse')).default
  try {
    const result = await parsePdf(Buffer.from(data))
    return result.text
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'ENOENT') {
      throw new Error('PDF 解析器内部文件缺失，请重新安装项目依赖。')
    }
    throw error
  }
}

async function extractDocxText(data: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) })
  return result.value
}
