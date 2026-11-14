import {cloudConfigured,cloudFunctionRequest} from './cloudIdentity';
import {useEffect,useState} from 'react';

type PushState='checking'|'unsupported'|'not-installed'|'denied'|'unconfigured'|'unsubscribed'|'subscribed'|'error';
const publicKey=(import.meta.env.VITE_PUSH_PUBLIC_KEY as string|undefined)?.trim()??'';

async function registerRemote(subscription:PushSubscription){
 await cloudFunctionRequest('claudia-push-subscriptions','POST',{subscription:subscription.toJSON()});
}

function decodeKey(key:string){const padded=key.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(key.length/4)*4,'=');const raw=atob(padded);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
function needsInstall(){return isIOS()&&!installed();}
function installed(){return window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;}
export function PushNotificationSettings(){
 const [state,setState]=useState<PushState>('checking');
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [testBusy,setTestBusy]=useState(false);
 const [localPermission,setLocalPermission]=useState(()=>typeof Notification==='undefined'?'unsupported':Notification.permission);
 async function inspect(){
  if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){setState('unsupported');return;}
  setLocalPermission(Notification.permission);
  if(needsInstall()){setState('not-installed');return;}
  if(Notification.permission==='denied'){setState('denied');return;}
  try{
   const registration=await navigator.serviceWorker.getRegistration();
   const subscription=registration?await registration.pushManager.getSubscription():null;
   // A local PushSubscription does not prove server registration after a reload.
   setState(publicKey&&cloudConfigured()?'unsubscribed':'unconfigured');
   if(subscription&&publicKey&&cloudConfigured())setMessage('发现本机已有订阅；请点击开启系统通知以重新向服务端登记。');
  }catch(e){setState('error');setMessage(e instanceof Error?e.message:'无法读取推送订阅状态');}
 }
 useEffect(()=>{void inspect();},[]);
 async function subscribe(){
  if(busy)return;setBusy(true);setMessage('');
  try{
   if(needsInstall())throw Error('iPhone/iPad 请先将小手机添加到主屏幕，再从桌面图标打开。');
   if(!publicKey||!cloudConfigured())throw Error('推送服务器尚未配置，无法创建可用订阅。');
   const permission=await Notification.requestPermission();
   if(permission!=='granted'){await inspect();return;}
   const registration=await navigator.serviceWorker.ready;
   const existing=await registration.pushManager.getSubscription();
   const subscription=existing??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(publicKey) as BufferSource});
   await registerRemote(subscription);
   setState('subscribed');
   setMessage('设备订阅已提交到服务器；请通过远程推送测试确认实际投递。');
  }catch(e){setState('error');setMessage(e instanceof Error?e.message:'推送订阅失败');}
  finally{setBusy(false);}
 }
 async function testLocalNotification(){
  if(testBusy)return;setTestBusy(true);setMessage('');
  try{
   if(!('Notification'in window)||!('serviceWorker'in navigator))throw Error('当前环境不支持系统通知。');
   if(needsInstall())throw Error('iPhone/iPad 请从主屏幕的小手机图标打开后测试。');
   const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
   setLocalPermission(permission);
   if(permission!=='granted')throw Error('没有取得通知权限。');
   const registration=await navigator.serviceWorker.ready;
   await registration.showNotification('Claudia Phone · 通知测试',{body:'这是一条本机测试通知，不代表后台 AI 或远程推送已经接通。',tag:'claudia-local-test',icon:'/apple-icon.png?v=2'});
   setMessage('已向系统提交本机测试通知；是否显示横幅取决于设备和系统通知设置。');
  }catch(e){setMessage(e instanceof Error?e.message:'本机通知测试失败。');}
  finally{setTestBusy(false);}
 }
 async function enableLocalNotifications(){
  if(testBusy)return;setTestBusy(true);setMessage('');
  try{
   if(!('Notification'in window)||!('serviceWorker'in navigator))throw Error('当前环境不支持本机系统通知。');
   if(needsInstall())throw Error('iPhone/iPad 请先添加到主屏幕并从桌面图标打开。');
   const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
   setLocalPermission(permission);
   if(permission!=='granted')throw Error('系统通知未授权，请在系统设置中允许通知。');
   await navigator.serviceWorker.ready;
   setMessage('本机回复完成通知已授权。只要后台网页仍在运行并完成回复，就会尝试发送通知；不需要 Supabase。');
  }catch(e){setMessage(e instanceof Error?e.message:'本机通知授权失败。');}
  finally{setTestBusy(false);}
 }
 async function unsubscribe(){
  setBusy(true);setMessage('');
  try{const registration=await navigator.serviceWorker.getRegistration();const sub=await registration?.pushManager.getSubscription();if(sub){await cloudFunctionRequest('claudia-push-subscriptions','DELETE',{endpoint:sub.endpoint});await sub.unsubscribe();}await inspect();setMessage('已取消本机与服务端的推送订阅。');}
  catch(e){setState('error');setMessage(e instanceof Error?e.message:'取消失败');}
  finally{setBusy(false);}
 }
 const descriptions:Record<PushState,string>={
  checking:'正在检查设备通知能力…',unsupported:'当前浏览器不支持网页推送。', 'not-installed':'iPhone/iPad 需要先添加到主屏幕，并从桌面图标打开。',denied:'系统已拒绝通知权限，请在设备的应用或浏览器通知设置中修改。',unconfigured:'推送服务尚未配置，暂时不能订阅。',unsubscribed:'设备支持推送，可以申请通知权限。',subscribed:'当前会话已收到服务端登记成功响应；远程投递仍需测试。',error:'检查或订阅失败。'};
 return <section className="card form" aria-label="消息通知">
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
   <div><h3 style={{margin:0}}>消息通知</h3><p className="hint" style={{margin:'6px 0 0'}}>后台收到角色回复时提醒</p></div>
   <button type="button" onClick={()=>void enableLocalNotifications()} disabled={testBusy||localPermission==='granted'||localPermission==='unsupported'||localPermission==='denied'} aria-label="开启消息通知" style={{flexShrink:0,border:'1px solid var(--border, #cbd5df)',borderRadius:999,padding:'9px 14px',background:localPermission==='granted'?'#dcefe5':'transparent',color:'inherit',font:'inherit'}}>
    {testBusy?'授权中…':localPermission==='granted'?'已开启':localPermission==='denied'?'已拒绝':localPermission==='unsupported'?'不支持':'开启'}
   </button>
  </div>
  {message&&<p role="status" className="hint" style={{margin:'8px 0 0'}}>{message}</p>}
 </section>;
}
