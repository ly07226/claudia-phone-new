import {StickerPanel} from './StickerPanel';
import {Camera,Image as ImageIcon,File,Smile} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {db} from './store';
import type {Conversation} from './chatTypes';
import {attachmentError,prepareImage,imageLimits} from './imageAttachments';
import {createPortal} from 'react-dom';
import './imageAttachments.css';
export function useImageDraft(c:Conversation|null,text:string|(()=>string),setText:(text:string)=>void,onError:(error:string)=>void){
 const [notice,setNotice]=useState('');
 const [ids,setIds]=useState<string[]>([]),[ready,setReady]=useState(false),[processing,setProcessing]=useState(false);
 const scope=JSON.stringify([c?.id,c?.activeTimelineId,c?.timelineEpoch]),latest=useRef(scope);latest.current=scope;
 const current=useRef(c);current.current=c;
 const caption=useRef(text);caption.current=text;
 const currentCaption=()=>typeof caption.current==='function'?caption.current():caption.current;
 const prior=useRef<Conversation|null>(null);
 useEffect(()=>{let alive=true;const rootInit=prior.current?.id===c?.id&&!prior.current?.activeTimelineId&&!!c?.activeTimelineId&&(prior.current?.timelineEpoch??0)===(c?.timelineEpoch??0);prior.current=c;setReady(false);if(ids.length&&!rootInit)setText('');setIds([]);if(c)void db.conversations.get(c.id).then(row=>{if(!alive)return;const draft=row?.imageDrafts?.[c.activeTimelineId||''];if(draft&&draft.epoch===(c.timelineEpoch??0)){setIds(draft.assetIds);if(!currentCaption()||(ids.length&&!rootInit))setText(draft.text);}setReady(true);}).catch(e=>{if(alive)onError(attachmentError(e));});return()=>{alive=false;};},[scope]);
 const persist=async(assetIds:string[],text:string,assets:Awaited<ReturnType<typeof prepareImage>>[]=[])=>{
  const original=current.current;if(!original)return;
  await db.transaction('rw',[db.conversations,db.assets],async()=>{
   const row=await db.conversations.get(original.id);if(!row||row.activeTimelineId!==original.activeTimelineId||(row.timelineEpoch??0)!==(original.timelineEpoch??0))throw Error('会话或分支已切换，未把附件写入其他聊天。');
   for(const {notice,...asset} of assets)await db.assets.add(asset);
   const drafts={...row.imageDrafts};const key=original.activeTimelineId||'';
   if(assetIds.length)drafts[key]={assetIds,text,epoch:row.timelineEpoch??0};else delete drafts[key];
   await db.conversations.update(row.id,{imageDrafts:drafts});
  });
 };
 return {ids,ready,processing,notice,caption:(text:string)=>{if(ready&&ids.length)void persist(ids,text).catch(e=>onError(attachmentError(e)));},remove:async(id:string,text:string)=>{const originalScope=latest.current;const next=ids.filter(x=>x!==id);setIds(next);try{await persist(next,text);}catch(e){if(originalScope===latest.current)setIds(ids);onError(attachmentError(e));}},clear:()=>{if(scope===latest.current)setIds([])},choose:async(files:FileList|null,text:string,selectionScope:string)=>{
  if(!files?.length)return;if(processing||!ready)return;if(selectionScope!==latest.current){onError('聊天已切换，请在当前聊天重新选择图片。');return;}
  if(files.length+ids.length>imageLimits.count){onError('每条消息最多3张图片，请移除后重试。');return;}
  setProcessing(true);try{const prepared=[];for(const file of Array.from(files))prepared.push(await prepareImage(file));if(selectionScope!==latest.current)throw Error('聊天或分支已切换，未添加图片。');const next=[...ids,...prepared.map(a=>a.id)];const selectedCaption=currentCaption();await persist(next,selectedCaption,prepared);if(selectionScope!==latest.current)return;setIds(next);if(currentCaption()!==selectedCaption)await persist(next,currentCaption());const notes=prepared.map(a=>a.notice).filter(Boolean);setNotice(notes.join(' '));}catch(e){onError(attachmentError(e));}finally{setProcessing(false);}
 },scope};
}
export function StoredImage({id,onOpen}:{id:string;onOpen?:(src:string)=>void}){
 const [src,setSrc]=useState(''),[failed,setFailed]=useState(false);
 useEffect(()=>{let alive=true;setFailed(false);setSrc('');void db.assets.get(id).then(a=>{if(alive){if(a?.type==='chat-image'&&/^data:image\/(jpeg|png|webp);base64,/.test(a.data))setSrc(a.data);else setFailed(true);}}).catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};},[id]);
 if(failed)return <span className="chat-image-missing">图片无法加载</span>;
 if(!src)return <span className="chat-image-missing">读取图片中…</span>;
 return <img role={onOpen?"button":undefined} tabIndex={onOpen?0:undefined} aria-label={onOpen?"查看聊天图片":undefined} onKeyDown={onOpen?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onOpen(src);}}:undefined} className="chat-attachment-thumb" src={src} alt="聊天图片" onError={()=>setFailed(true)} onClick={onOpen?e=>{e.stopPropagation();onOpen(src);}:undefined}/>;
}
export function MessageImages({ids}:{ids:string[]}){
 const [full,setFull]=useState<string|null>(null),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(full)dialog.current?.showModal();},[full]);
 return <><div className="chat-message-images">{ids.map(id=><div key={id} data-bubble-key={`image:${id}`}><StoredImage id={id} onOpen={setFull}/></div>)}</div>{full&&createPortal(<dialog ref={dialog} className="chat-image-viewer" aria-label="聊天图片大图" onClose={()=>setFull(null)} onClick={e=>{if(e.target===e.currentTarget){dialog.current?.close();setFull(null);}}}><button type="button" onClick={()=>{dialog.current?.close();setFull(null);}} aria-label="关闭图片大图">×</button><img src={full} alt="聊天图片大图"/></dialog>,document.body)}</>;
}
export type ChatBottomPanel = 'none'|'stickers'|'actions';
export function AttachmentMenu({toolbar=false,onStickerSelect,disabled,processing,scope,onChoose,onOpenChange,onSyncQq,qqSyncEnabled=false,qqSyncBusy=false,panel='none',onPanelChange}:{toolbar?:boolean;onStickerSelect?:(sticker:import('./stickerLibrary').Sticker)=>void;disabled:boolean;processing:boolean;scope:string;onChoose:(files:FileList|null,scope:string)=>void;onOpenChange:(open:boolean)=>void;onSyncQq?:()=>void;qqSyncEnabled?:boolean;qqSyncBusy?:boolean;panel?:ChatBottomPanel;onPanelChange?:(panel:ChatBottomPanel)=>void}){
 const album=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null),files=useRef<HTMLInputElement>(null),selection=useRef(scope);
 const setPanel=(next:ChatBottomPanel)=>{onPanelChange?.(next);onOpenChange(next!=='none');};
 const pick=(ref:typeof album)=>{selection.current=scope;setPanel('none');ref.current?.click();};
 useEffect(()=>{setPanel('none');},[scope]);
 const toggle=(next:ChatBottomPanel)=>{if(next!=='none'&&document.activeElement instanceof HTMLElement)document.activeElement.blur();setPanel(panel===next?'none':next);};
 return <div className={`chat-attachment-control ${toolbar?"chat-attachment-toolbar":""}`}>
  <button type="button" aria-label="更多功能" aria-expanded={panel==='actions'} disabled={disabled||processing} onPointerDown={e=>e.preventDefault()} onClick={()=>toggle('actions')}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{transform:panel==='actions'?'rotate(45deg)':undefined}}><path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
  {toolbar&&<><button type="button" aria-label="拍照" disabled={disabled||processing} onClick={()=>pick(camera)}><Camera size={22}/></button><button type="button" aria-label="相册" disabled={disabled||processing} onClick={()=>pick(album)}><ImageIcon size={22}/></button><button type="button" aria-label="表情包" aria-expanded={panel==='stickers'} onPointerDown={e=>e.preventDefault()} onClick={()=>toggle('stickers')}><Smile size={22}/></button><button type="button" aria-label="文件" disabled={disabled||processing} onClick={()=>pick(files)}><File size={22}/></button></>}
  {[[album,false],[camera,true],[files,false]].map(([ref,capture],i)=><input key={i} ref={ref as typeof album} aria-label={['相册图片','拍照图片','文件图片'][i]} type="file" accept="image/jpeg,image/png,image/webp" capture={capture?'environment':undefined} multiple={!capture} hidden onChange={e=>{onChoose(e.currentTarget.files,selection.current);e.currentTarget.value='';}}/>)}
 </div>;
}
export function ChatExpandedPanel({panel,onClose,onStickerSelect,onSyncQq,qqSyncEnabled=false,qqSyncBusy=false}:{panel:ChatBottomPanel;onClose:()=>void;onStickerSelect?:(sticker:import('./stickerLibrary').Sticker)=>void;onSyncQq?:()=>void;qqSyncEnabled?:boolean;qqSyncBusy?:boolean}){
 if(panel==='none')return null;
 return <div className="chat-bottom-panel" aria-label={panel==='stickers'?'表情包面板':'更多功能面板'}>
  {panel==='stickers'?<StickerPanel onClose={onClose} onSelect={onStickerSelect}/>:<div className="chat-actions-grid">
   <button type="button" disabled={!qqSyncEnabled||qqSyncBusy} onClick={()=>{onSyncQq?.();onClose()}}><span className="chat-action-tile">QQ</span><span>{qqSyncBusy?'同步中…':'导入 QQ'}</span></button>
   <div className="chat-action-placeholder"><span className="chat-action-tile">🛍️</span><span>点外卖</span></div>
   <div className="chat-action-placeholder"><span className="chat-action-tile">📱</span><span>查手机</span></div>
   <div className="chat-action-placeholder"><span className="chat-action-tile">♫</span><span>听歌</span></div>
  </div>}
 </div>;
}
