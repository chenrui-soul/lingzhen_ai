const PLATFORM_TASK_PATH = "/api/v1/desktop/platform-model-tasks";

const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);

class PlatformModelGatewayBridge {
  constructor({authClient}) {
    if (!authClient || typeof authClient.authenticatedRequest !== "function") throw new Error("authClient 无效");
    this.authClient = authClient;
  }

  models() {
    return (this.authClient.status()?.bootstrap?.data?.models || []).filter(item => item?.source === "platform");
  }

  model(providerId, modelId) {
    return this.models().find(item => String(item.id) === String(modelId)
      && String(item.provider?.id) === String(providerId)) || null;
  }

  isPlatformRoute(providerId, modelId) {
    return Boolean(this.model(providerId, modelId));
  }

  /**
   * Return the published platform catalog, including models that are currently
   * not executable.  The renderer uses this read-only view to explain why a
   * model cannot be selected; executionCatalog() remains the strict route used
   * for task submission.
   */
  catalog() {
    const providers = new Map();
    for (const model of this.models()) {
      const providerId = String(model.provider?.id || "");
      if (!providerId) continue;
      if (!providers.has(providerId)) {
        providers.set(providerId, {
          id: providerId,
          name: model.provider.displayName,
          source: "platform",
          readOnly: true,
          enabled: true,
          status: model.executionReady === true ? "online" : "unavailable",
          statusText: model.executionReady === true ? "可执行" : "已发布但当前不可执行",
          models: [],
        });
      }
      const provider = providers.get(providerId);
      provider.models.push({
        id: String(model.id),
        displayName: model.displayName,
        enabled: model.executionReady === true,
        executionReady: model.executionReady === true,
        source: "platform",
        parameters: {...(model.defaultParameters || {})},
        parameterSchema: {...(model.parameterSchema || {})},
        capabilities: {type: model.capabilityType, confirmed: true, source: "platform"},
      });
      if (model.executionReady !== true) provider.status = "unavailable";
    }
    return [...providers.values()];
  }

  executionCatalog() {
    const providers = new Map();
    for (const model of this.models().filter(item => item.executionReady === true)) {
      const providerId = String(model.provider.id);
      if (!providers.has(providerId)) {
        providers.set(providerId, {
          id: providerId,
          name: model.provider.displayName,
          source: "platform",
          readOnly: true,
          enabled: true,
          status: "online",
          models: [],
        });
      }
      providers.get(providerId).models.push({
        id: String(model.id),
        displayName: model.displayName,
        enabled: true,
        source: "platform",
        parameters: {...(model.defaultParameters || {})},
        parameterSchema: {...(model.parameterSchema || {})},
        capabilities: {type: model.capabilityType, confirmed: true, source: "platform"},
      });
    }
    return [...providers.values()];
  }

