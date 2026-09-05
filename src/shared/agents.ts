/** Declarative agent contract. Recipes contain data, never executable code. */
export type AgentMode = 'research' | 'workflow' | 'lens' | 'watch' | 'teach' | 'diagnose' | 'guide'
export interface AgentRecipeStep {
  origin: string
  role: string
  name: string
  action: 'click' | 'fill'
  parameter?: string
  expectedText?: string
}
export interface AgentDefinition {
  schemaVersion: 1
  id: string
  name: string
  description: string
  mode: AgentMode
  instructions: string
  steps: AgentRecipeStep[]
  builtin: boolean
}
export interface AgentStart {
  definitionId: string
  task: string
  tabIds: string[]
  connectorTools: string[]
  parameters: Record<string, string>
  intervalSeconds: number
}
export interface AgentElement {
  ref: string
  role: string
  name: string
  editable: boolean
}
export interface AgentSnapshot {
  documentId: string
  snapshotId: string
  url: string
  title: string
  text: string
  elements: AgentElement[]
  tables: { columns: string[]; rows: string[][] }[]
}
export type AgentPageAction = { kind: 'click' | 'fill' | 'scroll'; ref?: string; text?: string; direction?: 'up' | 'down'; expectedText?: string }
export interface AgentPrepared {
  token: string
  description: string
  documentId: string
  href?: string
}
export interface AgentActionResult {
  outcome: 'verified' | 'unknown' | 'rejected'
  detail: string
}
export interface AgentArtifact {
  id: string
  kind: 'note' | 'table' | 'guide' | 'change'
  title: string
  body: string
  columns: string[]
  rows: string[][]
  sources: { title: string; url: string; observedAt: string }[]
}
export interface AgentApproval {
  id: string
  title: string
  destination: string
  detail: string
  expiresAt: string
}
export interface AgentJournalEntry {
  at: string
  label: string
  outcome: 'running' | 'verified' | 'denied' | 'unknown' | 'error'
}
export interface AgentRun {
  id: string
  definitionId: string
  name: string
  mode: AgentMode
  profileId: string
  windowKey: string
  task: string
  status: 'running' | 'awaiting_approval' | 'watching' | 'recording' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'unknown_outcome'
  tabIds: string[]
  createdAt: string
  expiresAt: string
  updatedAt: string
  message: string
  approval: AgentApproval | null
  journal: AgentJournalEntry[]
  artifacts: AgentArtifact[]
  recordedSteps: AgentRecipeStep[]
  usage: { inputTokens: number; outputTokens: number; steps: number }
}
export interface AgentsState { definitions: AgentDefinition[]; runs: AgentRun[]; windowKey: string; connectorTools: { name: string; description: string }[] }
export const AGENT_PRESETS: AgentDefinition[] = [
  { id: 'research', name: 'Research team', description: 'Compare selected tabs with sources.', mode: 'research', instructions: 'Have each selected source reviewed independently, then compare findings. Flag contradictions and missing evidence. Create a cited comparison table.', steps: [] },
  { id: 'workflow', name: 'Get things ready', description: 'Work across pages, with your approval.', mode: 'workflow', instructions: 'Inspect the selected tabs, plan the requested workflow and prepare the work. Ask through the action tools before every website effect. Verify outcomes. Stop on authentication or unclear targets.', steps: [] },
  { id: 'lens', name: 'Make a page view', description: 'Turn page information into a useful table.', mode: 'lens', instructions: 'Extract relevant facts from selected pages and build a useful comparison table with source attribution. Do not modify the sites.', steps: [] },
  { id: 'watch', name: 'Watch for changes', description: 'Local checks while Voyager stays open.', mode: 'watch', instructions: 'Compare visible text on selected loaded tabs. Do not refresh sites or send data to a model.', steps: [] },
  { id: 'teach', name: 'Teach a workflow', description: 'Record clicks and field names, never values.', mode: 'teach', instructions: 'Record the user’s chosen interactions. Save a reusable recipe whose field values are supplied when it runs.', steps: [] },
  { id: 'diagnose', name: 'Investigate a page', description: 'Explain page and resource timing evidence.', mode: 'diagnose', instructions: 'Investigate the selected pages using available page state, redacted console errors and resource timing metadata. If the user asks to reproduce a problem, use approved page actions. Distinguish observations from hypotheses. Make a reproduction guide. Do not claim access to request bodies, headers or server logs.', steps: [] },
  { id: 'guide', name: 'Show me how', description: 'Find the controls and guide your next steps.', mode: 'guide', instructions: 'Inspect the page controls and explain a clear sequence the user can perform. Identify controls by their exact visible names. Create a guide, without clicking or changing the website.', steps: [] }
].map((d) => ({ ...d, mode: d.mode as AgentMode, schemaVersion: 1, builtin: true }))
