import {db,defaultTheme} from './store';
export async function saveChatBanner(enabled:boolean){await db.transaction('rw',db.themes,async()=>{const theme=await db.themes.get('global');await db.themes.put({...defaultTheme,...theme,id:'global',chatMessageBanners:enabled});});}
