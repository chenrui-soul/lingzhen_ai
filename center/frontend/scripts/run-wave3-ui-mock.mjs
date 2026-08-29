import http from 'node:http';
import { Buffer } from 'node:buffer';
import process from 'node:process';

const host = '127.0.0.1';
const port = 9101;
const frontendOrigin = 'http://127.0.0.1:5174';
const now = new Date().toISOString();

const provider = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'volcengine',
  displayName: '火山引擎',
  protocolFamily: 'openai_compatible',
  description: '视频与多模态模型服务',
  status: 'active',
  createdAt: now,
  updatedAt: now,
  rowVersion: 2,
};

const model = {
  id: '22222222-2222-4222-8222-222222222222',
  provider: { id: provider.id, code: provider.code, displayName: provider.displayName },
  code: 'seedance-2.0-mini',
  displayName: 'Seedance 2.0 Mini',
  capabilityType: 'video',
  description: '适用于短视频与人物参考图生成',
  parameterSchema: {
    type: 'object',
    properties: { duration: { type: 'integer', minimum: 1, maximum: 30 } },
  },
  defaultParameters: { duration: 10 },
  defaultTenantEnabled: true,
  sortOrder: 20,
  status: 'active',
  createdAt: now,
  updatedAt: now,
  rowVersion: 4,
};

let tenantModel = {
  policyId: null,
  modelId: model.id,
  provider: model.provider,
  code: model.code,
  displayName: model.displayName,
  capabilityType: model.capabilityType,
  parameterSchema: model.parameterSchema,
  defaultParameters: model.defaultParameters,
  defaultTenantEnabled: model.defaultTenantEnabled,
  policy: 'inherit',
  effectiveEnabled: model.defaultTenantEnabled,
  rowVersion: null,
};

function send(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': frontendOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Idempotency-Key, X-CSRF-Token, X-Request-Id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Set-Cookie': 'LZ_CSRF=browser-csrf; Path=/; SameSite=Lax',
  });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    send(response, 204, {});
    return;
  }

  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  if (url.pathname === '/api/v1/auth/me') {
    send(response, 200, {
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      username: '视觉验收管理员',
      email: 'admin@example.com',
      status: 'active',
      tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenantCode: 'lingzhen',
      tenantName: '灵帧测试空间',
      role: 'platform_admin',
      permissions: [
        'model_catalog.read',
        'model_catalog.manage',
        'model_catalog.publish',
        'tenant_model.read',
        'tenant_model.manage',
        'tenant.read',
        'membership.read',
      ],
    });
    return;
  }
  if (url.pathname === '/api/v1/management/model-catalog/providers' && request.method === 'GET') {
    send(response, 200, { items: [provider], page: 1, pageSize: 100, total: 1, totalPages: 1 });
    return;
  }
  if (url.pathname === '/api/v1/management/model-catalog/models' && request.method === 'GET') {
    send(response, 200, { items: [model], page: 1, pageSize: 20, total: 1, totalPages: 1 });
    return;
  }
  if (url.pathname === '/api/v1/management/model-catalog/versions') {
    send(response, 200, {
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          version: 3,
          current: true,
          contentHash: 'not-rendered',
          publishedByUserId: 'user',
          publishedByMembershipId: 'membership',
          publishedAt: now,
          createdAt: now,
          modelCount: 1,
        },
      ],
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    return;
  }
  if (url.pathname === '/api/v1/management/model-catalog/publish-preview') {
    send(response, 200, {
      currentVersion: 3,
      currentPublishedAt: now,
      nextVersion: 4,
      modelCount: 2,
      addedCount: 1,
      modifiedCount: 1,
      removedCount: 0,
      hasChanges: true,
      canPublish: true,
      contentHash: 'a'.repeat(64),
      blockers: [],
    });
    return;
  }
  if (
    url.pathname === '/api/v1/management/model-catalog/versions/publish' &&
    request.method === 'POST'
  ) {
    await readBody(request);
    send(response, 201, {
      versionId: '44444444-4444-4444-8444-444444444444',
      version: 4,
      current: true,
      modelCount: 2,
      publishedAt: now,
      idempotentReplay: false,
    });
    return;
  }
  if (url.pathname === '/api/v1/management/tenant-models' && request.method === 'GET') {
    send(response, 200, {
      available: true,
      catalogVersion: 3,
      publishedAt: now,
      models: [tenantModel],
    });
    return;
  }
  if (request.method === 'PUT' && url.pathname === `/api/v1/management/tenant-models/${model.id}`) {
    const body = await readBody(request);
    const nextVersion = tenantModel.rowVersion === null ? 0 : tenantModel.rowVersion + 1;
    tenantModel = {
      ...tenantModel,
      policy: body.policy,
      effectiveEnabled:
        body.policy === 'enabled'
          ? true
          : body.policy === 'hidden'
            ? false
            : tenantModel.defaultTenantEnabled,
      policyId: tenantModel.policyId ?? '55555555-5555-4555-8555-555555555555',
      rowVersion: nextVersion,
    };
    send(response, 200, {
      policyId: tenantModel.policyId,
      modelId: tenantModel.modelId,
      policy: tenantModel.policy,
      effectiveEnabled: tenantModel.effectiveEnabled,
      rowVersion: tenantModel.rowVersion,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  if (url.pathname === '/api/v1/management/model-catalog/providers' && request.method === 'POST') {
    send(response, 201, {
      ...provider,
      ...(await readBody(request)),
      status: 'draft',
      rowVersion: 0,
    });
    return;
  }
  if (url.pathname === '/api/v1/management/model-catalog/models' && request.method === 'POST') {
    send(response, 201, { ...model, ...(await readBody(request)), status: 'draft', rowVersion: 0 });
    return;
  }
  if (request.method === 'PUT' && url.pathname.includes('/api/v1/management/model-catalog/')) {
    const body = await readBody(request);
    const source = url.pathname.includes('/providers/') ? provider : model;
    send(response, 200, { ...source, ...body, rowVersion: Number(body.rowVersion ?? 0) + 1 });
    return;
  }
  send(response, 404, { code: 'NOT_FOUND', message: 'Mock endpoint not found' });
});

server.listen(port, host, () => {
  process.stdout.write(`Wave 3 UI mock listening on http://${host}:${port}\n`);
});
