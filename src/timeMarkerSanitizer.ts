/** Remove only standalone internal history timestamp labels leaked into assistant text.
 * Never rewrite user messages or ordinary date/time mentions. Historical records
 * remain unchanged; callers sanitize only prompt copies and new model output.
 */
const LEAKED_TIME_LINE=/^[ \\t]*\\[消息发送时间：\\s*\\d{4}-\\d{1,2}-\\d{1,2},?\\s+\\d{1,2}:\\d{2}(?::\\d{2})?\\][ \\t]*(?:\\r?\\n|$)/gm;
export function stripLeakedTimeMarkers(text:string):string{
 return text.replace(LEAKED_TIME_LINE,'');
}
