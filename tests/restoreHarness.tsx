import {createRoot} from 'react-dom/client';
import {RestoreActions} from '../src/RestoreActions';
import type Dexie from 'dexie';
import type {IntegrityReport} from '../src/backupService';
export function mountRestore(files:File[],report:IntegrityReport,database:Dexie){
  const element=document.createElement('div');element.id='isolated-restore-test';element.className='space-selection';Object.assign(element.style,{position:'fixed',inset:'0',zIndex:'9000',overflow:'auto'});document.body.append(element);const shell=document.createElement('div');shell.className='space-select-shell backup-page backup-simple';element.append(shell);const root=createRoot(shell);
  root.render(<RestoreActions files={files} report={report} database={database}/>);return ()=>root.unmount();
}
