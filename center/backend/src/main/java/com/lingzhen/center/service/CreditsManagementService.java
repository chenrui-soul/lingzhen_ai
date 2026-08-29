package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.ManagementCreditLedgerPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementCreditReservationAnomalyPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementCreditWalletPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementRechargeOrderPageResponse;

public interface CreditsManagementService {

    ManagementCreditWalletPageResponse wallets(
            SessionContext sessionContext,
            String cursor,
            int limit,
            String keyword,
            String status
    );

    ManagementRechargeOrderPageResponse orders(
            SessionContext sessionContext,
            String cursor,
            int limit,
            String keyword,
            String status
    );

    ManagementCreditLedgerPageResponse ledger(
            SessionContext sessionContext,
            String cursor,
            int limit,
            String keyword,
            String entryType
    );

    ManagementCreditReservationAnomalyPageResponse reservationAnomalies(
            SessionContext sessionContext,
            String cursor,
            int limit,
            String keyword,
            String anomalyType
    );
}
