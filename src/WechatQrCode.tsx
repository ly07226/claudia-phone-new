import React,{useMemo} from 'react';
import {qrcodegen} from './vendor/qrcodegen';

/** Locally rendered SVG QR; no remote QR service, npm package, or network requests. */
export function WechatQrCode({value,size=220,label='微信登录二维码'}:{value:string;size?:number;label?:string}){
 const qr=useMemo(()=>qrcodegen.QrCode.encodeText(value,qrcodegen.QrCode.Ecc.MEDIUM),[value]);
 const quiet=4;
 const total=qr.size+quiet*2;
 const cells:React.ReactNode[]=[];
 for(let y=0;y<qr.size;y++){
  for(let x=0;x<qr.size;x++){
   if(qr.getModule(x,y))cells.push(<rect key={y*qr.size+x} x={x+quiet} y={y+quiet} width="1" height="1"/>);
  }
 }
 return <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges" style={{display:'block',maxWidth:'100%',height:'auto',background:'#fff'}}>
  <rect width={total} height={total} fill="#fff"/>
  <g fill="#000">{cells}</g>
 </svg>;
}
