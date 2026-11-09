/** Display-only; the original persisted timestamp is never changed. */
export function formatMomentTime(createdAt:number,now=Date.now()){
 const date=new Date(createdAt);if(!Number.isFinite(date.getTime()))return '日期未知';
 const elapsed=now-createdAt;if(elapsed>=0&&elapsed<60000)return '刚刚';
 if(elapsed>=0&&elapsed<3600000)return Math.floor(elapsed/60000)+'分钟前';
 if(elapsed>=0&&elapsed<86400000)return Math.floor(elapsed/3600000)+'小时前';
 return (date.getFullYear()===new Date(now).getFullYear()?'':date.getFullYear()+'/')+(date.getMonth()+1)+'/'+date.getDate();
}
