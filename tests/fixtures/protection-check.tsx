import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InlineSelectionToolbar} from '../../src/components/reader/InlineSelectionToolbar';
import {blockManuscriptTransfer, isWritableField} from '../../src/components/reader/contentProtection';
import '../../src/index.css';
function Test() {
 const [result,setResult]=useState('');
 function select() { const p=document.querySelector('[data-paragraph-index]')!;const r=document.createRange();r.setStart(p.firstChild!,0);r.setEnd(p.firstChild!,3);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(r); }
 function check() {
  const p=document.querySelector('[data-paragraph-index]')!,input=document.querySelector('textarea')!,readonly=document.querySelector('input')!;
  const checks=[];
  for(const name of ['copy','cut','dragstart','contextmenu']) { const e=new Event(name,{bubbles:true,cancelable:true});p.dispatchEvent(e);checks.push(e.defaultPrevented);const edit=new Event(name,{bubbles:true,cancelable:true});input.dispatchEvent(edit);checks.push(!edit.defaultPrevented); }
  checks.push(!isWritableField(readonly));let blocked=false;blockManuscriptTransfer({target:p,preventDefault:()=>{blocked=true}},false);checks.push(!blocked);
  setResult(checks.every(Boolean)?'PASS: manuscript blocked, editable text allowed, Admin unchanged':'FAIL');
 }
 return <main className="p-6" onCopy={e=>blockManuscriptTransfer(e,true)} onCut={e=>blockManuscriptTransfer(e,true)} onDragStart={e=>blockManuscriptTransfer(e,true)} onContextMenu={e=>blockManuscriptTransfer(e,true)}>
 <h1>Kiểm thử bản thảo giả</h1><p data-paragraph-index="0" data-original-text="Hắn nhìn nàng.">Hắn nhìn nàng.</p>
 <textarea aria-label="Đề xuất" defaultValue="Nội dung tự nhập"/><input readOnly value="Nguyên tác" aria-label="Nguyên tác"/>
 <button onClick={select}>Bôi đen mẫu</button><button onClick={check}>Kiểm tra bảo vệ</button><p role="status">{result}</p>
 <InlineSelectionToolbar onOpenEdit={r=>setResult(`Sửa: ${r.selectedText}, ${r.startOffset}-${r.endOffset}`)} onOpenNote={r=>setResult(`Ghi chú: ${r.selectedText}`)}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Test/>);
