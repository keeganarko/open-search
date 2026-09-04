import type { JSX } from 'react'
import Panel from './Panel'

const GROUPS: [string, [string, string][]][] = [
  ['Open Search', [
    ['⌘K', 'Ask Open Search about this page'],
    ['⌘⇧K', 'Show or hide the sidebar'],
    ['⌘P', 'Command palette'],
    ['⌘⇧M', 'What Open Search remembers'],
    ['⌘⇧X', 'Skills'],
    ['⌘⇧C', 'Connectors'],
    ['⌘⇧B', 'Morning brief'],
    ['⌘⇧D', 'Make a deck or report']
  ]],
  ['Tabs', [
    ['⌘T', 'New tab'],
    ['⌘W', 'Close tab'],
    ['⌘⇧T', 'Reopen closed tab'],
    ['⌘1–8', 'Jump to tab'],
    ['⌘9', 'Last tab'],
    ['⌃⇥', 'Next tab'],
    ['⌘⇧R', 'Auto-organize tabs into groups'],
    ['⌘⇧P', 'Pin tab']
  ]],
  ['Page', [
    ['⌘L', 'Address bar'],
    ['⌘R', 'Reload'],
    ['⌘⇧R', 'Hard reload'],
    ['⌘F', 'Find in page'],
    ['⌘D', 'Bookmark'],
    ['⌘[ / ⌘]', 'Back / forward'],
    ['⌘+ / ⌘− / ⌘0', 'Zoom']
  ]]
]

export default function Shortcuts({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Panel title="Keyboard shortcuts" onClose={onClose} narrow>
      {GROUPS.map(([name, rows]) => (
        <div key={name}>
          <div className="sectiontitle">{name}</div>
          {rows.map(([k, what]) => (
            <div className="list-row" key={k}>
              <div className="main"><div className="t">{what}</div></div>
              <span className="badge" style={{ fontFamily: 'var(--mono)' }}>{k}</span>
            </div>
          ))}
        </div>
      ))}
    </Panel>
  )
}
