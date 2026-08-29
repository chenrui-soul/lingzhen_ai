"use strict";

function normalizeUpdateUrl(value, {allowPublicHttp = false} = {}) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password || url.search || url.hash) return "";
    const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !local && allowPublicHttp !== true) return "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch { return ""; }
}

const BLOCKING_STATES = new Set([
  "queued", "preparing", "assigned", "launching", "checking_login", "uploading_references",
  "uploading", "configuring", "submitting", "awaiting_confirmation", "generating", "monitoring",
  "result_detected", "downloading", "verifying", "awaiting_login", "awaiting_verification",
  "awaiting_quota", "submission_unknown", "paused"
]);

function blockingTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).filter(task => !task?.deletedAt && !task?.archivedAt && BLOCKING_STATES.has(task?.state));
}

module.exports = {normalizeUpdateUrl, blockingTasks, BLOCKING_STATES};
