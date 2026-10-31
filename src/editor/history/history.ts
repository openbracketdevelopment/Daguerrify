import { cloneDocument, documentsEqual, validateDocument, type EditDocument } from '../state/document'

export class EditHistory {
  private past: EditDocument[] = []
  private future: EditDocument[] = []
  private gesture: EditDocument | null = null
  private current: EditDocument

  constructor(initial: EditDocument, private readonly limit = 50) {
    this.current = validateDocument(initial)
  }
  get value(): EditDocument { return cloneDocument(this.current) }
  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }
  begin(): void { this.gesture ??= this.value }
  update(value: EditDocument): void {
    const next = validateDocument(value)
    if (documentsEqual(this.current, next)) return
    if (!this.gesture) this.record(this.current)
    this.current = next
    this.future = []
  }
  end(): void {
    if (!this.gesture) return
    if (!documentsEqual(this.gesture, this.current)) this.record(this.gesture)
    this.gesture = null
  }
  undo(): EditDocument {
    this.end()
    const previous = this.past.pop()
    if (previous) { this.future.push(this.value); this.current = previous }
    return this.value
  }
  redo(): EditDocument {
    this.end()
    const next = this.future.pop()
    if (next) { this.record(this.current); this.current = next }
    return this.value
  }
  private record(value: EditDocument): void {
    this.past.push(cloneDocument(value))
    if (this.past.length > this.limit) this.past.shift()
  }
}
