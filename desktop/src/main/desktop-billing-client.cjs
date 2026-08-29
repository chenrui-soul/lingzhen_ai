"use strict";

function cleanLimit(value, fallback = 20) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(50, parsed)) : fallback;
}

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${field}返回值无效`);
  return parsed;
}

function signedInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field}返回值无效`);
  return parsed;
}

function normalizeOrder(order) {
  if (!order || !text(order.id) || !text(order.orderNo)) throw new Error("充值订单返回值无效");
  return {
    id: text(order.id),
    orderNo: text(order.orderNo),
    packageId: text(order.packageId),
    packageCode: text(order.packageCode),
    cashAmountCents: positiveInteger(order.cashAmountCents, "充值金额"),
    creditAmount: positiveInteger(order.creditAmount, "充值积分"),
    bonusCredits: positiveInteger(order.bonusCredits, "赠送积分"),
    paymentChannel: text(order.paymentChannel),
    status: text(order.status),
    expiresAt: order.expiresAt || null,
    paidAt: order.paidAt || null,
    closedAt: order.closedAt || null,
    submissionNote: order.submissionNote ? text(order.submissionNote).slice(0, 500) : null,
    reviewReason: order.reviewReason ? text(order.reviewReason).slice(0, 500) : null,
    reviewedAt: order.reviewedAt || null,
    createdAt: order.createdAt || null,
    updatedAt: order.updatedAt || null,
    idempotentReplay: Boolean(order.idempotentReplay),
  };
}

function normalizeLedgerEntry(entry) {
  if (!entry || !text(entry.id) || !text(entry.entryType)) throw new Error("积分流水返回值无效");
  return {
    id: text(entry.id),
    tenantId: text(entry.tenantId),
    entryType: text(entry.entryType),
    availableDelta: signedInteger(entry.availableDelta, "可用积分变动"),
    reservedDelta: signedInteger(entry.reservedDelta, "预占积分变动"),
    availableAfter: positiveInteger(entry.availableAfter, "可用积分余额"),
    reservedAfter: positiveInteger(entry.reservedAfter, "预占积分余额"),
    businessType: text(entry.businessType),
    businessId: text(entry.businessId),
    reason: entry.reason ? text(entry.reason).slice(0, 500) : "",
    createdAt: entry.createdAt || null,
  };
}

class DesktopBillingClient {
  constructor({authClient}) {
    this.authClient = authClient;
  }

  async wallet() {
    const data = await this.authClient.authenticatedRequest("/api/v1/credits/wallet", {method: "GET"});
    return {
      userId: text(data.userId),
      availableBalance: positiveInteger(data.availableBalance, "可用积分"),
      reservedBalance: positiveInteger(data.reservedBalance, "预占积分"),
      updatedAt: data.updatedAt || null,
    };
  }

  async packages() {
    const data = await this.authClient.authenticatedRequest("/api/v1/recharge-packages", {method: "GET"});
    const items = Array.isArray(data?.items) ? data.items : [];
    return {items: items.map(item => ({
      id: text(item.id),
      code: text(item.code),
      displayName: text(item.displayName),
      cashAmountCents: positiveInteger(item.cashAmountCents, "套餐金额"),
      creditAmount: positiveInteger(item.creditAmount, "套餐积分"),
      bonusCredits: positiveInteger(item.bonusCredits, "套餐赠送积分"),
      status: text(item.status),
      sortOrder: Number(item.sortOrder) || 0,
    })).filter(item => item.id && item.code)};
  }

  async orders(limit = 20) {
    const data = await this.authClient.authenticatedRequest(
      `/api/v1/recharge-orders?limit=${cleanLimit(limit)}`,
      {method: "GET"},
    );
    return {items: Array.isArray(data?.items) ? data.items.map(normalizeOrder) : []};
  }

  async ledger(limit = 20, cursor = null) {
    const params = new URLSearchParams({limit: String(cleanLimit(limit))});
    if (text(cursor)) params.set("cursor", text(cursor));
    const data = await this.authClient.authenticatedRequest(
      `/api/v1/credits/ledger?${params.toString()}`,
      {method: "GET"},
    );
    return {
      items: Array.isArray(data?.items) ? data.items.map(normalizeLedgerEntry) : [],
      nextCursor: data?.nextCursor ? text(data.nextCursor) : null,
    };
  }

  async createOrder({packageId, note = ""}) {
    if (!text(packageId)) throw new Error("请选择充值套餐");
    const idempotencyKey = `desktop-manual-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const data = await this.authClient.authenticatedRequest("/api/v1/recharge-orders", {
      method: "POST",
      headers: {"Idempotency-Key": idempotencyKey},
      body: {
        packageId: text(packageId),
        paymentChannel: "manual_transfer",
        note: text(note).slice(0, 500) || undefined,
      },
    });
    return normalizeOrder(data);
  }

  async cancelOrder(orderId) {
    if (!text(orderId)) throw new Error("充值订单不存在");
    return normalizeOrder(await this.authClient.authenticatedRequest(
      `/api/v1/recharge-orders/${encodeURIComponent(text(orderId))}/cancel`,
      {method: "POST"},
    ));
  }
}

module.exports = {DesktopBillingClient, normalizeOrder, normalizeLedgerEntry};
