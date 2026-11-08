import {storyStageLabels,type StoryFailure} from './storyFailure';
import './storyFailure.css';
export function StoryFailureDetails({failure}:{failure:StoryFailure}){
 return <details className="story-failure-details"><summary>查看错误详情</summary><dl>
  <dt>请求阶段</dt><dd>{storyStageLabels[failure.stage]}</dd><dt>错误代码</dt><dd>{failure.code}</dd>
  <dt>请求状态</dt><dd>{failure.attempted?'已尝试发送；是否收到或计费以服务商记录为准':'未尝试发送模型请求'}</dd>
  {failure.httpStatus!==undefined&&<><dt>HTTP 状态</dt><dd>{failure.httpStatus}</dd></>}
  {failure.serviceCode&&<><dt>服务商代码</dt><dd>{failure.serviceCode}</dd></>}
  {failure.finishReason&&<><dt>结束标记</dt><dd>{failure.finishReason}</dd></>}
  {failure.responseCharacters!==undefined&&<><dt>返回内容字符数</dt><dd>{failure.responseCharacters}</dd></>}
  {failure.choiceCount!==undefined&&<><dt>识别到选项数</dt><dd>{failure.choiceCount}</dd></>}
  {failure.outputTokenLimit!==undefined&&<><dt>本次输出 Token 上限</dt><dd>{failure.outputTokenLimit}</dd></>}
 </dl></details>;
}
