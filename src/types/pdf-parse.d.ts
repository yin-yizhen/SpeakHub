declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
    numpages: number
    numrender: number
    info: Record<string, unknown>
    meta: Record<string, unknown>
    version: string
  }
  interface PdfParseOptions {
    pagerender?: (pageData: unknown) => string
    max?: number
  }
  function parsePdf(dataBuffer: Uint8Array | ArrayBuffer | Buffer, options?: PdfParseOptions): Promise<PdfParseResult>
  export default parsePdf
}
