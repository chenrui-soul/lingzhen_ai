(function canvasInputAdapterFactory(root, factory) {
  const api = factory(root?.LingframeCanvasCore || null);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LingframeCanvasInputAdapter = api;
})(typeof window !== "undefined" ? window : globalThis, function buildCanvasInputAdapter(core) {
  "use strict";

  const TEXT_KEYS = ["content", "text", "prompt", "value", "description", "summary", "result"];
  const RUNTIME_KEYS = new Set(["status", "progress", "runError", "updatedAt", "results", "activeResultId", "lastInputFingerprint", "phase", "completedAt", "startedAt"]);
  const normalizeText = (value, max = 30000) => String(value ?? "").trim().slice(0, max);
  const clone = value => {
    if (core?.clone) return core.clone(value);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  };
  const nodeMeta = type => core?.nodeMeta?.(type) || {inputTypes:[], outputTypes:[]};
  const fingerprintValue = value => {
    if (core?.fingerprintValue) return core.fingerprintValue(value);
    const text = JSON.stringify(value ?? null);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };

  function businessText(value, depth = 0) {
    if (value === undefined || value === null || depth > 3) return "";
    if (["string", "number", "boolean"].includes(typeof value)) return normalizeText(value);
    if (Array.isArray(value)) return normalizeText(value.map(item => businessText(item, depth + 1)).filter(Boolean).join("\n"));
    if (typeof value !== "object") return "";
    const parts = [];
    for (const key of TEXT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const valueText = businessText(value[key], depth + 1);
      if (valueText && !parts.includes(valueText)) parts.push(valueText);
    }
    return normalizeText(parts.join("\n"));
  }

  function extractBusinessText(node) {
    const data = node?.data || {};
    return businessText(data.output) || businessText(data.content) || businessText(data.instruction);
  }

  function extractAssetBindings(node) {
    const data = node?.data || {};
    const refs = data.refs && typeof data.refs === "object" ? data.refs : {};
    const output = data.output && typeof data.output === "object" ? data.output : {};
    const ids = [
      ...(Array.isArray(refs.assetIds) ? refs.assetIds : []),
      output.assetId,
      ...(Array.isArray(output.assetIds) ? output.assetIds : [])
    ].filter(Boolean).map(String);
    const assetRoles = refs.assetRoles && typeof refs.assetRoles === "object" ? refs.assetRoles : {};
    return [...new Set(ids)].map((assetId, index) => ({
      assetId,
      order: index,
      role: String(assetRoles[assetId] || ""),
      sourceNodeId: String(node?.id || ""),
      sourceKind: String(data.kind || node?.type || "")
    }));
  }

  function fallbackSnapshot(node, bindingId, role = "") {
    const text = extractBusinessText(node);
    const assets = extractAssetBindings(node);
    const captured = Boolean(text || assets.length);
    const sourceOutputFingerprint = captured ? fingerprintValue({text, assets:assets.map(item => item.assetId)}) : "";
    return {
      version:1,
      importMode:"once",
      state:captured ? "captured" : "pending",
      sourceNodeId:String(node?.id || ""),
      sourceOutputFingerprint,
      importedAt:captured ? new Date().toISOString() : "",
      textBlocks:text ? [{id:`${bindingId}:text:0`,text,originalFingerprint:fingerprintValue(text),enabled:true,edited:false}] : [],
      assetBindings:assets.map((asset, index) => ({id:`${bindingId}:asset:${index}`,assetId:asset.assetId,mediaType:asset.sourceKind.replace(/-input$/, "") || "asset",role:asset.role || role,order:index,enabled:true,evidence:{sourceNodeId:String(node?.id || ""),sourceKind:String(node?.data?.kind || ""),sourceOutputFingerprint}})),
      excludedKeys:[]
    };
  }

  function currentSnapshotCandidate(node, bindingId, role = "") {
    return core?.captureInputSnapshot ? core.captureInputSnapshot(node, {bindingId, role}) : fallbackSnapshot(node, bindingId, role);
  }

  function ensureInputSnapshot(node, edge, edgeIndex) {
    const bindingId = String(edge?.data?.bindingId || edge?.id || `${node?.id || "source"}:${edgeIndex}`);
    if (!edge.data || typeof edge.data !== "object") edge.data = {};
    if (core?.normalizeEdgeData) edge.data = core.normalizeEdgeData(edge.data, edge?.id || bindingId, edgeIndex, node);
    const binding = edge.data;
    let snapshot = binding.inputSnapshot;
    if (!snapshot || typeof snapshot !== "object") snapshot = fallbackSnapshot(node, bindingId, binding.role);
    if (core?.normalizeInputSnapshot) snapshot = core.normalizeInputSnapshot(snapshot, {bindingId, sourceNodeId:String(node?.id || "")});
    const hasSnapshotItems = (snapshot.textBlocks || []).some(item => item?.text) || (snapshot.assetBindings || []).some(item => item?.assetId);
    if (snapshot.state !== "captured" && hasSnapshotItems) snapshot = {...snapshot,state:"captured",importedAt:snapshot.importedAt || new Date().toISOString()};
    if (snapshot.state !== "captured") {
      const candidate = currentSnapshotCandidate(node, bindingId, binding.role);
      if (candidate.state === "captured") snapshot = candidate;
    }
    binding.inputSnapshot = snapshot;
    const liveCandidate = currentSnapshotCandidate(node, bindingId, binding.role);
    const updateAvailable = snapshot.state === "captured" && liveCandidate.state === "captured" && Boolean(snapshot.sourceOutputFingerprint) && liveCandidate.sourceOutputFingerprint !== snapshot.sourceOutputFingerprint;
    return {snapshot, liveCandidate, updateAvailable};
  }

  function outputItem(node, edge, edgeIndex) {
    const base = core?.outputFromNode ? core.outputFromNode(node) : {
      sourceId: String(node?.id || ""),
      sourceKind: String(node?.data?.kind || node?.type || ""),
      sourceTitle: String(node?.data?.title || node?.data?.kind || "未命名节点"),
      status: String(node?.data?.status || "idle"),
      content: extractBusinessText(node),
      refs: clone(node?.data?.refs || {}),
      output: clone(node?.data?.output || null)
    };
    const data = node?.data || {};
    const resolvedSnapshot = ensureInputSnapshot(node, edge, edgeIndex);
    const binding = edge?.data || {};
    const metadata = Object.fromEntries(Object.entries(data).filter(([key]) => RUNTIME_KEYS.has(key)));
    const snapshot = resolvedSnapshot.snapshot;
    const availableTextBlocks = (snapshot.textBlocks || []).filter(block => normalizeText(block?.text)).map(block => ({...clone(block),text:normalizeText(block.text),enabled:block?.enabled !== false}));
    const textBlocks = availableTextBlocks.filter(block => block.enabled !== false);
    const availableAssets = (snapshot.assetBindings || []).filter(asset => asset?.assetId).sort((a,b) => Number(a.order || 0) - Number(b.order || 0)).map((asset, index) => ({
      assetId:String(asset.assetId),
      id:String(asset.id || `${binding.bindingId || edge?.id || node?.id}:asset:${index}`),
      order:Number.isFinite(Number(asset.order)) ? Number(asset.order) : index,
      role:String(asset.role || binding.role || ""),
      sourceNodeId:String(node?.id || ""),
      sourceKind:String(data.kind || node?.type || ""),
      mediaType:String(asset.mediaType || "asset"),
      enabled:asset?.enabled !== false,
      evidence:clone(asset.evidence || {})
    }));
    const assets = availableAssets.filter(asset => asset.enabled !== false);
    const jobIds = [...new Set([
      ...(Array.isArray(base.refs?.jobIds) ? base.refs.jobIds : []),
      ...assets.flatMap(asset => Array.isArray(asset.evidence?.jobIds) ? asset.evidence.jobIds : [])
    ].filter(Boolean).map(String))];
    const conversationIds = [...new Set([
      ...(Array.isArray(base.refs?.conversationIds) ? base.refs.conversationIds : []),
      ...assets.flatMap(asset => Array.isArray(asset.evidence?.conversationIds) ? asset.evidence.conversationIds : [])
    ].filter(Boolean).map(String))];
    return {
      ...base,
      content:textBlocks.map(block => block.text).join("\n\n"),
      refs: {...(base.refs || {}), assetIds: assets.map(item => item.assetId), jobIds, conversationIds},
      metadata: {...(base.metadata || {}), ...metadata},
      binding: {
        bindingId: String(binding.bindingId || edge?.id || `${node?.id || "source"}:${edgeIndex}`),
        order: Number.isFinite(Number(binding.order)) ? Number(binding.order) : edgeIndex,
        enabled: binding.enabled !== false,
        transferMode: ["auto", "text", "asset", "control"].includes(binding.transferMode) ? binding.transferMode : "auto",
        role: String(binding.role || "")
      },
      assets,
      availableAssets,
      textBlocks,
      availableTextBlocks,
      snapshot:{
        version:Number(snapshot.version || 1),
        state:String(snapshot.state || "pending"),
        importMode:"once",
        importedAt:String(snapshot.importedAt || ""),
        sourceOutputFingerprint:String(snapshot.sourceOutputFingerprint || ""),
        liveOutputFingerprint:String(resolvedSnapshot.liveCandidate?.sourceOutputFingerprint || ""),
        updateAvailable:resolvedSnapshot.updateAvailable
      }
    };
  }

  function orderedIncoming(targetId, edges) {
    return (edges || []).map((edge, index) => ({edge, index})).filter(item => String(item.edge?.target || "") === String(targetId))
      .sort((a, b) => {
        const ao = Number.isFinite(Number(a.edge?.data?.order)) ? Number(a.edge.data.order) : a.index;
        const bo = Number.isFinite(Number(b.edge?.data?.order)) ? Number(b.edge.data.order) : b.index;
        return ao - bo || a.index - b.index;
      });
  }

  function allowedText(targetNode, item) {
    if (item.binding.transferMode === "asset" || item.binding.transferMode === "control") return false;
    // Automatic text propagation is semantic, not transitive. A video node
    // consumes the prepared video prompt, never the entire upstream story
    // planning chain. Explicit `text` bindings remain an intentional escape
    // hatch for advanced workflows.
    if (item.binding.transferMode === "text") return true;
    const targetKind = String(targetNode?.data?.kind || "");
    const sourceKind = String(item.sourceKind || "");
    const directTextInputs = {
      "video-generation": new Set(["video-prompt", "prompt"]),
      "image-generation": new Set(["prompt", "image-prompt", "text-input"]),
      "audio-generation": new Set(["prompt", "audio-prompt", "text-input"]),
      "video-prompt": new Set(["storyboard", "director-plan", "prompt", "text-input"])
    };
    if (directTextInputs[targetKind]) return directTextInputs[targetKind].has(sourceKind);
    const inputTypes = nodeMeta(targetNode?.data?.kind).inputTypes || [];
    return !inputTypes.length || inputTypes.includes("text") || inputTypes.includes("json") || inputTypes.includes("control");
  }

  function allowedAssets(targetNode, item) {
    if (item.binding.transferMode === "text" || item.binding.transferMode === "control") return false;
    const inputTypes = nodeMeta(targetNode?.data?.kind).inputTypes || [];
    return !inputTypes.length || inputTypes.includes("asset") || item.assets.some(asset => {
      const explicit = String(asset.mediaType || "");
      const transferType = explicit && explicit !== "asset" ? explicit : String(asset.sourceKind || "").replace(/-input$/, "");
      return inputTypes.includes(transferType);
    });
  }

  function resolveExecutionEnvelope(nodeId, nodes = [], edges = []) {
    const nodeMap = new Map(nodes.map(node => [String(node.id), node]));
    const targetNode = nodeMap.get(String(nodeId));
    if (!targetNode) throw new Error("节点不存在");
    // Only direct bindings belong to this node's execution input. Recursive
    // ancestry made story outline, episode script and director planning leak
    // into the final video prompt even when they were not connected to the
    // video node. Each intermediate node already materializes its own output;
    // downstream nodes should consume that output through their direct edge.
    const ordered = orderedIncoming(String(nodeId), edges)
      .filter(({edge}) => edge?.data?.enabled !== false)
      .map(({edge, index}) => {
        const source = nodeMap.get(String(edge.source));
        return source ? outputItem(source, edge, index) : null;
      })
      .filter(Boolean);
    const items = ordered.filter(item => item.binding.enabled);
    const businessItems = items.filter(item => allowedText(targetNode, item) && item.content);
    const metadataItems = items.map(item => ({
      sourceId: item.sourceId,
      sourceKind: item.sourceKind,
      sourceTitle: item.sourceTitle,
      status: item.status,
      metadata: clone(item.metadata || {}),
      binding: clone(item.binding),
      snapshot: clone(item.snapshot)
    }));
    const assetItems = items.filter(item => allowedAssets(targetNode, item));
    const localAssets = extractAssetBindings(targetNode);
    const assetIds = [...new Set([...localAssets.map(asset => asset.assetId), ...assetItems.flatMap(item => item.assets.map(asset => asset.assetId))])];
    const jobIds = [...new Set(items.flatMap(item => Array.isArray(item.refs?.jobIds) ? item.refs.jobIds : []).filter(Boolean).map(String))];
    const instruction = normalizeText(targetNode.data?.instruction || targetNode.data?.content || "", 12000);
    const upstreamText = businessItems.map(item => item.content).filter(Boolean).join("\n\n");
    const inputDraft = targetNode.data?.inputDraft && typeof targetNode.data.inputDraft === "object" ? targetNode.data.inputDraft : null;
    const prompt = inputDraft?.active === true ? normalizeText(inputDraft.prompt, 12000) : [instruction, upstreamText].filter(Boolean).join("\n\n");
    const inputManifest = [
      ...localAssets.map((asset, index) => ({
        bindingId: `local:${targetNode.id}:${asset.assetId}`,
        sourceNodeId: targetNode.id,
        sourceKind: targetNode.data?.kind || "text",
        outputType: asset.sourceKind.replace(/-input$/, ""),
        order: -1000 + index,
        enabled: true,
        role: asset.role,
        assetId: asset.assetId,
        evidence: {sourceNodeId: targetNode.id, sourceTitle: targetNode.data?.title || "未命名节点", status: targetNode.data?.status || "idle", scope:"local"}
      })),
      ...assetItems.flatMap(item => item.assets.map(asset => ({
        bindingId: item.binding.bindingId,
        snapshotItemId: `${item.binding.bindingId}:${asset.assetId}`,
        sourceNodeId: item.sourceId,
        sourceKind: item.sourceKind,
        outputType: asset.mediaType && asset.mediaType !== "asset" ? asset.mediaType : String(asset.sourceKind || item.output?.type || "asset").replace(/-input$/, ""),
        order: item.binding.order,
        itemOrder:asset.order,
        enabled: item.binding.enabled,
        role: item.binding.role || asset.role,
        assetId: asset.assetId,
        evidence: {...clone(asset.evidence || {}), sourceNodeId:item.sourceId, sourceTitle:item.sourceTitle, sourceOutputFingerprint:item.snapshot.sourceOutputFingerprint, importedAt:item.snapshot.importedAt}
      }))),
      ...businessItems.flatMap(item => item.textBlocks.map((block, blockIndex) => ({
        bindingId: item.binding.bindingId,
        snapshotItemId:block.id || `${item.binding.bindingId}:text:${blockIndex}`,
        sourceNodeId: item.sourceId,
        sourceKind: item.sourceKind,
        outputType: "text",
        order: item.binding.order,
        itemOrder:blockIndex,
        enabled: item.binding.enabled && block.enabled !== false,
        role: item.binding.role,
        contentPreview: block.text.slice(0, 240),
        evidence: {sourceNodeId:item.sourceId, sourceTitle:item.sourceTitle, sourceOutputFingerprint:item.snapshot.sourceOutputFingerprint, importedAt:item.snapshot.importedAt}
      })))
    ].sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || Number(a.itemOrder || 0) - Number(b.itemOrder || 0));
    const inputFingerprint = fingerprintValue({
      prompt,
      assetIds,
      modelParameters:targetNode.data?.modelParameters || {},
      inputs:[
        ...localAssets.map(asset => ({scope:"local",assetId:asset.assetId,role:asset.role || ""})),
        ...items.map(item => ({
          bindingId:item.binding.bindingId,
          transferMode:item.binding.transferMode,
          role:item.binding.role || "",
          textBlocks:item.textBlocks.map(block => ({id:block.id || "",text:block.text,enabled:block.enabled !== false})),
          assets:item.assets.map(asset => ({assetId:asset.assetId,role:asset.role || "",order:asset.order,enabled:true}))
        }))
      ]
    });
    const updatesAvailable = items.filter(item => item.snapshot?.updateAvailable).map(item => ({bindingId:item.binding.bindingId,sourceNodeId:item.sourceId,sourceTitle:item.sourceTitle,capturedFingerprint:item.snapshot.sourceOutputFingerprint,liveFingerprint:item.snapshot.liveOutputFingerprint}));
    return {
      nodeId: targetNode.id,
      kind: targetNode.data?.kind || "text",
      title: targetNode.data?.title || "未命名节点",
      instruction,
      prompt,
      assetIds,
      inputManifest,
      inputFingerprint,
      upstream: {items, businessItems, metadataItems, text: upstreamText, assetIds, jobIds, updatesAvailable},
      refs: clone(targetNode.data?.refs || {}),
      modelParameters: clone(targetNode.data?.modelParameters || {})
    };
  }

  function validateInputEnvelope(node, envelope) {
    const errors = [];
    if (!node || !envelope) errors.push("执行输入不存在");
    if (!String(envelope?.nodeId || "")) errors.push("缺少目标节点");
    if (new Set(envelope?.assetIds || []).size !== (envelope?.assetIds || []).length) errors.push("素材引用重复");
    for (const item of envelope?.inputManifest || []) {
      if (!item.sourceNodeId || !item.bindingId) errors.push("输入证据缺少来源绑定");
    }
    return {ok: errors.length === 0, errors};
  }

  return {TEXT_KEYS, extractBusinessText, extractAssetBindings, ensureInputSnapshot, resolveExecutionEnvelope, validateInputEnvelope};
});
