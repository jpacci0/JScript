import JSZip from 'jszip'
import type { JSONContent } from '@tiptap/react'
import type { DocumentLayout } from './types'
import { normalizeLayout, pageDimensions } from './layout'

type Attrs = Record<string, string | number | boolean>
type RunStyle = { fontFamily?: string; fontSize?: number; color?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; highlight?: string; vertical?: 'superscript' | 'subscript' | 'baseline' }
type ParaStyle = { attrs: Attrs; run: RunStyle; numId?: string; numLevel?: number; heading?: number }
type Style = { type: string; basedOn?: string; element: Element }
type Relation = { target: string; type: string; external: boolean }
type Numbering = { id: string; level: number; start: number; bullet: boolean; pPr?: Element | null }
type Block = { nodes: JSONContent[]; numbering?: Numbering }
const elements = (e?: Element | Document | null): Element[] => e ? Array.from(e.children) : []
const child = (e: Element | Document | null | undefined, name: string) => elements(e).find(item => item.localName === name) ?? null
const children = (e: Element | Document | null | undefined, name: string) => elements(e).filter(item => item.localName === name)
const wrappedChildren = (e: Element | null | undefined, name: string): Element[] => {
  const found: Element[] = [], pending = elements(e).reverse()
  while (pending.length) { const item = pending.pop()!; if (item.localName === name) found.push(item); else if (['sdt','sdtContent','customXml','ins','moveTo'].includes(item.localName)) pending.push(...elements(item).reverse()) }
  return found
}
const descendants = (e: Element | Document | null | undefined, name: string): Element[] => e ? Array.from(e.getElementsByTagName('*')).filter(item => item.localName === name) : []
const attr = (e: Element | null | undefined, name = 'val'): string | undefined => e ? Array.from(e.attributes).find(item => item.localName.split(':').pop() === name)?.value : undefined
const numeric = (value: string | undefined): number | undefined => value !== undefined && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined
const clamp = (n: number, low: number, high: number) => Math.round(Math.max(low, Math.min(high, n)) * 1000) / 1000
const on = (e: Element | null) => e ? !['0', 'false', 'off', 'none'].includes(attr(e) ?? '') : undefined
const fontName = (s?: string) => s && /^[a-z0-9 ,\-'\"]{1,100}$/i.test(s) ? s : undefined
const hex = (s?: string) => s && /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toUpperCase() : undefined
const safeHref = (s?: string) => !!s && s.length < 2048 && /^(https?:\/\/|mailto:|tel:)/i.test(s)
const blank = (): JSONContent => ({ type: 'paragraph' })
const HIGHLIGHTS: Record<string, string> = { yellow:'#FFFF00',green:'#00FF00',cyan:'#00FFFF',magenta:'#FF00FF',blue:'#0000FF',red:'#FF0000',darkBlue:'#000080',darkCyan:'#008080',darkGreen:'#008000',darkMagenta:'#800080',darkRed:'#800000',darkYellow:'#808000',darkGray:'#808080',lightGray:'#C0C0C0',black:'#000000',white:'#FFFFFF' }

/** A bounded OOXML subset translated into the editor's native, allowlisted model.
 * No imported HTML/CSS is evaluated and relationship targets never trigger network access.
 */
export async function importDocx(data: Uint8Array): Promise<{ content: JSONContent; layout: DocumentLayout; warnings: string[] }> {
  if (data.byteLength > 25 * 1024 * 1024) throw new Error('Il file supera il limite di 25 MB.')
  const zip = await JSZip.loadAsync(data)
  if (Object.keys(zip.files).length > 2000) throw new Error('Archivio Word troppo complesso.')
  const warnings = new Set<string>()
  const warn = (text: string) => warnings.add(text)
  let xmlBytes = 0
  const readXml = async (name: string, required = false): Promise<Document | null> => {
    const file = zip.file(name)
    if (!file) { if (required) throw new Error('Il file non contiene un documento Word valido.'); return null }
    const source = await file.async('string')
    xmlBytes += source.length
    if (source.length > 12 * 1024 * 1024 || xmlBytes > 30 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Struttura XML Word non supportata o troppo grande.')
    const document = new DOMParser().parseFromString(source, 'application/xml')
    if (document.getElementsByTagName('parsererror').length || document.getElementsByTagName('*').length > 150000) throw new Error('XML Word non valido o troppo complesso.')
    const pending: Array<{ element: Element; depth: number }> = [{ element: document.documentElement, depth: 0 }]
    while (pending.length) { const current = pending.pop()!; if (current.depth > 80) throw new Error('La struttura XML Word contiene troppi livelli annidati.'); for (const element of elements(current.element)) pending.push({ element, depth: current.depth + 1 }) }
    return document
  }
  const [document, stylesXml, numberingXml, relationshipsXml, themeXml] = await Promise.all([
    readXml('word/document.xml', true), readXml('word/styles.xml'), readXml('word/numbering.xml'), readXml('word/_rels/document.xml.rels'), readXml('word/theme/theme1.xml'),
  ])
  const body = child(document?.documentElement, 'body')
  if (!body) throw new Error('Il documento Word non contiene testo leggibile.')
  const themes: Record<string, string> = {}
  const scheme = descendants(themeXml, 'clrScheme')[0]
  for (const color of elements(scheme)) {
    const source = elements(color)[0]
    const value = hex(attr(source, source?.localName === 'sysClr' ? 'lastClr' : 'val'))
    if (value) themes[color.localName] = value
  }
  const themeFont = (kind: string) => fontName(attr(child(descendants(themeXml, kind.startsWith('major') ? 'majorFont' : 'minorFont')[0], 'latin'), 'typeface'))
  const readColor = (element: Element | null): string | undefined => {
    if (!element) return undefined
    const token = attr(element, 'themeColor')
    const aliases: Record<string, string> = { dark1:'dk1',dark2:'dk2',light1:'lt1',light2:'lt2',hyperlink:'hlink',followedHyperlink:'folHlink',text1:'dk1',text2:'dk2',background1:'lt1',background2:'lt2' }
    let color = (token && themes[aliases[token] ?? token]) || hex(attr(element))
    if (attr(element) === 'auto' && !color) color = '#000000'
    if (color) {
      const tint = attr(element, 'themeTint'), shade = attr(element, 'themeShade')
      if (tint && /^[0-9a-f]{2}$/i.test(tint) || shade && /^[0-9a-f]{2}$/i.test(shade)) {
        // Word adjusts HSL luminance, with themeTint taking precedence over themeShade.
        const rgb = [1,3,5].map(i => parseInt(color!.slice(i,i+2),16)/255)
        const max = Math.max(...rgb), min = Math.min(...rgb), delta = max-min
        const light = (max+min)/2, saturation = delta===0?0:delta/(1-Math.abs(2*light-1))
        let hue = delta===0?0:max===rgb[0]?((rgb[1]-rgb[2])/delta)%6:max===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4
        hue=(hue+6)%6
        const t = tint && /^[0-9a-f]{2}$/i.test(tint) ? parseInt(tint,16)/255 : undefined
        const adjusted = t!==undefined ? light*t+1-t : light*parseInt(shade!,16)/255
        const chroma=(1-Math.abs(2*adjusted-1))*saturation, x=chroma*(1-Math.abs(hue%2-1)), m=adjusted-chroma/2
        const channels=hue<1?[chroma,x,0]:hue<2?[x,chroma,0]:hue<3?[0,chroma,x]:hue<4?[0,x,chroma]:hue<5?[x,0,chroma]:[chroma,0,x]
        color='#'+channels.map(c=>Math.round((c+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase()
      }
    }
    return color || undefined
  }
  const readRun = (props: Element | null, base: RunStyle = {}): RunStyle => {
    const result = { ...base }
    if (!props) return result
    const fonts = child(props,'rFonts')
    const theme = attr(fonts,'asciiTheme') ?? attr(fonts,'hAnsiTheme')
    const family = (theme ? themeFont(theme) : undefined) || fontName(attr(fonts,'ascii') ?? attr(fonts,'hAnsi') ?? attr(fonts,'eastAsia'))
    if (fonts && family) result.fontFamily = family
    const size = numeric(attr(child(props,'sz')))
    if(size !== undefined) result.fontSize = clamp(size/2,4,200)
    const color = readColor(child(props,'color')); if(color) result.color=color
    for(const [key,name] of [['bold','b'],['italic','i'],['underline','u'],['strike','strike']] as const) { const value=on(child(props,name)); if(value!==undefined) result[key]=value }
    if(child(props,'dstrike')) result.strike=on(child(props,'dstrike'))
    const high=child(props,'highlight'); if(high) result.highlight=HIGHLIGHTS[attr(high) ?? '']
    const shading=child(props,'shd'); if(shading && hex(attr(shading,'fill'))) result.highlight=hex(attr(shading,'fill'))
    const vert=attr(child(props,'vertAlign')); if(vert==='superscript'||vert==='subscript'||vert==='baseline')result.vertical=vert
    if(on(child(props,'vanish'))||on(child(props,'webHidden')))warn('Il testo nascosto di Word è mantenuto ma può diventare visibile nell’editor.')
    if(child(props,'spacing')||child(props,'position')||child(props,'w'))warn('Spaziatura, scala e posizione dei caratteri possono differire da Word.')
    if(on(child(props,'caps'))||on(child(props,'smallCaps'))) warn('Maiuscoletto e trasformazioni automatiche maiuscole possono apparire diversamente.')
    return result
  }
  const readPara = (props: Element | null, base: ParaStyle): ParaStyle => {
    const out: ParaStyle = { ...base, attrs:{...base.attrs},run:{...base.run} }
    if(!props) return out
    const jc=attr(child(props,'jc')); const align:Record<string,string>={left:'left',start:'left',right:'right',end:'right',center:'center',both:'justify',distribute:'justify'}
    if(jc && align[jc])out.attrs.textAlign=align[jc]
    const spacing=child(props,'spacing')
    for(const [name,key] of [['before','wordBefore'],['after','wordAfter']] as const){const n=numeric(attr(spacing,name));if(n!==undefined)out.attrs[key]=clamp(n/20,0,1584)}
    const line=numeric(attr(spacing,'line'));if(line!==undefined){const rule=attr(spacing,'lineRule')??'auto';delete out.attrs.wordLine;delete out.attrs.wordLinePt;if(rule==='auto')out.attrs.wordLine=clamp(line/240,.5,10);else{out.attrs.wordLinePt=clamp(line/20,1,300);if(rule==='atLeast')warn('L’interlinea minima di Word viene approssimata con un’altezza di riga fissa.')}}
    if(['beforeLines','afterLines','beforeAutospacing','afterAutospacing'].some(n=>attr(spacing,n)!==undefined))warn('La spaziatura automatica o espressa in righe può differire da Word.')
    const indent=child(props,'ind')
    for(const [name,fallback,key] of [['left','start','wordIndentLeft'],['right','end','wordIndentRight']] as const){const n=numeric(attr(indent,name)??attr(indent,fallback));if(n!==undefined)out.attrs[key]=clamp(n/20,-100,1000)}
    const first=numeric(attr(indent,'firstLine')), hanging=numeric(attr(indent,'hanging'));if(first!==undefined)out.attrs.wordIndentFirst=clamp(first/20,-100,1000);if(hanging!==undefined)out.attrs.wordIndentFirst=clamp(-hanging/20,-100,1000)
    const keep=on(child(props,'keepNext'));if(keep!==undefined)out.attrs.wordKeepNext=keep
    const num=child(props,'numPr');if(num){out.numId=attr(child(num,'numId'))??out.numId;out.numLevel=numeric(attr(child(num,'ilvl')))??out.numLevel}
    const outline=numeric(attr(child(props,'outlineLvl')));if(outline!==undefined)out.heading=outline<6?outline+1:undefined
    out.run=readRun(child(props,'rPr'),out.run)
    if(on(child(props,'pageBreakBefore')))warn('Le interruzioni manuali di pagina vengono reimpaginate automaticamente.')
    if(child(props,'tabs'))warn('Le tabulazioni personalizzate sono approssimate; i punti di allineamento possono cambiare.')
    if(child(props,'pBdr')||child(props,'shd'))warn('Bordi e sfondi dei paragrafi non sono ancora conservati.')
    return out
  }
  const styles = new Map<string,Style>()
  let defaultStyle='Normal'
  for(const element of descendants(stylesXml,'style')){const id=attr(element,'styleId');if(!id)continue;styles.set(id,{type:attr(element,'type')??'',basedOn:attr(child(element,'basedOn')),element});if(attr(element,'type')==='paragraph'&&onAttribute(element,'default'))defaultStyle=id}
  function onAttribute(element:Element,name:string){return ['1','true','on'].includes(attr(element,name)??'')}
  const styleChain = (id?:string):Style[]=>{const chain:Style[]=[];const seen=new Set<string>();while(id&&styles.has(id)){if(seen.has(id)||chain.length>=30){warn('Una catena di stili Word non valida è stata interrotta.');break}seen.add(id);const style=styles.get(id)!;chain.unshift(style);id=style.basedOn}return chain}
  const defaults=child(stylesXml?.documentElement,'docDefaults')
  let defaultRun=readRun(child(child(defaults,'rPrDefault'),'rPr'),{fontFamily:themeFont('minor')??'Calibri',fontSize:11,color:'#000000'})
  let defaultPara=readPara(child(child(defaults,'pPrDefault'),'pPr'),{attrs:{textAlign:'left',wordBefore:0,wordAfter:0,wordLine:1,wordIndentLeft:0,wordIndentRight:0,wordIndentFirst:0},run:defaultRun})
  const paragraphStyle=(id?:string,table?:ParaStyle):ParaStyle=>{let base:ParaStyle={...defaultPara,attrs:{...defaultPara.attrs,...table?.attrs},run:{...defaultPara.run,...table?.run}};for(const style of styleChain(id??defaultStyle)){base=readPara(child(style.element,'pPr'),base);base.run=readRun(child(style.element,'rPr'),base.run);const label=attr(child(style.element,'name'))??'';const heading=(attr(style.element,'styleId')??'').match(/^heading([1-6])$/i)||label.match(/^(?:heading|titolo)\s*([1-6])$/i);if(heading)base.heading=Number(heading[1])}return base}
  const normal = paragraphStyle()
  const sections=descendants(body,'sectPr')
  const section=sections[0]
  if(sections.length>1)warn('Il documento contiene più sezioni: viene applicata a tutto il testo la geometria della prima sezione.')
  const size=child(section,'pgSz'), w=numeric(attr(size,'w')), h=numeric(attr(size,'h'))
  const orientation=attr(size,'orient')==='landscape'||w!==undefined&&h!==undefined&&w>h?'landscape':'portrait'
  let pageSize:DocumentLayout['pageSize']='A4'
  if(w&&h){const short=Math.min(w,h)*25.4/1440,long=Math.max(w,h)*25.4/1440;const formats=[['A4',210,297],['A5',148,210],['Letter',215.9,279.4]] as const;const match=formats.find(([,a,b])=>Math.abs(a-short)<1.2&&Math.abs(b-long)<1.2);if(match)pageSize=match[0];else warn('Il formato pagina personalizzato è stato adattato ad A4.')}
  const marginElement=child(section,'pgMar');const margins={top:20,right:20,bottom:20,left:20}
  for(const side of ['top','right','bottom','left'] as const){const n=numeric(attr(marginElement,side));if(n!==undefined){const mm=n*25.4/1440;if(mm<5||mm>50)warn('Alcuni margini Word sono fuori dall’intervallo supportato e sono stati adattati.');margins[side]=mm}}
  if(numeric(attr(marginElement,'gutter')))warn('Il margine di rilegatura non è ancora supportato.')
  const layout=normalizeLayout({pageSize,orientation,margins,lineSpacing:Number(normal.attrs.wordLine)||1,paragraphBefore:Number(normal.attrs.wordBefore)||0,paragraphAfter:Number(normal.attrs.wordAfter)||0})
  const contentWidth=(pageDimensions(layout).width-layout.margins.left-layout.margins.right)*1440/25.4
  if(descendants(body,'headerReference').length||descendants(body,'footerReference').length)warn('Intestazioni e piè di pagina non sono ancora riprodotti nell’editor.')
  if(sections.some(e=>(numeric(attr(child(e,'cols'),'num'))??1)>1))warn('Le colonne di sezione di Word vengono importate in un flusso unico; usa le sezioni affiancate di JScript per ricrearle.')
  if(descendants(body,'footnoteReference').length||descendants(body,'endnoteReference').length)warn('Note a piè di pagina e note di chiusura non sono ancora importate.')
  if(descendants(body,'oMath').length)warn('Le formule matematiche vengono approssimate come testo normale.');
  if(descendants(body,'instrText').length||descendants(body,'fldSimple').length)warn('I campi automatici sono conservati come testo e non vengono ricalcolati.')
  if(sections.some(e=>child(e,'pgBorders')))warn('I bordi decorativi della pagina non sono ancora conservati.')
  if(descendants(body,'commentRangeStart').length)warn('I commenti Word non vengono importati.')
  if(descendants(body,'ins').length||descendants(body,'del').length||descendants(body,'moveFrom').length)warn('Le revisioni sono importate come testo finale: inserimenti accettati ed eliminazioni escluse.')
  const relations=new Map<string,Relation>()
  for(const rel of descendants(relationshipsXml,'Relationship')){const id=attr(rel,'Id'),target=attr(rel,'Target');if(id&&target)relations.set(id,{target,type:attr(rel,'Type')??'',external:attr(rel,'TargetMode')==='External'})}
  const abstractNumbers=new Map<string,Element>(), numberInstances=new Map<string,Element>()
  for(const n of descendants(numberingXml,'abstractNum')){const id=attr(n,'abstractNumId');if(id)abstractNumbers.set(id,n)}
  for(const n of descendants(numberingXml,'num')){const id=attr(n,'numId');if(id)numberInstances.set(id,n)}
  const numberCounters=new Map<string,number>()
  const numberingFor=(p:ParaStyle):Numbering|undefined=>{
    if(!p.numId||p.numId==='0')return undefined
    const level=Math.max(0,Math.min(8,p.numLevel??0));const instance=numberInstances.get(p.numId);const abstract=abstractNumbers.get(attr(child(instance,'abstractNumId'))??'')
    const override=children(instance,'lvlOverride').find(e=>numeric(attr(e,'ilvl'))===level)
    const lvl=child(override,'lvl')??children(abstract,'lvl').find(e=>numeric(attr(e,'ilvl'))===level)
    if(!lvl){warn('Una definizione di elenco Word mancante è stata semplificata.');return undefined}
    const format=attr(child(lvl,'numFmt'))??'decimal'
    if(format!=='bullet'&&format!=='decimal')warn('Numerazioni alfabetiche, romane e simboli personalizzati sono convertiti in elenchi standard.')
    const start=clamp(numeric(attr(child(override,'startOverride')))??numeric(attr(child(lvl,'start')))??1,1,100000)
    const counterKey=`${p.numId}:${level}`;const current=numberCounters.get(counterKey)??start;numberCounters.set(counterKey,current+1)
    for(let deeper=level+1;deeper<=8;deeper++)numberCounters.delete(`${p.numId}:${deeper}`)
    return {id:p.numId,level,start:current,bullet:format==='bullet',pPr:child(lvl,'pPr')}
  }
  const marksFor=(style:RunStyle,link?:string):NonNullable<JSONContent['marks']>=>{
    const marks:NonNullable<JSONContent['marks']>=[]
    for(const [key,type] of [['bold','bold'],['italic','italic'],['underline','underline'],['strike','strike']] as const)if(style[key])marks.push({type})
    const attrs:Record<string,string>={};if(style.fontFamily)attrs.fontFamily=style.fontFamily;if(style.fontSize)attrs.fontSize=`${style.fontSize}pt`;if(style.color)attrs.color=style.color
    if(Object.keys(attrs).length)marks.push({type:'textStyle',attrs})
    if(style.highlight)marks.push({type:'highlight',attrs:{color:style.highlight}})
    if(style.vertical==='superscript'||style.vertical==='subscript')marks.push({type:style.vertical})
    if(link&&safeHref(link))marks.push({type:'link',attrs:{href:link,target:'_blank',rel:'noopener noreferrer'}})
    return marks
  }
  let imageBytes=0,imageCount=0
  const imageFor=async(drawing:Element):Promise<JSONContent|undefined>=>{
    const blip=descendants(drawing,'blip')[0]??descendants(drawing,'imagedata')[0]
    const id=attr(blip,'embed')??attr(blip,'id')??attr(blip,'link');if(!id){warn('Un oggetto grafico Word non supportato è stato omesso.');return}
    const relation=relations.get(id);if(!relation)return
    if(relation.external||attr(blip,'link')){warn('Le immagini esterne non vengono scaricate: incorpora le immagini nel file Word.');return}
    if(!relation.type.endsWith('/image'))return
    const pieces=(relation.target.startsWith('/')?relation.target.slice(1):'word/'+relation.target).replace(/\\/g,'/').split('/');const parts:string[]=[]
    for(const part of pieces){if(part==='..'){if(!parts.length)return;parts.pop()}else if(part!=='.'&&part)parts.push(part)}
    const filename=parts.join('/');if(!filename.startsWith('word/'))return
    const ext=filename.split('.').pop()?.toLowerCase();const type=ext==='jpg'?'jpeg':ext
    if(!['png','jpeg','webp'].includes(type??'')){warn('Alcune immagini Word usano un formato non supportato (ad esempio EMF o SVG).');return}
    const file=zip.file(filename);if(!file)return
    if(++imageCount>100)throw new Error('Il documento contiene troppe immagini (massimo 100).')
    const bytes=await file.async('uint8array');imageBytes+=bytes.length
    if(bytes.length>10*1024*1024||imageBytes>25*1024*1024)throw new Error('Le immagini incorporate sono troppo grandi per l’editor.')
    const data=await file.async('base64')
    const extent=descendants(drawing,'extent')[0]??descendants(drawing,'ext').find(e=>attr(e,'cx')&&attr(e,'cy'))
    const width=numeric(attr(extent,'cx')),height=numeric(attr(extent,'cy'));const docPr=descendants(drawing,'docPr')[0]
    if(descendants(drawing,'anchor').length)warn('Le immagini flottanti sono inserite nel flusso del testo; posizione e disposizione possono cambiare.')
    if(descendants(drawing,'srcRect').length||descendants(drawing,'xfrm').some(e=>attr(e,'rot')))warn('Ritaglio e rotazione delle immagini Word non sono ancora conservati.')
    return {type:'image',attrs:{src:`data:image/${type};base64,${data}`,alt:(attr(docPr,'descr')??attr(docPr,'name')??'').slice(0,500),...(width&&height?{width:clamp(width/9525,1,10000),height:clamp(height/9525,1,10000)}:{})}}
  }
  const paragraph=async(element:Element,table?:ParaStyle):Promise<Block>=>{
    const props=child(element,'pPr');const id=attr(child(props,'pStyle'));let style=paragraphStyle(id,table)
    // Numbering paragraph defaults precede the paragraph's own direct properties.
    const firstPass=readPara(props,style);const numbering=numberingFor(firstPass)
    if(numbering?.pPr)style=readPara(numbering.pPr,style)
    style=readPara(props,style)
    style.attrs.wordFontFamily=style.run.fontFamily??'Calibri';style.attrs.wordFontSize=style.run.fontSize??11
    const blockType=style.heading?'heading':'paragraph';const attrs={...style.attrs,...(style.heading?{level:style.heading}:{})}
    const parts:JSONContent[]=[];let inline:JSONContent[]=[]
    const flush=(force=false)=>{if(inline.length||force){parts.push({type:blockType,attrs:{...attrs},...(inline.length?{content:inline}:{})});inline=[]}}
    const addText=(text:string,run:RunStyle,link?:string)=>{if(!text)return;const marks=marksFor(run,link);const last=inline[inline.length-1];if(last?.type==='text'&&JSON.stringify(last.marks??[])===JSON.stringify(marks))last.text+=text;else inline.push({type:'text',text,...(marks.length?{marks}:{})})}
    const walk=async(parent:Element,run:RunStyle,link?:string):Promise<void>=>{
      for(const item of elements(parent)){
        const kind=item.localName
        if(['pPr','rPr','sectPr','del','moveFrom','instrText','delText','bookmarkStart','bookmarkEnd','proofErr','fldChar'].includes(kind))continue
        if(kind==='r'){
          const rPr=child(item,'rPr');let resolved={...run};for(const chain of styleChain(attr(child(rPr,'rStyle'))))resolved=readRun(child(chain.element,'rPr'),resolved);resolved=readRun(rPr,resolved)
          await walk(item,resolved,link)
        }else if(kind==='t')addText(item.textContent??'',run,link)
        else if(kind==='tab'){addText('\t',run,link);warn('Le tabulazioni sono approssimate; per gli allineamenti complessi usa una tabella.')}
        else if(kind==='br'||kind==='cr'){
          const type=attr(item,'type');if(type==='page'||type==='column')warn('Le interruzioni manuali di pagina o colonna vengono reimpaginate automaticamente.')
          inline.push({type:'hardBreak'})
        }else if(kind==='noBreakHyphen')addText('\u2011',run,link)
        else if(kind==='softHyphen')addText('\u00AD',run,link)
        else if(kind==='hyperlink'){const relation=relations.get(attr(item,'id')??'');await walk(item,run,relation&&safeHref(relation.target)?relation.target:undefined)}
        else if(kind==='drawing'||kind==='pict'){
          const textBox=descendants(item,'txbxContent')[0]
          if(textBox){warn('Le caselle di testo sono convertite in testo normale; il posizionamento originale non è conservato.');for(const p of children(textBox,'p')){if(inline.length)inline.push({type:'hardBreak'});await walk(p,run,link)}}
          else {const image=await imageFor(item);if(image){if(inline.length)warn('Le immagini all’interno di una riga vengono spostate su un blocco separato.');flush();parts.push(image)}}
        }else if(kind==='AlternateContent'){const choice=child(item,'Choice')??child(item,'Fallback');if(choice)await walk(choice,run,link)}
        else if(['footnoteReference','endnoteReference','commentReference','lastRenderedPageBreak'].includes(kind))continue
        else if(kind==='sym'){const code=attr(item,'char');if(code&&/^[0-9a-f]{2,6}$/i.test(code)){const cp=parseInt(code,16);if(cp<=0x10ffff)addText(String.fromCodePoint(cp),run,link)}warn('I simboli dei font speciali possono apparire diversamente.')}
        else if(kind==='sdt'){const content=child(item,'sdtContent');if(content)await walk(content,run,link)}
        else await walk(item,run,link)
      }
    }
    await walk(element,style.run)
    flush(parts.length===0)
    if(numbering&&parts[0]?.type==='heading'){parts[0].type='paragraph';delete parts[0].attrs?.level}
    if(numbering&&parts[0]?.type!=='paragraph')parts.unshift({type:'paragraph',attrs:{...attrs}})
    return {nodes:parts,numbering}
  }
  const groupLists=(blocks:Block[]):JSONContent[]=>{
    const output:JSONContent[]=[];const stack:Array<{list:JSONContent;id:string;bullet:boolean}>=[]
    for(const block of blocks){const num=block.numbering;if(!num){output.push(...block.nodes);stack.length=0;continue}
      let depth=Math.min(num.level,stack.length)
      if(depth<num.level)warn('Alcuni livelli di elenco senza un livello padre sono stati semplificati.')
      if(depth===stack.length&&depth>0&&!stack[depth-1].list.content?.length)depth--
      if(stack[depth]&&(stack[depth].id!==num.id||stack[depth].bullet!==num.bullet))stack.length=depth
      if(stack.length>depth+1)stack.length=depth+1
      if(!stack[depth]){const list:JSONContent={type:num.bullet?'bulletList':'orderedList',...(num.bullet?{}:{attrs:{start:num.start}}),content:[]};if(depth===0)output.push(list);else{const items=stack[depth-1].list.content!;items[items.length-1].content!.push(list)}stack[depth]={list,id:num.id,bullet:num.bullet}}
      stack[depth].list.content!.push({type:'listItem',content:block.nodes})
    }
    return output
  }
  const border=(element:Element|null):string|undefined=>{
    if(!element)return undefined;const kind=attr(element)??'single';if(kind==='nil'||kind==='none')return '0pt none #000000'
    const styles:Record<string,string>={single:'solid',thick:'solid',double:'double',dashed:'dashed',dashSmallGap:'dashed',dotDash:'dashed',dotted:'dotted'}
    if(!styles[kind])warn('Alcuni bordi decorativi di Word sono stati semplificati.')
    return `${clamp((numeric(attr(element,'sz'))??4)/8,0,12)}pt ${styles[kind]??'solid'} ${readColor(element)??hex(attr(element,'color'))??'#000000'}`
  }
  const cellProperties=(props:Element|null,base:Attrs={}):Attrs=>{
    const out={...base};if(!props)return out
    const fill=hex(attr(child(props,'shd'),'fill'));if(fill)out.wordFill=fill
    const valign=attr(child(props,'vAlign'));if(valign&&['top','center','bottom'].includes(valign))out.wordVAlign=valign==='center'?'middle':valign
    const borders=child(props,'tcBorders');const padding=child(props,'tcMar')??child(props,'tblCellMar')
    for(const [side,cap] of [['top','Top'],['right','Right'],['bottom','Bottom'],['left','Left']] as const){const b=border(child(borders,side));if(b)out[`wordBorder${cap}`]=b;const n=numeric(attr(child(padding,side),'w'));if(n!==undefined)out[`wordPadding${cap}`]=clamp(n/20,0,100)}
    return out
  }
  const table=async(element:Element,depth:number,maxWidth:number):Promise<JSONContent>=>{
    const props=child(element,'tblPr');const styleId=attr(child(props,'tblStyle'));const chain=styleChain(styleId)
    if(chain.some(style=>children(style.element,'tblStylePr').some(condition=>['firstCol','lastCol','band1Vert','band2Vert','nwCell','neCell','swCell','seCell'].includes(attr(condition,'type')??''))))warn('Alcuni stili condizionali delle colonne e degli angoli della tabella sono semplificati.')
    const tableProps=[...chain.map(style=>child(style.element,'tblPr')).filter((e):e is Element=>!!e),...(props?[props]:[])]
    const rowElements=wrappedChildren(element,'tr');if(rowElements.length>2000)throw new Error('Tabella Word troppo grande.')
    let columnWidths=children(child(element,'tblGrid'),'gridCol').map(e=>numeric(attr(e,'w'))??0)
    if(columnWidths.length>100)throw new Error('La tabella contiene troppe colonne.')
    const rowGridWidths=rowElements.map(row=>wrappedChildren(row,'tc').reduce((sum,cell)=>sum+(numeric(attr(child(child(cell,'tcPr'),'gridSpan')))??1),0))
    const gridCount=Math.max(columnWidths.length,...rowGridWidths,1)
    if(gridCount>100)throw new Error('La tabella contiene troppe colonne.')
    if(!columnWidths.length)columnWidths=Array(gridCount).fill(maxWidth/gridCount)
    if(columnWidths.some(n=>n<=0))columnWidths=columnWidths.map(n=>n>0?n:maxWidth/gridCount)
    while(columnWidths.length<gridCount)columnWidths.push(maxWidth/gridCount)
    const sum=columnWidths.reduce((s,n)=>s+n,0)
    const percentages=columnWidths.map(n=>Math.round(n/sum*1000000)/10000)
    const attrs:Attrs={columnSize:percentages.join(',')}
    const tableBorders:Record<string,string>={};let defaultCell:Attrs={};let tableParagraph:ParaStyle={attrs:{},run:{}}
    for(const style of chain){tableParagraph=readPara(child(style.element,'pPr'),tableParagraph);tableParagraph.run=readRun(child(style.element,'rPr'),tableParagraph.run);defaultCell=cellProperties(child(style.element,'tcPr'),defaultCell)}
    for(const pr of tableProps){const width=child(pr,'tblW');const size=numeric(attr(width,'w'));const unit=attr(width,'type');if(size&&unit==='pct')attrs.wordWidth=clamp(size/50,1,100);else if(size&&unit==='dxa')attrs.wordWidth=clamp(size/maxWidth*100,1,100)
      const align=attr(child(pr,'jc'));if(align&&['left','center','right'].includes(align))attrs.wordAlign=align
      const indent=numeric(attr(child(pr,'tblInd'),'w'));if(indent!==undefined)attrs.wordIndent=clamp(indent/20,0,500)
      defaultCell=cellProperties(pr,defaultCell)
      const borders=child(pr,'tblBorders');for(const side of ['top','right','bottom','left','insideH','insideV']){const b=border(child(borders,side));if(b)tableBorders[side]=b}
      if(child(pr,'tblpPr'))warn('Le tabelle flottanti vengono inserite nel flusso del testo.')
    }
    if(attrs.wordWidth===undefined)attrs.wordWidth=clamp(sum/maxWidth*100,1,100)
    const look=child(props,'tblLook');const lookMask=parseInt(attr(look)??'0',16)
    const isLook=(name:string,mask:number)=>attr(look,name)!==undefined?['1','true'].includes(attr(look,name)!):Boolean(lookMask&mask)
    const rows:JSONContent[]=[];let activeMerges=new Map<number,JSONContent>()
    for(let rowIndex=0;rowIndex<rowElements.length;rowIndex++){
      const row=rowElements[rowIndex];const rowProps=child(row,'trPr');const header=on(child(rowProps,'tblHeader'))===true;let rowBase={...defaultCell},rowParagraph:ParaStyle={attrs:{...tableParagraph.attrs},run:{...tableParagraph.run}}
      for(const style of chain){for(const condition of children(style.element,'tblStylePr')){const type=attr(condition,'type');const applies=type==='wholeTable'||type==='firstRow'&&(header||rowIndex===0&&isLook('firstRow',0x20))||type==='lastRow'&&rowIndex===rowElements.length-1&&isLook('lastRow',0x40)||type==='band1Horz'&&!isLook('noHBand',0x200)&&rowIndex%2===0||type==='band2Horz'&&!isLook('noHBand',0x200)&&rowIndex%2===1;if(applies){rowBase=cellProperties(child(condition,'tcPr'),rowBase);rowParagraph=readPara(child(condition,'pPr'),rowParagraph);rowParagraph.run=readRun(child(condition,'rPr'),rowParagraph.run)}}}
      const cells:JSONContent[]=[];const nextMerges=new Map<number,JSONContent>();let col=0
      const before=clamp(numeric(attr(child(rowProps,'gridBefore')))??0,0,99)
      if(before){cells.push({type:'tableCell',attrs:{colspan:before,rowspan:1,wordBorderTop:'0pt none #000000',wordBorderRight:'0pt none #000000',wordBorderBottom:'0pt none #000000',wordBorderLeft:'0pt none #000000'},content:[blank()]});col=before}
      for(const cell of wrappedChildren(row,'tc')){
        const tcPr=child(cell,'tcPr');const span=clamp(numeric(attr(child(tcPr,'gridSpan')))??1,1,100);const vertical=child(tcPr,'vMerge')
        if(vertical&&attr(vertical)!=='restart'){
          const anchor=activeMerges.get(col)
          if(anchor&&Number(anchor.attrs?.colspan)===span){anchor.attrs!.rowspan=Number(anchor.attrs!.rowspan)+1;for(let i=0;i<span;i++)nextMerges.set(col+i,anchor);col+=span;continue}
          warn('Una cella unita non valida è stata ricostruita come cella normale.')
        }
        let cellAttrs:Attrs={...rowBase,colspan:span,rowspan:1}
        for(const [side,cap] of [['top','Top'],['right','Right'],['bottom','Bottom'],['left','Left']] as const){const outer=side==='top'?rowIndex===0:side==='bottom'?rowIndex===rowElements.length-1:side==='left'?col===0:col+span>=gridCount;const b=tableBorders[outer?side:side==='top'||side==='bottom'?'insideH':'insideV'];cellAttrs[`wordBorder${cap}`]=b??'0pt none #000000'}
        cellAttrs=cellProperties(tcPr,cellAttrs)

        const cellWidth=columnWidths.slice(col,col+span).reduce((s,n)=>s+n,0)||maxWidth/gridCount*span
        const content=await readBlocks(cell,depth+1,cellWidth,rowParagraph)
        const cellNode:JSONContent={type:header?'tableHeader':'tableCell',attrs:cellAttrs,content:content.length?content:[blank()]}
        cells.push(cellNode)
        if(vertical&&attr(vertical)==='restart')for(let i=0;i<span;i++)nextMerges.set(col+i,cellNode)
        col+=span
      }
      const after=clamp(numeric(attr(child(rowProps,'gridAfter')))??0,0,99)
      if(after)cells.push({type:'tableCell',attrs:{colspan:after,rowspan:1},content:[blank()]})
      rows.push({type:'tableRow',content:cells});activeMerges=nextMerges
      if(child(rowProps,'trHeight'))warn('Le altezze fisse delle righe sono adattate al contenuto.')
    }
    // Prebuild the same connected row-span groups used by tiptap-table-plus.
    // Otherwise its grouping transaction recreates the table with default attrs.
    const groups:Array<{start:number;end:number}>=[]
    for(let i=0;i<rows.length;i++){const extent=Math.min(rows.length-1,i+Math.max(1,...(rows[i].content??[]).map(cell=>Number(cell.attrs?.rowspan)||1))-1);const last=groups[groups.length-1];if(last&&i<=last.end)last.end=Math.max(last.end,extent);else groups.push({start:i,end:extent})}
    const grouped=groups.some(group=>group.end>group.start)?groups.map(group=>({type:'tableRowGroup',content:rows.slice(group.start,group.end+1)})):rows
    return {type:'table',attrs,content:grouped}
  }
  let blockCount=0
  const readBlocks=async(container:Element,depth:number,maxWidth:number,tableStyle?:ParaStyle):Promise<JSONContent[]>=>{
    if(depth>20)throw new Error('Il documento contiene troppe tabelle annidate.')
    const blocks:Block[]=[]
    for(const element of elements(container)){
      if(++blockCount>50000)throw new Error('Il documento contiene troppi elementi.')
      if(element.localName==='p'||element.localName==='oMathPara')blocks.push(await paragraph(element,tableStyle))
      else if(element.localName==='tbl'){const node=await table(element,depth,maxWidth);if(node.content?.length)blocks.push({nodes:[node]})}
      else if(['sdt','ins','moveTo','customXml'].includes(element.localName)){const wrapper=child(element,'sdtContent')??element;blocks.push({nodes:await readBlocks(wrapper,depth+1,maxWidth,tableStyle)})}
      else if(element.localName==='altChunk')warn('Il documento contiene un allegato incorporato non supportato; il relativo contenuto non è stato importato.')
    }
    return groupLists(blocks)
  }
  const content=await readBlocks(body,0,contentWidth)
  return {content:{type:'doc',content:content.length?content:[blank()]},layout,warnings:[...warnings]}
}
