/** Synthetic model metadata tied to the summary fixture's first assistant turn. */
export const preferenceFact=(content='角色明确表达喜欢画展。')=>({type:'fact',content,quality:{category:'preference',importance:'high',durability:'lasting',impact:'后续选择共同活动时可持续参考这个偏好',evidence:[{turn:1,role:'assistant',quote:'我喜欢画展'}]}});
export const routinePlan=()=>({type:'pending',content:'双方约定周末看展，目前尚未完成。',quality:{category:'short-plan',importance:'low',durability:'temporary',impact:'',evidence:[{turn:1,role:'user',quote:'我们约定周末看展览'}]}});
