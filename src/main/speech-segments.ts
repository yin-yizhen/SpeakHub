const sentenceBoundary = /[。！？.!?；;]/
const clauseBoundary = /[，,、：:\r\n]/
const fallbackBoundary = /[，,、：:\s]/
const minimumClauseLength = 10
const firstSegmentMaxLength = 28
const followingSegmentMaxLength = 52

export class SpeechSegmenter {
  private pending = ''
  private emittedSegments = 0

  push(delta: string): string[] {
    this.pending += delta
    const segments: string[] = []
    while (this.pending) {
      let boundary = -1
      for (let index = 0; index < this.pending.length; index += 1) {
        if (sentenceBoundary.test(this.pending[index])) { boundary = index + 1; break }
      }
      if (boundary < 0) {
        for (let index = minimumClauseLength - 1; index < this.pending.length; index += 1) {
          if (clauseBoundary.test(this.pending[index])) { boundary = index + 1; break }
        }
      }
      const maximumLength = this.emittedSegments === 0 ? firstSegmentMaxLength : followingSegmentMaxLength
      if (boundary < 0 && this.pending.length >= maximumLength) {
        for (let index = maximumLength; index >= minimumClauseLength - 1; index -= 1) {
          if (fallbackBoundary.test(this.pending[index])) { boundary = index + 1; break }
        }
        if (boundary < 0) boundary = maximumLength
      }
      if (boundary < 0) break
      const segment = this.pending.slice(0, boundary).trim()
      this.pending = this.pending.slice(boundary)
      if (segment) {
        segments.push(segment)
        this.emittedSegments += 1
      }
    }
    return segments
  }

  flush(): string[] {
    const text = this.pending.trim()
    this.pending = ''
    return text ? [text] : []
  }
}
