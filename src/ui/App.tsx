import { useState } from 'react'
import { describeSpecStatus } from './status.ts'

export default function App() {
  const [open, setOpen] = useState(false)
  return (
    <main>
      <h1>Project Chronofork</h1>
      <p>開発基盤のみ構築済みです。</p>
      <button type="button" onClick={() => setOpen((v) => !v)}>
        仕様ステータスを{open ? '隠す' : '表示'}
      </button>
      {open && <p data-testid="spec-status">{describeSpecStatus('pending-migration')}</p>}
    </main>
  )
}
