/** Plain persisted values only; preserves missing keys and never serializes message bodies. */
export function dataEqual(a:unknown,b:unknown):boolean{
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=Object.keys(a),right=Object.keys(b);return left.length===right.length&&left.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&dataEqual((a as any)[k],(b as any)[k]));
}
