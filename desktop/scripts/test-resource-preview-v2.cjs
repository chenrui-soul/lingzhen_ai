const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"src/renderer/project-materials.js"),"utf8");
const css=fs.readFileSync(path.join(root,"src/renderer/styles/project-materials.css"),"utf8");
const truth=JSON.parse(fs.readFileSync(path.join(root,"references/resource-preview-v2-ground-truth.json"),"utf8"));
const compactCss=css.replace(/\s+/g,"");
const checks=[];const check=(name,ok,detail=null)=>checks.push({name,ok:Boolean(ok),detail:ok?null:detail});

check("图片视频音频文本使用统一预览结构",truth.unifiedTypes.every(type=>css.includes(`preview-kind-${type}`))&&source.includes("pm-preview-content")&&source.includes("pm-preview-actions"));
check("预览窗口不再允许拖拽变形",truth.resizable===false&&compactCss.includes(".preview-modal.pm-dialog")&&compactCss.includes("resize:none"));
check("关闭按钮使用弹窗级事件委托",truth.closeUsesDelegation&&source.includes('event.target.closest("[data-modal-close]")'));
check("按钮遮罩和 Esc 均支持关闭",truth.closeMethods.every(method=>method==="escape"?source.includes('event.key==="Escape"'):source.includes("data-modal-close")));
check("预览顶部与底部都提供关闭入口",source.includes('class="pm-preview-close"')&&source.includes('data-modal-close>关闭预览'));
check("关闭后恢复原焦点",truth.focusRestored&&source.includes("returnFocus.focus({preventScroll:true})"));
check("文本预览读取真实内容",truth.textShowsContent&&source.includes("api.assets.preview(asset.id)")&&source.includes("result.text"));
check("关闭预览时停止音视频",truth.mediaStopsOnClose&&source.includes('host.querySelectorAll("video,audio")')&&source.includes("media.pause()"));

const report={test:"resource-preview-v2",timestamp:new Date().toISOString(),groundTruth:truth,total:checks.length,passed:checks.filter(item=>item.ok).length,failed:checks.filter(item=>!item.ok).length,checks};
const logDir=path.join(root,"scripts/log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"resource-preview-v2.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
