import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs'

export class DiagnosticLog {
  constructor(private readonly path: string) {}
  write(event: string, details: Record<string, string | number | boolean | undefined> = {}): void {
    try {
      if (existsSync(this.path) && statSync(this.path).size > 1_000_000) { rmSync(`${this.path}.previous`, { force: true }); renameSync(this.path, `${this.path}.previous`) }
      appendFileSync(this.path, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`, 'utf8')
    } catch { /* diagnostics must never break practice */ }
  }
}
