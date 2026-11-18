import type {Message} from './chatTypes';
/** Ephemeral proof attached to an already validated request snapshot. Never persisted. */
export interface PathProvenance {conversationId:string;timelineId:string;epoch:number;head?:string;nodeIds:readonly string[];fingerprints:readonly string[]}
const proofs=new WeakMap<readonly Message[],PathProvenance>();
export const pathProvenance=(rows:readonly Message[])=>proofs.get(rows);
export function rememberPath(rows:readonly Message[],proof:PathProvenance){Object.freeze(proof.nodeIds);Object.freeze(proof.fingerprints);proofs.set(rows,Object.freeze(proof));}
