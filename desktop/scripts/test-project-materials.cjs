"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WorkbenchDataBridge, inside, mediaType} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const truthFile = path.join(root, "references", "project-materials-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthFile, "utf8"));
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-project-materials-"));
const tenantRoot = id => path.join(testRoot, "tenants", id);
let activeTenant = truth.tenantA;
const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot(activeTenant)});
const checks = [];
function check(name, fn) { try { fn(); checks.push({name, ok:true}); } catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); } }
function rejects(name, fn, pattern) { check(name, () => { let error; try { fn(); } catch (value) { error=value; } assert(error, "预期操作应被拒绝"); assert.match(String(error.message || error), pattern); }); }

const first = bridge.bootstrap();
check("bootstrap creates one default project", () => assert.equal(first.projects.length, truth.expected.defaultProjects));
check("default current project is valid", () => assert(first.projects.some(item => item.id === first.currentProjectId && !item.deletedAt)));
const projectA = bridge.createProject({name:truth.projectNames[0], description:"角色与分镜生产"});
const projectB = bridge.createProject({name:truth.projectNames[1], description:"广告素材生产"});
check("project create count matches ground truth", () => assert.equal(bridge.bootstrap().projects.length, truth.expected.createdProjects));
check("new project becomes current", () => assert.equal(bridge.bootstrap().currentProjectId, projectB.id));
bridge.updateProject(projectA.id, {name:"国风短剧 V1", description:"已更新"});
check("project update persists", () => assert.equal(bridge.bootstrap().projects.find(item => item.id === projectA.id).name, "国风短剧 V1"));
bridge.updateProject(projectA.id, {archived:true});
check("project archive persists", () => assert(bridge.bootstrap().projects.find(item => item.id === projectA.id).archivedAt));
bridge.updateProject(projectA.id, {archived:false});
check("project unarchive persists", () => assert.equal(bridge.bootstrap().projects.find(item => item.id === projectA.id).archivedAt, null));

const sourceRoot = path.join(testRoot, "source"); fs.mkdirSync(sourceRoot, {recursive:true});
const png = path.join(sourceRoot, "character.png"); const text = path.join(sourceRoot, "script.md"); const exe = path.join(sourceRoot, "blocked.exe");
fs.writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex")); fs.writeFileSync(text, "# 第一集\n测试剧本", "utf8"); fs.writeFileSync(exe, "blocked", "utf8");
const importedA = bridge.importAssets({projectId:projectA.id, paths:[png]});
const importedB = bridge.importAssets({projectId:projectB.id, paths:[text]});
check("two assets imported", () => assert.equal(bridge.bootstrap().assets.length, truth.expected.importedAssets));
check("asset belongs to project A", () => assert.equal(bridge.listAssets({projectId:projectA.id}).length, truth.expected.projectAAssets));
check("asset belongs to project B", () => assert.equal(bridge.listAssets({projectId:projectB.id}).length, truth.expected.projectBAssets));
check("asset copied inside tenant materials", () => assert(inside(path.join(tenantRoot(truth.tenantA), "materials"), bridge.resolveAsset(importedA[0].id).path)));
check("supported type detection correct", () => { assert.equal(mediaType(png), "image"); assert.equal(mediaType(text), "text"); assert.equal(mediaType(exe), null); });
rejects("unsupported extension rejected", () => bridge.importAssets({projectId:projectA.id, paths:[exe]}), /不支持/);
rejects("archived project rejects imports", () => { bridge.updateProject(projectA.id,{archived:true}); try { bridge.importAssets({projectId:projectA.id,paths:[png]}); } finally { bridge.updateProject(projectA.id,{archived:false}); } }, /有效的归属项目/);

