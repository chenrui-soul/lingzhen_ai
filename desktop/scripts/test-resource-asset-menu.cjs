const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"src/renderer/project-materials.js"),"utf8");
const truth=JSON.parse(fs.readFileSync(path.join(root,"references/resource-asset-menu-ground-truth.json"),"utf8"));
const checks=[];
const check=(name,ok,detail=null)=>checks.push({name,ok:Boolean(ok),detail:ok?null:detail});

check("同一时间最多展开一个素材操作菜单",truth.maximumOpenMenus===1&&source.includes("closeAssetActionMenus(workspace,menu)"));
check("点击菜单外部自动收起",truth.closeOnOutsideClick&&source.includes('if(!event.target.closest(".asset-action-menu"))closeAssetActionMenus(workspace)'));
check("执行菜单操作后自动收起",truth.closeOnAction&&source.includes('menu.querySelector(".asset-actions")?.addEventListener("click",()=>{menu.open=false}'));
check("Esc 收起并恢复焦点",truth.closeOnEscape&&truth.restoreFocusOnEscape&&source.includes('event.key!=="Escape"')&&source.includes('querySelector(":scope > summary")?.focus'));
check("菜单展开状态同步给辅助技术",truth.ariaExpandedTracksState&&source.includes('summary.setAttribute("aria-expanded",String(menu.open))'));
check("重复渲染不会叠加菜单监听器",truth.eventListenersBoundOnce&&source.includes("workspace.assetActionMenuAbortController?.abort()")&&source.includes("signal:controller.signal"));

const result={test:"resource-asset-action-menu",timestamp:new Date().toISOString(),groundTruth:truth,total:checks.length,passed:checks.filter(item=>item.ok).length,failed:checks.filter(item=>!item.ok).length,checks};
const logDir=path.join(root,"scripts/log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"resource-asset-menu.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
if(result.failed)process.exitCode=1;
