import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { Window } from 'happy-dom'
import type { JSONContent } from '@tiptap/react'
import type { StoredDocument } from '../src/lib/types'
import { importDocument, toDocx, toNativeBytes, validateNativeDocument } from '../src/lib/documents'
const win = new Window()
Object.assign(globalThis, { DOMParser: win.DOMParser })
const text=(value:string):JSONContent=>({type:'text',text:value,marks:[{type:'textStyle',attrs:{fontFamily:'Georgia',fontSize:'13pt',color:'#123456'}}]})
const p=(value:string):JSONContent=>({type:'paragraph',attrs:{wordFontFamily:'Georgia',wordFontSize:13,wordBefore:6,wordAfter:9,wordLine:1.25,wordIndentLeft:24,wordIndentRight:12,wordIndentFirst:-12},content:[text(value)]})
const document=():StoredDocument=>({id:'word-roundtrip',title:'Word avanzato',updatedAt:'2026-10-26T12:00:00Z',content:{type:'doc',content:[p('Paragrafo personalizzato'),{type:'paragraph',attrs:{wordFontFamily:'Georgia',wordFontSize:13,wordLinePt:18,wordBefore:0,wordAfter:0},content:[]},{type:'paragraph',content:[{type:'text',text:'Sito',marks:[{type:'link',attrs:{href:'https://example.com',target:'_blank',rel:'noopener noreferrer'}}]}]},{type:'table',attrs:{columnSize:'30,70',wordWidth:80,wordAlign:'center'},content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:1,rowspan:1,wordFill:'#DDEEFF',wordVAlign:'middle',wordBorderTop:'1.5pt solid #123456',wordBorderRight:'0pt none #000000',wordBorderBottom:'0.5pt dashed #ABCDEF',wordBorderLeft:'1pt double #123456',wordPaddingTop:4,wordPaddingLeft:6},content:[p('Cella stretta')]},{type:'tableCell',attrs:{colspan:1,rowspan:1},content:[p('Cella larga')]}]}]}]},importWarnings:['Una nota di compatibilità']})

test('native documents preserve bounded paragraph and cell formatting plus compatibility details',()=>{
 const doc=document(); const result=validateNativeDocument(new TextDecoder().decode(toNativeBytes(doc)))
 assert.deepEqual(result.content,doc.content);assert.deepEqual(result.importWarnings,doc.importWarnings)
 const bad=document();Object.assign(bad.content.content![0].attrs!,{wordFontFamily:'url(https://example.com)',wordLine:100,wordBefore:-50,wordIndentLeft:Infinity});
 const check=validateNativeDocument(new TextDecoder().decode(toNativeBytes(bad)))
 assert.equal(check.content.content![0].attrs!.wordFontFamily,undefined);assert.equal(check.content.content![0].attrs!.wordLine,undefined)
})

test('DOCX export writes explicit paragraph spacing, hanging indent, exact line spacing and hyperlinks',async()=>{
 const zip=await JSZip.loadAsync(await toDocx(document()));const xml=await zip.file('word/document.xml')!.async('string');const rels=await zip.file('word/_rels/document.xml.rels')!.async('string')
 assert.match(xml,/w:before="120"/);assert.match(xml,/w:after="180"/);assert.match(xml,/w:line="300"/);assert.match(xml,/w:left="480"/);assert.match(xml,/w:hanging="240"/);assert.match(xml,/w:lineRule="exact"/);assert.match(xml,/w:line="360"/)
 assert.match(xml,/w:fill="DDEEFF"/);assert.match(xml,/w:vAlign w:val="center"/);assert.match(xml,/w:sz="12"/);assert.match(xml,/w:type="pct" w:w="4000"|w:w="4000" w:type="pct"/);assert.match(rels,/https:\/\/example.com/)
})

test('advanced import/export retains typography, layout and table details across a full Word roundtrip',async()=>{
 const imported=await importDocument('test.docx',await toDocx(document()));assert.equal(typeof imported.content,'object');
 const content=imported.content as JSONContent; const first=content.content![0];assert.equal(first.attrs!.wordBefore,6);assert.equal(first.attrs!.wordAfter,9);assert.equal(first.attrs!.wordLine,1.25);assert.equal(first.attrs!.wordIndentFirst,-12)
 assert.equal(first.content![0].marks!.find(m=>m.type==='textStyle')!.attrs!.fontFamily,'Georgia')
 const table=content.content!.find(node=>node.type==='table')!;assert.equal(table.attrs!.wordWidth,80);assert.equal(table.attrs!.wordAlign,'center')
 const row=table.content![0].type==='tableRowGroup'?table.content![0].content![0]:table.content![0];assert.equal(row.content![0].attrs!.wordFill,'#DDEEFF');assert.equal(row.content![0].attrs!.wordVAlign,'middle');assert.equal(row.content![0].attrs!.wordBorderTop,'1.5pt solid #123456')
})

test('fully merged rows are retained while standalone empty rows are rejected',()=>{
 const doc=document();doc.content={type:'doc',content:[{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{rowspan:2,colspan:1},content:[p('Due righe')]}]},{type:'tableRow',content:[]}]}]};assert.doesNotThrow(()=>validateNativeDocument(new TextDecoder().decode(toNativeBytes(doc))))
 doc.content.content![0].content![0].content![0].attrs!.rowspan=1;assert.throws(()=>validateNativeDocument(new TextDecoder().decode(toNativeBytes(doc))),/riga vuota/)
})