  async generate(providerId, modelId, input = {}) {
    const model = this.model(providerId, modelId);
    if (!model || model.executionReady !== true) {
      const error = new Error("当前平台模型尚未配置可执行代理");
      error.code = "PLATFORM_MODEL_NOT_READY";
      error.notSentVerified = true;
      error.safeToRetry = true;
      throw error;
    }
    const sourceAssets = Array.isArray(input.assets) ? input.assets : [];
    const assets = [];
    for (const asset of sourceAssets) {
      const existingUrl = text(asset.url || asset.sourceUrl || asset.downloadUrl, 8192);
      if (/^https?:\/\//i.test(existingUrl)) { assets.push({id: text(asset.id, 128), type: text(asset.type, 16) || "image", url: existingUrl}); continue; }
      if (!asset.path) continue;
      const uploaded = await this.authClient.authenticatedUpload("/api/v1/desktop/assets/upload", asset.path, {contentType: asset.mime || "image/jpeg", filename: asset.originalName || asset.name || "reference-image"});
      assets.push({id: text(uploaded.assetId || asset.id, 128), type: text(asset.type, 16) || "image", url: text(uploaded.url, 8192)});
    }
    if (sourceAssets.length && assets.length !== sourceAssets.length) {
      const error = new Error("平台模型参考素材需要先同步为网络地址，本地文件暂不能直接提交");
      error.code = "PLATFORM_REFERENCE_NOT_UPLOADED";
      error.notSentVerified = true;
      error.safeToRetry = true;
      throw error;
    }
    const result = await this.authClient.authenticatedRequest(PLATFORM_TASK_PATH, {
      body: {
        modelId: String(model.id),
        creationType: model.capabilityType,
        prompt: text(input.prompt, 20000),
        parameters: input.parameters && typeof input.parameters === "object" ? input.parameters : {},
        assets,
        clientRequestId: text(input.clientRequestId, 128),
      },
      timeoutMs: 135000,
    });
    if (result.state === "failed") throw this.executionError(result, false);
    if (result.state === "submission_unknown") throw this.executionError(result, true);
    return {
      ok: true,
      type: model.capabilityType,
      providerId: String(providerId),
      providerName: model.provider.displayName,
      modelId: String(modelId),
      content: result.resultText || "",
      urls: result.resultUrls || [],
      expectedResultCount: (result.resultUrls || []).length,
      providerJobId: String(result.taskId || ""),
      clientRequestId: text(input.clientRequestId, 128),
      status: result.state,
      pending: !["completed", "failed", "cancelled"].includes(result.state),
    };
  }

  async queryGeneration(providerId, modelId, query = {}) {
    if (!this.isPlatformRoute(providerId, modelId)) return {supported: false, error: "平台模型路由不存在"};
    const taskId = text(query.providerJobId, 100);
    if (!taskId) return {supported: true, notFound: false, pending: false, failed: false, error: "平台任务标识缺失"};
    const result = await this.authClient.authenticatedRequest(`${PLATFORM_TASK_PATH}/${encodeURIComponent(taskId)}`, {
      method: "GET",
      timeoutMs: 30000,
    });
    // 后端会在模型未配置查询地址时返回可识别的业务错误。将它映射为
    // supported:false，交给桌面端状态机进入“等待人工核对”，避免无限轮询。
    if (result.errorCode === "PLATFORM_STATUS_PATH_NOT_CONFIGURED") {
      return {
        supported: false,
        ok: false,
        failed: false,
        completed: false,
        pending: false,
        notFound: false,
        status: "unsupported",
        urls: result.resultUrls || [],
        providerId: String(providerId),
        modelId: String(modelId),
        providerJobId: String(result.providerJobId || taskId),
        clientRequestId: text(query.clientRequestId, 128),
        error: result.errorMessage || "管理员尚未配置该模型的任务查询地址",
        errorCode: result.errorCode,
      };
    }
    return {
      supported: true,
      ok: result.state === "completed",
      failed: result.state === "failed",
      completed: result.state === "completed",
      pending: !["completed", "failed", "cancelled"].includes(result.state),
      notFound: false,
      status: result.state,
      urls: result.resultUrls || [],
      content: result.resultText || "",
      type: this.model(providerId, modelId)?.capabilityType || query.type || "",
      expectedResultCount: (result.resultUrls || []).length,
      providerId: String(providerId),
      modelId: String(modelId),
      providerJobId: String(result.taskId || taskId),
      clientRequestId: text(query.clientRequestId, 128),
      error: result.errorMessage || "",
    };
  }

  async cancelGeneration(providerId, modelId, query = {}) {
    if (!this.isPlatformRoute(providerId, modelId)) return {supported: false, cancelled: false, error: "平台模型路由不存在"};
    const taskId = text(query.providerJobId, 100);
    if (!taskId) return {supported: true, cancelled: false, error: "平台任务标识缺失"};
    const result = await this.authClient.authenticatedRequest(`${PLATFORM_TASK_PATH}/${encodeURIComponent(taskId)}/cancel`, {
      body: {}, timeoutMs: 30000,
    });
    return {supported: true, cancelled: result.state === "cancelled", status: result.state, error: result.errorMessage || ""};
  }

  executionError(result, submissionUnknown) {
    const error = new Error(result.errorMessage || "平台模型执行失败");
    error.code = result.errorCode || (submissionUnknown ? "MODEL_SUBMISSION_UNKNOWN" : "MODEL_REQUEST_FAILED");
    error.submissionUnknown = submissionUnknown;
    error.safeToRetry = false;
    error.providerJobId = String(result.taskId || "");
    return error;
  }
}

class RoutedModelGatewayBridge {
  constructor({localGateway, platformGateway}) {
    this.localGateway = localGateway;
    this.platformGateway = platformGateway;
  }
  route(providerId, modelId) { return this.platformGateway.isPlatformRoute(providerId, modelId) ? this.platformGateway : this.localGateway; }
  generate(providerId, modelId, input) { return this.route(providerId, modelId).generate(providerId, modelId, input); }
  queryGeneration(providerId, modelId, input) { return this.route(providerId, modelId).queryGeneration(providerId, modelId, input); }
  cancelGeneration(providerId, modelId, input) { return this.route(providerId, modelId).cancelGeneration(providerId, modelId, input); }
  catalog() { return [...this.localGateway.bootstrap(), ...this.platformGateway.catalog()]; }
  executionCatalog() { return [...this.localGateway.bootstrap(), ...this.platformGateway.executionCatalog()]; }
}

module.exports = {PlatformModelGatewayBridge, RoutedModelGatewayBridge};