bridge.updateAsset(importedA[0].id, {name:"角色参考图", tags:"角色, 国风", notes:"女主角"});
check("asset metadata update persists", () => { const asset=bridge.bootstrap().assets.find(item=>item.id===importedA[0].id); assert.equal(asset.name,"角色参考图"); assert.deepEqual(asset.tags,["角色","国风"]); assert.equal(asset.notes,"女主角"); });
rejects("direct asset project reassignment is rejected", () => bridge.updateAsset(importedA[0].id, {projectId:projectB.id}), /复制到项目|新的 assetId/);
const copyResult=bridge.copyAssets({assetIds:[importedA[0].id],targetProjectId:projectB.id});const copiedAsset=copyResult.assets[0];
check("cross-project copy creates a new asset id", () => { assert(copyResult.mapping[0].copied);assert.notEqual(copiedAsset.id,importedA[0].id);assert.equal(copiedAsset.sourceAssetId,importedA[0].id);assert.equal(copiedAsset.sourceProjectId,projectA.id); });
check("cross-project copy preserves source and creates an independent file", () => { const source=bridge.resolveAsset(importedA[0].id),copy=bridge.resolveAsset(copiedAsset.id);assert.equal(source.projectId,projectA.id);assert.equal(copy.projectId,projectB.id);assert.notEqual(source.path,copy.path);assert(inside(path.join(tenantRoot(truth.tenantA),"materials",projectB.id),copy.path)); });
rejects("project with assets cannot be deleted", () => bridge.deleteProject(projectB.id), /仍有素材/);
bridge.deleteAsset(importedB[0].id);
check("asset soft delete persists", () => assert(bridge.bootstrap().assets.find(item=>item.id===importedB[0].id).deletedAt));
check("soft delete preserves original material file", () => assert(fs.existsSync(bridge.resolveAsset(importedB[0].id).path)));
bridge.restoreAsset(importedB[0].id);
check("asset restore persists", () => assert.equal(bridge.bootstrap().assets.find(item=>item.id===importedB[0].id).deletedAt,null));
bridge.createDraftTask({projectId:projectA.id,title:"素材引用删除测试",prompt:"测试引用保护",assetIds:[importedA[0].id]});
rejects("referenced asset cannot be deleted", () => bridge.deleteAsset(importedA[0].id), /引用.*不能删除/);

activeTenant = truth.tenantB;
const tenantBState = bridge.bootstrap();
check("tenant B has independent default project", () => assert.equal(tenantBState.projects.length, truth.expected.defaultProjects));
check("tenant B cannot list tenant A assets", () => assert.equal(tenantBState.assets.length, truth.expected.tenantBAssets));
rejects("tenant B cannot resolve tenant A asset id", () => bridge.resolveAsset(importedA[0].id), /不存在/);
activeTenant = truth.tenantA;
check("tenant A data remains intact after tenant switch", () => assert.equal(bridge.bootstrap().assets.length, truth.expected.assetsAfterCopy));
check("path traversal helper rejects sibling root", () => assert.equal(inside(path.join(testRoot,"tenant-a"),path.join(testRoot,"tenant-ab","file.png")),false));

const renderer = fs.readFileSync(path.join(root,"src","renderer","project-materials.js"),"utf8");
const preload = fs.readFileSync(path.join(root,"src","preload","preload.cjs"),"utf8");
const main = fs.readFileSync(path.join(root,"src","main","main.cjs"),"utf8");
const css = fs.readFileSync(path.join(root,"src","renderer","styles","project-materials.css"),"utf8");
check("renderer contains project and material pages", () => { assert(renderer.includes("项目管理")); assert(renderer.includes("素材中心")); assert(renderer.includes("previewAsset")); assert(renderer.includes("referenceAsset")); });
check("IPC allowlist covers project and asset operations", () => { for(const value of ["projects:create","projects:update","projects:delete","projects:restore","assets:pick-import","assets:update","assets:delete","assets:restore"]) { assert(main.includes(value),value); assert(preload.includes(value),value); } });
check("responsive styles avoid fixed horizontal layout", () => { assert(css.includes("auto-fill")); assert(css.includes("minmax")); assert(css.includes("@media(max-width:1100px)")); });
check("active asset card exposes visible delete quick action", () => { assert(renderer.includes("asset-quick-action delete")); assert(renderer.includes('data-asset-action="delete"')); });
check("recycle-bin asset card exposes restore quick action", () => { assert(renderer.includes("asset-quick-action restore")); assert(renderer.includes('data-asset-action="restore"')); });
check("delete requires confirmation before IPC", () => { assert(renderer.includes("confirmDialog(\"删除素材\"")); assert(renderer.includes("await api.assets.delete(id)")); });
check("backend blocks deletion of referenced assets", () => { assert(renderer.includes("assetUsage(asset)") && renderer.includes("usage.total")); assert(fs.readFileSync(path.join(root,"src","main","workbench-data-bridge.cjs"),"utf8").includes("素材正在被")); });

const failed = checks.filter(item => !item.ok);
const result = {test:"project-materials", timestamp:new Date().toISOString(), groundTruth:truthFile, tempRoot:testRoot, total:checks.length, passed:checks.length-failed.length, failed:failed.length, failures:failed, checks};
const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"project-materials.json"),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2)); if(failed.length)process.exit(1);
