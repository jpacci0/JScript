import type { WorkspaceState } from './types'
import { validateNativeDocument } from './documents'
const empty=():WorkspaceState=>({version:1,activeId:null,documents:[]})
function validateState(value:unknown):WorkspaceState {
  if(!value) return empty()
  const state=value as WorkspaceState
  if(state.version!==1 || !Array.isArray(state.documents) || state.documents.length>500) throw new Error('Archivio locale non riconosciuto. I dati originali non sono stati modificati.')
  const ids=new Set<string>()
  const documents=state.documents.map(doc=>{
    if(typeof doc.id!=='string'||ids.has(doc.id))throw new Error('Archivio locale non valido.')
    ids.add(doc.id)
    const checked=validateNativeDocument(JSON.stringify({...doc,format:'jscript',version:1}))
    return {...doc,...checked}
  })
  return {version:1,documents,activeId:documents.some(d=>d.id===state.activeId)?state.activeId:null}
}
function openDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
  const r=indexedDB.open('jscript-workspace',1)
  r.onupgradeneeded=()=>r.result.createObjectStore('workspace')
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)
})}
export async function loadWorkspace():Promise<WorkspaceState>{
  if(window.jscript) return validateState(await window.jscript.loadAutosave())
  const db=await openDB()
  try{return validateState(await new Promise((resolve,reject)=>{const r=db.transaction('workspace').objectStore('workspace').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)}))}finally{db.close()}
}
export async function persistWorkspace(state:WorkspaceState):Promise<void>{
  if(window.jscript) return window.jscript.saveAutosave(state)
  const db=await openDB()
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(state,'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}
}
export async function saveBytes(name:string,data:Uint8Array):Promise<boolean>{
  if(window.jscript) return Boolean(await window.jscript.saveFile({name,data:Array.from(data)}))
  const url=URL.createObjectURL(new Blob([new Uint8Array(data)]));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true
}
