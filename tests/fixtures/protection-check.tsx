import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InlineSelectionToolbar} from '../../src/components/reader/InlineSelectionToolbar';
import '../../src/index.css';
function Test() {
 const [result,setResult]=useState('');
 function select() { const p=document.querySelector('[data-paragraph-index]')!;const r=document.createRange();r.setStart(p.firstChild!,0);r.setEnd(p.firstChild!,3);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(r); }
 function check() {
  const p=document.querySelector('[data-paragraph-index]')! as HTMLElement;
  const checks=[];
  for(const name of ['copy','cut','dragstart','contextmenu']) { const e=new Event(name,{bubbles:true,cancelable:true});p.dispatchEvent(e);checks.push(!e.defaultPrevented); }
  setResult(checks.every(Boolean)?'PASS: copy/cut/drag/context-menu are not blocked':'FAIL');
 }
 return <main className="p-6">
 <h1>Kiểm thử bản thảo giả</h1><p data-paragraph-index="0" data-original-text="Hắn nhìn nàng.">Hắn nhìn nàng.</p>
 <button onClick={select}>Bôi đen mẫu</button><button onClick={check}>Kiểm tra không chặn copy</button><p role="status">{result}</p>
 <InlineSelectionToolbar onOpenNote={r=>setResult(`Ghi chú: ${r.selectedText}`)}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Test/>);
