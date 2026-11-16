/** Measured group heights; no message text, DOM, storage limit or fixed row height. */
export class HistoryLayout{
 readonly positions:Map<string,number>;private tree:Float64Array;private heights:Float64Array;
 constructor(readonly ids:string[],measured:Map<string,number>){this.positions=new Map(ids.map((id,i)=>[id,i]));this.tree=new Float64Array(ids.length+1);this.heights=Float64Array.from(ids,id=>measured.get(id)??100);for(let i=1;i<this.tree.length;i++){this.tree[i]+=this.heights[i-1];const parent=i+(i&-i);if(parent<this.tree.length)this.tree[parent]+=this.tree[i];}}
 offset(end:number){let sum=0;for(let i=Math.min(end,this.ids.length);i>0;i-=i&-i)sum+=this.tree[i];return sum;}
 measure(index:number,height:number){if(!Number.isFinite(height)||height<=0||index<0||index>=this.ids.length)return;const delta=height-this.heights[index];if(Math.abs(delta)<.25)return;this.heights[index]=height;for(let i=index+1;i<this.tree.length;i+=i&-i)this.tree[i]+=delta;}
 indexAt(offset:number){let index=0,sum=0,bit=1;while(bit*2<this.tree.length)bit*=2;for(;bit;bit>>=1){const next=index+bit;if(next<this.tree.length&&sum+this.tree[next]<=offset){sum+=this.tree[next];index=next;}}return Math.min(index,Math.max(0,this.ids.length-1));}
}
