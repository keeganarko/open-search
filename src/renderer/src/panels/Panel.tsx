import type { JSX, ReactNode } from 'react'
import { useEscape } from '../state'

interface Props {
  title: string
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
  narrow?: boolean
}

export default function Panel({ title, onClose, actions, children, narrow }: Props): JSX.Element {
  useEscape(onClose)
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {actions}
        <button className="iconbtn" title="Close (Esc)" onClick={onClose}>×</button>
      </div>
      <div className={`panel-body${narrow ? ' narrow' : ''}`}>{children}</div>
    </div>
  )
}
