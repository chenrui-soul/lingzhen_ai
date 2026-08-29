package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreditLedgerPageResponse;
import com.lingzhen.center.model.dto.billing.CreditWalletResponse;

import java.util.OptionalLong;

public interface BillingWalletService {

    CreditWalletResponse wallet(SessionContext sessionContext);

    CreditLedgerPageResponse ledger(SessionContext sessionContext, String cursor, int limit);

    OptionalLong availableBalanceForBootstrap(SessionContext sessionContext);
}
