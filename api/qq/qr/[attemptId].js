import {handleQr} from './_shared.js';
export default async function handler(req,res){const id=typeof req.query.attemptId==='string'?req.query.attemptId:'';return handleQr(req,res,id);}
