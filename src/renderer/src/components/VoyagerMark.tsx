import type { JSX } from 'react'
import mark from '../../../../resources/voyager-mark.svg?url'

/** Decorative next to an accessible Voyager label. */
export default function VoyagerMark({ size = 24 }: { size?: number }): JSX.Element {
  return <img src={mark} width={size} height={size} alt="" draggable={false}
    style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'middle' }} />
}
