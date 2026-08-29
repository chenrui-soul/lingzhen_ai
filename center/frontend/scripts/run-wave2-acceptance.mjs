import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptRoot);
const referencePath = join(projectRoot, 'references', 'wave2-acceptance.json');
const logRoot = join(scriptRoot, 'log');
const reference = JSON.parse(await readFile(referencePath, 'utf8'));
const results = [];

function record(name, passed, evidence) {
  results.push({ name, passed, evidence });
  if (!passed) {
    process.exitCode = 1;
  }
}

function includesAll(source, fragments) {
  return fragments.every((fragment) => source.includes(fragment));
}

const [controllerSource, serviceSource, routesSource, apiSource, generatedSchema] =
  await Promise.all([
    readFile(
      join(
        dirname(projectRoot),
        'lingzhen_center_backend',
        'src',
        'main',
        'java',
        'com',
        'lingzhen',
        'center',
        'controller',
        'ManagementReadController.java',
      ),
      'utf8',
    ),
    readFile(
      join(
        dirname(projectRoot),
        'lingzhen_center_backend',
        'src',
        'main',
        'java',
        'com',
        'lingzhen',
        'center',
        'service',
        'impl',
        'ManagementReadServiceImpl.java',
      ),
      'utf8',
    ),
    readFile(join(projectRoot, 'src', 'router', 'routes.ts'), 'utf8'),
    readFile(
      join(projectRoot, 'src', 'features', 'management', 'api', 'management-api.ts'),
      'utf8',
    ),
    readFile(join(projectRoot, 'src', 'api', 'generated', 'schema.d.ts'), 'utf8'),
  ]);

for (const endpoint of reference.endpoints) {
  const shortPath = endpoint.path.replace('/api/v1/management', '');
  record(
    `controller:${endpoint.path}`,
    controllerSource.includes(`@GetMapping("${shortPath}")`) &&
      controllerSource.includes(`PERM_${endpoint.permission}`),
    `${endpoint.method} with ${endpoint.permission}`,
  );
  record(
    `openapi:${endpoint.path}`,
    generatedSchema.includes(`"${endpoint.path}"`),
    'generated schema contains endpoint',
  );
}

record(
  'service:session-tenant-is-source-of-truth',
  includesAll(serviceSource, [
    'sessionContext.tenantId()',
    'context.clientType() != ClientType.MANAGEMENT_WEB',
    'context.permissions().contains(permission)',
  ]),
  'tenantId and permission are read from authenticated SessionContext',
);

record(
  'frontend:no-tenant-query-parameter',
  !apiSource.includes('tenantId'),
  'management API client never accepts or sends tenantId',
);

for (const route of reference.routes) {
  record(
    `route:${route.path}`,
    routesSource.includes(`path: '${route.path}'`) &&
      routesSource.includes(`requiredPermission: '${route.permission}'`),
    `route requires ${route.permission}`,
  );
}

record(
  'schema:dashboard-contract-is-not-collided',
  includesAll(generatedSchema, [
    'ManagementDashboardTenantSummary',
    'ManagementDashboardMetrics',
    'ManagementDashboardRoleSummary',
  ]),
  'management dashboard nested schemas use unique names',
);

try {
  const response = await fetch(`${reference.backendBaseUrl}/v3/api-docs`);
  const openApi = await response.json();
  record(
    'live:openapi',
    response.ok && reference.endpoints.every((endpoint) => openApi.paths?.[endpoint.path]?.get),
    `HTTP ${response.status}; all management GET paths present`,
  );
} catch (error) {
  record('live:openapi', false, `request failed: ${String(error)}`);
}

const identity = process.env.LZ_ACCEPTANCE_IDENTITY;
const password = process.env.LZ_ACCEPTANCE_PASSWORD;
if (identity && password) {
  try {
    const loginResponse = await fetch(`${reference.backendBaseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity,
        password,
        clientType: 'management_web',
        device: {
          deviceHash: '9'.repeat(64),
          fingerprintVersion: 1,
          displayName: 'Wave 2 Acceptance',
          platform: 'windows',
          architecture: 'x64',
          appVersion: 'wave2',
        },
      }),
    });
    const login = await loginResponse.json();
    const token = login.accessToken;
    record(
      'live:login',
      loginResponse.ok && login.status === 'authenticated' && Boolean(token),
      `HTTP ${loginResponse.status}; status=${login.status ?? 'unknown'}`,
    );

    if (token) {
      for (const endpoint of reference.endpoints) {
        const url = new URL(endpoint.path, reference.backendBaseUrl);
        if (endpoint.path.endsWith('/users')) {
          url.searchParams.set('page', '1');
          url.searchParams.set('pageSize', '20');
          url.searchParams.set('status', 'all');
        }
        const endpointResponse = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await endpointResponse.json();
        record(
          `live:${endpoint.path}`,
          endpointResponse.ok &&
            endpoint.requiredResponseFields.every((field) =>
              Object.prototype.hasOwnProperty.call(body, field),
            ),
          `HTTP ${endpointResponse.status}; fields checked=${endpoint.requiredResponseFields.join(',')}`,
        );
      }
    }
  } catch (error) {
    record('live:authenticated-flow', false, `request failed: ${String(error)}`);
  }
} else {
  record(
    'live:authenticated-flow',
    true,
    'skipped because LZ_ACCEPTANCE_IDENTITY/LZ_ACCEPTANCE_PASSWORD were not supplied',
  );
}

await mkdir(logRoot, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  source: reference.source,
  total: results.length,
  passed: results.filter((result) => result.passed).length,
  failed: results.filter((result) => !result.passed).length,
  results,
};
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const logPath = join(logRoot, `wave2-acceptance-${timestamp}.json`);
await writeFile(logPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ...report, logPath }, null, 2)}\n`);
