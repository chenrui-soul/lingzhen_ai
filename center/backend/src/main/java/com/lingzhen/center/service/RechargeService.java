package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreateRechargeOrderRequest;
import com.lingzhen.center.model.dto.billing.RechargeOrderResponse;
import com.lingzhen.center.model.dto.billing.RechargeOrderListResponse;
import com.lingzhen.center.model.dto.billing.RechargePackageListResponse;

import java.util.UUID;

public interface RechargeService {

    RechargePackageListResponse activePackages(SessionContext sessionContext);

    RechargeOrderResponse createOrder(
            SessionContext sessionContext,
            String idempotencyKey,
            CreateRechargeOrderRequest request
    );

    RechargeOrderResponse order(SessionContext sessionContext, UUID orderId);

    RechargeOrderListResponse orders(SessionContext sessionContext, int limit);

    RechargeOrderResponse cancelOrder(SessionContext sessionContext, UUID orderId);
}
