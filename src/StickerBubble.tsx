import {useEffect,useState} from 'react';
import {getSticker} from './stickerLibrary';
import './stickerBubble.css';
export function StickerBubble({id,label}:{id:string;label:string}){
 const [state,setState]=useState<{id:string;data?:string;failed?:boolean}|null>(null);
 useEffect(()=>{let alive=true;getSticker(id).then(r=>{if(alive)setState({id,data:r?.data,failed:!r})}).catch(()=>{if(alive)setState({id,failed:true})});return()=>{alive=false}},[id]);
 if(state?.id!==id)return <span className="sticker-bubble-placeholder">读取表情包…</span>;
 if(state.failed||!state.data||!/^data:image\/(png|jpeg|gif|webp);base64,/.test(state.data))return <span className="sticker-bubble-placeholder">[表情包：{label}]</span>;
 return <img className="chat-sticker-image" src={state.data} alt={label} loading="lazy" decoding="async" onError={()=>setState({id,failed:true})}/>;
}
