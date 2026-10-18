import { useEffect, useId, useState } from 'react'
import { ChevronDown, ChevronUp, Columns2, FileText, RotateCcw, Rows3 } from 'lucide-react'
import { normalizeLayout } from '../lib/layout'
import type { DocumentLayout } from '../lib/types'

type NumberFieldProps = {
  label: string
  shortLabel?: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onCommit: (value: number) => void
}

function NumberField({ label, shortLabel, value, min, max, step = .1, unit, onCommit }: NumberFieldProps) {
  const inputId = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = (raw: string) => {
    const parsed = raw.trim() === '' ? NaN : Number(raw.replace(',', '.'))
    const next = Number.isFinite(parsed) ? Math.round(Math.min(max, Math.max(min, parsed)) * 100) / 100 : value
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }
  const parsedDraft = draft.trim() === '' ? NaN : Number(draft.replace(',', '.'))
  const draftValue = Number.isFinite(parsedDraft) ? parsedDraft : value
  const stepBy = (direction: 1 | -1) => commit(String(draftValue + direction * step))
  return <div className="layout-field">
    <label htmlFor={inputId}>{shortLabel || label}</label>
    <span className="layout-number">
      <input id={inputId} aria-label={label} type="text" inputMode="decimal" role="spinbutton" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} value={draft}
        onChange={event => setDraft(event.target.value)} onBlur={event => commit(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.value = String(value); setDraft(String(value)); event.currentTarget.blur() }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            stepBy(event.key === 'ArrowUp' ? 1 : -1)
          }
        }}/>
      {unit && <small>{unit}</small>}
      <span className="layout-stepper">
        <button type="button" aria-label={`Aumenta ${label.toLocaleLowerCase('it-IT')}`} title={`Aumenta ${label.toLocaleLowerCase('it-IT')}`} disabled={draftValue >= max}
          onPointerDown={event => event.preventDefault()} onClick={() => stepBy(1)}><ChevronUp size={15}/></button>
        <button type="button" aria-label={`Diminuisci ${label.toLocaleLowerCase('it-IT')}`} title={`Diminuisci ${label.toLocaleLowerCase('it-IT')}`} disabled={draftValue <= min}
          onPointerDown={event => event.preventDefault()} onClick={() => stepBy(-1)}><ChevronDown size={15}/></button>
      </span>
    </span>
  </div>
}

export function LayoutPanel({ layout, onChange, children }: { layout: DocumentLayout; onChange: (layout: DocumentLayout) => void; children?: React.ReactNode }) {
  const [custom, setCustom] = useState(false)
  const preset = [20, 12.7, 25.4].find(value => Object.values(layout.margins).every(margin => margin === value))
  const update = (changes: Partial<DocumentLayout>) => onChange(normalizeLayout({ ...layout, ...changes }))
  const margin = (side: keyof DocumentLayout['margins'], value: number) => update({ margins: { ...layout.margins, [side]: value } })
  return <section className="layout-panel" aria-label="Impostazioni layout" id="layout-panel" role="tabpanel" aria-labelledby="layout-tab">
    <div className="layout-groups">
      <fieldset className="layout-group layout-page-group">
        <legend title="Pagina, margini e spaziatura si applicano all'intero documento."><FileText size={13}/>Pagina</legend>
        <div className="layout-fields page-fields">
          <label className="layout-field"><span>Formato pagina</span><select aria-label="Formato pagina" value={layout.pageSize} onChange={event => update({ pageSize: event.target.value as DocumentLayout['pageSize'] })}><option value="A4">A4</option><option value="A5">A5</option><option value="Letter">Letter</option></select></label>
          <label className="layout-field"><span>Orientamento</span><select aria-label="Orientamento" value={layout.orientation} onChange={event => update({ orientation: event.target.value as DocumentLayout['orientation'] })}><option value="portrait">Verticale</option><option value="landscape">Orizzontale</option></select></label>
        </div>
        <button className="layout-reset" title="Ripristina formato, margini e spaziatura iniziali" onClick={() => { setCustom(false); onChange(normalizeLayout(undefined)) }}><RotateCcw size={12}/>Ripristina layout</button>
      </fieldset>
      <fieldset className="layout-group layout-margins-group">
        <legend><Columns2 size={13}/>Margini</legend>
        <label className="layout-field layout-preset"><span>Preset margini</span><select aria-label="Preset margini" value={custom || preset === undefined ? 'custom' : String(preset)} onChange={event => {
          if (event.target.value === 'custom') { setCustom(true); return }
          setCustom(false)
          const value = Number(event.target.value)
          update({ margins: { top: value, right: value, bottom: value, left: value } })
        }}><option value="20">Normali · 20 mm</option><option value="12.7">Stretti · 12,7 mm</option><option value="25.4">Ampi · 25,4 mm</option><option value="custom">Personalizzati</option></select></label>
        <div className="layout-fields margin-fields">
          <NumberField label="Margine superiore" shortLabel="Superiore" value={layout.margins.top} min={5} max={50} unit="mm" onCommit={value => margin('top', value)}/>
          <NumberField label="Margine inferiore" shortLabel="Inferiore" value={layout.margins.bottom} min={5} max={50} unit="mm" onCommit={value => margin('bottom', value)}/>
          <NumberField label="Margine sinistro" shortLabel="Sinistro" value={layout.margins.left} min={5} max={50} unit="mm" onCommit={value => margin('left', value)}/>
          <NumberField label="Margine destro" shortLabel="Destro" value={layout.margins.right} min={5} max={50} unit="mm" onCommit={value => margin('right', value)}/>
        </div>
      </fieldset>
      <fieldset className="layout-group layout-spacing-group">
        <legend><Rows3 size={13}/>Spaziatura</legend>
        <div className="layout-fields spacing-fields">
          <NumberField label="Interlinea" value={layout.lineSpacing} min={1} max={3} step={.1} onCommit={value => update({ lineSpacing: value })}/>
          <NumberField label="Spazio prima" value={layout.paragraphBefore} min={0} max={48} unit="pt" onCommit={value => update({ paragraphBefore: value })}/>
          <NumberField label="Spazio dopo" value={layout.paragraphAfter} min={0} max={48} unit="pt" onCommit={value => update({ paragraphAfter: value })}/>
        </div>
      </fieldset>
      {children}
    </div>
  </section>
}
