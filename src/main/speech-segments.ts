const sentenceBoundary = /[。！？.!?；;]/
const softBoundary = /[，,、\s]/

export class SpeechSegmenter {
  private pending = ''

  push(delta: string): string[] {
    this.pending += delta
    const segments: string[] = []
    while (this.pending) {
      let boundary = -1
      for (let index = 0; index < this.pending.length; index += 1) {
        if (sentenceBoundary.test(this.pending[index])) { boundary = index + 1; break }
      }
      if (boundary < 0 && this.pending.length > 120) {
        for (let index = 119; index >= 0; index -= 1) {
          if (softBoundary.test(this.pending[index])) { boundary = index + 1; break }
        }
        if (boundary < 0) boundary = 120
      }
      if (boundary < 0) break
      const segment = this.pending.slice(0, boundary).trim()
      this.pending = this.pending.slice(boundary)
      if (segment) segments.push(segment)
    }
    return segments
  }

  flush(): string[] {
    const text = this.pending.trim()
    this.pending = ''
    return text ? [text] : []
  }
}
