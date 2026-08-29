"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const {BrowserController, classifyDoubaoFailureMessage} = require("../src/main/browser-controller.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-browser-"));
const controller = new BrowserController({profileRootProvider: () => path.join(root, "tenant-a", "chrome-profiles"), testMode: true});
function messageNode({id, text, role = "assistant"}) {
  return {
    className: role === "user" ? "justify-end" : "",
    innerText: text,
    textContent: text,
    getBoundingClientRect: () => ({width: 100, height: 40}),
    getAttribute: name => name === "data-message-id" ? id : name === "data-role" ? role : "",
    querySelector: () => null,
  };
}
async function readStateWithMessages(messages) {
  const liveController = new BrowserController({profileRootProvider: () => path.join(root, "tenant-a", "chrome-profiles"), testMode: false});
  const rootNode = {
    innerText: messages.map(node => node.innerText).join(" "),
    textContent: messages.map(node => node.textContent).join(" "),
    getBoundingClientRect: () => ({width: 800, height: 600}),
    querySelectorAll: selector => selector === "[data-message-id]" ? messages : [],
  };
  liveController.evaluate = async (_session, expression) => vm.runInNewContext(expression, {
    location: {pathname: "/chat/38438020201933314", href: "https://www.doubao.com/chat/38438020201933314"},
    document: {
      body: rootNode,
      querySelector: selector => selector === "main" ? rootNode : null,
      querySelectorAll: selector => selector.includes("message-list") ? [rootNode] : [],
    },
    getComputedStyle: () => ({display: "block", visibility: "visible", position: "static"}),
  });
  return liveController.readSubmissionState({}, "当前任务提示词", "expected-user-message", "38438020201933314", "2026-08-17T08:42:34.000Z");
}
(async () => {
  const paused = await controller.execute({id: "cmd-1", action: "generate", account: {id: "account-a", platform: "豆包"}, payload: {prompt: "会飞的气球", simulateVerification: true}});
  assert.equal(paused.paused, true); assert.equal(paused.verificationRequired, true);
  const resumed = await controller.execute({id: "cmd-2", action: "resume", account: {id: "account-a", platform: "豆包"}, payload: {prompt: "会飞的气球"}});
  assert.equal(resumed.resumed, true); assert.equal(resumed.generating, true);
  const unknownTerminal = classifyDoubaoFailureMessage("这次没有生成出来，你可以修改描述后重新生成。");
  assert.equal(unknownTerminal.providerTerminal, true); assert.equal(unknownTerminal.code, "DOUBAO_TERMINAL_UNRECOGNIZED");
  const unrenderedPromptFailure = await readStateWithMessages([messageNode({id: "assistant-failure", text: "这次没有生成出来，请修改后重试。"})]);
  assert.equal(unrenderedPromptFailure.providerTerminal, true);
  const unrelatedFailure = await readStateWithMessages([messageNode({id: "other-user", text: "另一个任务", role: "user"}), messageNode({id: "assistant-failure", text: "这次没有生成出来，请修改后重试。"})]);
  assert.equal(unrelatedFailure.providerTerminal, false);
  const liveController = new BrowserController({profileRootProvider: () => path.join(root, "tenant-a", "chrome-profiles"), testMode: false});
  const liveSession = {phase: "generating", conversationId: "38438020201933314", captures: [], consumedCaptures: new Set()};
  let restoreCalls = 0;
  liveController.open = async () => liveSession;
  liveController.connect = async () => ({});
  liveController.detect = async () => ({loggedIn: true});
  liveController.restoreConversation = async () => { restoreCalls += 1; return {restored: true}; };
  liveController.readSubmissionState = async () => ({...unknownTerminal, conversationId: liveSession.conversationId, conversationMatches: true, userMessage: true, promptPresentInCurrentConversation: true});
  const liveFailure = await liveController.runGeneration({id: "cmd-live", action: "monitor", account: {id: "account-live", platform: "豆包"}, payload: {jobId: "task-live", prompt: "午夜房间里的男孩", conversationId: liveSession.conversationId, submittedAt: new Date().toISOString()}});
  assert.equal(liveFailure.ok, false); assert.equal(liveFailure.providerTerminal, true); assert.equal(restoreCalls, 0);
  assert.ok(fs.existsSync(path.join(root, "tenant-a", "chrome-profiles", "account_account-a")));
  controller.closeAll();
  liveController.closeAll();
  console.log(JSON.stringify({test: "browser-generation", passed: 13, failed: 0, root}));
})().catch(error => { console.error(error); process.exit(1); });
