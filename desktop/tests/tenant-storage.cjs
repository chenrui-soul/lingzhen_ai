"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-tenants-"));
for (const tenant of ["tenant-a", "tenant-b"]) {
  const tenantRoot = path.join(root, tenant);
  for (const name of ["database", "materials", "downloads", "documents", "chrome-profiles", "task-cache", "logs"]) fs.mkdirSync(path.join(tenantRoot, name), {recursive: true});
  fs.writeFileSync(path.join(tenantRoot, "materials", "marker.txt"), tenant, "utf8");
}
assert.equal(fs.readFileSync(path.join(root, "tenant-a", "materials", "marker.txt"), "utf8"), "tenant-a");
assert.equal(fs.readFileSync(path.join(root, "tenant-b", "materials", "marker.txt"), "utf8"), "tenant-b");
assert.notEqual(path.join(root, "tenant-a", "chrome-profiles"), path.join(root, "tenant-b", "chrome-profiles"));
console.log(JSON.stringify({test: "tenant-storage", passed: 3, failed: 0, root}));
