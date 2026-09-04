import type { JSX } from 'react'
import Panel from './Panel'

function groups(): [string, [string, string][]][] {
  const mac = window.voyager.platform === 'darwin'
  const mod = (key: string): string => mac ? `⌘${key}` : `Ctrl+${key}`
  const shift = (key: string): string => mac ? `⌘⇧${key}` : `Ctrl+Shift+${key}`
  return [
  ['Voyager', [
    [mod('K'), 'Ask Voyager about this page'],
    [shift('K'), 'Show or hide the sidebar'],
    [mod('P'), 'Command palette'],
    [shift('B'), 'Morning brief']
  ]],
  ['Tabs', [
    [mod('T'), 'New tab'],
    [mod('W'), 'Close tab'],
    [shift('T'), 'Reopen closed tab'],
    [mod('1–8'), 'Jump to tab'],
    [mod('9'), 'Last tab'],
    ['Ctrl+Tab', 'Next tab'],
    [shift('P'), 'Pin tab']
  ]],
  ['Page', [
    [mod('L'), 'Address bar'],
    [mod('R'), 'Reload'],
    [shift('R'), 'Hard reload'],
    [mod('F'), 'Find in page'],
    [mod('D'), 'Bookmark'],
    [`${mod('[')} / ${mod(']')}`, 'Back / forward'],
    [`${mod('+')} / ${mod('−')} / ${mod('0')}`, 'Zoom']
  ]]
  ]
}

export default function Shortcuts({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Panel title="Keyboard shortcuts" onClose={onClose} narrow>
      {groups().map(([name, rows]) => (
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
