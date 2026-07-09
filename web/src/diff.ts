// Tiny dependency-free line diff (RF-9): LCS-based, good enough for prompt-version
// compare (bodies are ≤20k chars). Returns one entry per rendered line.
export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n')
  const B = b.split('\n')
  const n = A.length
  const m = B.length
  // LCS length table (n+1 × m+1). Bodies are small; O(n·m) is fine.
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!)

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: 'same', text: A[i]! })
      i++
      j++
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) {
      out.push({ type: 'del', text: A[i]! })
      i++
    } else {
      out.push({ type: 'add', text: B[j]! })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: A[i++]! })
  while (j < m) out.push({ type: 'add', text: B[j++]! })
  return out
}
