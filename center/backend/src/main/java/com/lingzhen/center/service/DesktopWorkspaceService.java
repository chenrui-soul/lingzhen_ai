package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopDoubaoAccountRequest;
import com.lingzhen.center.model.dto.desktop.DesktopDoubaoAccountResponse;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceBootstrapData;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceSnapshotRequest;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceSnapshotResponse;

import java.util.List;

public interface DesktopWorkspaceService {

    DesktopWorkspaceSnapshotResponse snapshot(SessionContext sessionContext);

    DesktopWorkspaceSnapshotResponse saveSnapshot(
            SessionContext sessionContext,
            DesktopWorkspaceSnapshotRequest request
    );

    List<DesktopDoubaoAccountResponse> doubaoAccounts(SessionContext sessionContext);

    DesktopDoubaoAccountResponse saveDoubaoAccount(
            SessionContext sessionContext,
            String accountId,
            DesktopDoubaoAccountRequest request
    );

    void removeDoubaoAccount(SessionContext sessionContext, String accountId);

    DesktopWorkspaceBootstrapData loadForBootstrap(SessionContext sessionContext);
}
