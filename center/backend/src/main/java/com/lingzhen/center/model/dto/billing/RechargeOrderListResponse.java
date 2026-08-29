package com.lingzhen.center.model.dto.billing;

import java.util.List;

public record RechargeOrderListResponse(List<RechargeOrderResponse> items) {

    public RechargeOrderListResponse {
        items = List.copyOf(items);
    }
}

