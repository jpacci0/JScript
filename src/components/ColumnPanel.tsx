import type { Editor } from '@tiptap/react'
import { Columns2, PanelLeft, Rows3 } from 'lucide-react'
import { addColumnSection, getColumnsState, insertOrUpdateColumns, splitColumnSection, unwrapColumns } from '../lib/columns'
import './ColumnPanel.css'

export function ColumnPanel({ editor }: { editor: Editor }) {
  const state = getColumnsState(editor)
  return <section className="layout-columns" aria-label="Colonne del documento">
    <div className="layout-columns-caption" title="Sezioni affiancate, ideali per un CV."><Columns2 size={13}/><strong>Colonne</strong></div>
    <div className="layout-columns-options">
      <button type="button" aria-pressed={state.active && state.ratio === 'equal'} disabled={!state.canInsert && !state.active} onMouseDown={event => event.preventDefault()} onClick={() => insertOrUpdateColumns(editor, 'equal')}><Columns2 size={19}/>Due uguali</button>
      <button type="button" aria-pressed={state.active && state.ratio === 'sidebar'} disabled={!state.canInsert && !state.active} onMouseDown={event => event.preventDefault()} onClick={() => insertOrUpdateColumns(editor, 'sidebar')}><PanelLeft size={19}/>Laterale stretta</button>
      {state.active && <>
        <button type="button" aria-label="Aggiungi sezione" title="Aggiungi una nuova sezione affiancata" onMouseDown={event => event.preventDefault()} onClick={() => addColumnSection(editor)}><Rows3 size={18}/>+ Sezione</button>
        <button type="button" disabled={!state.canSplit} onMouseDown={event => event.preventDefault()} onClick={() => splitColumnSection(editor)}>Dividi dal cursore</button>
        <button type="button" className="columns-unwrap" onMouseDown={event => event.preventDefault()} onClick={() => unwrapColumns(editor)}>Torna a una colonna</button>
      </>}
    </div>
    {!state.canInsert && !state.active && <p className="layout-columns-help">Posiziona il cursore fuori dalla tabella per inserire una sezione a colonne.</p>}
  </section>
}
