export class AudioPreRoll {
  private chunks: Float32Array[] = []
  private samples = 0

  constructor(private readonly capacity: number) {}

  push(input: Float32Array): void {
    if (input.length >= this.capacity) {
      this.chunks = [input.slice(input.length - this.capacity)]
      this.samples = this.capacity
      return
    }
    this.chunks.push(input.slice())
    this.samples += input.length
    while (this.samples > this.capacity && this.chunks.length) {
      const overflow = this.samples - this.capacity
      const first = this.chunks[0]
      if (first.length <= overflow) {
        this.chunks.shift()
        this.samples -= first.length
      } else {
        this.chunks[0] = first.slice(overflow)
        this.samples -= overflow
      }
    }
  }

  drain(): Float32Array[] {
    const chunks = this.chunks
    this.clear()
    return chunks
  }

  clear(): void {
    this.chunks = []
    this.samples = 0
  }
}
