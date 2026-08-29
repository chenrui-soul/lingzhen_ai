package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopDoubaoAccountRequest;
import com.lingzhen.center.model.dto.desktop.DesktopDoubaoAccountResponse;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceBootstrapData;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceSnapshotRequest;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceSnapshotResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.DesktopWorkspaceRepository;
import com.lingzhen.center.service.DesktopWorkspaceService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

@Service
public class DesktopWorkspaceServiceImpl implements DesktopWorkspaceService {

    private static final int MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
    private static final int MAX_DEPTH = 12;
    private static final int MAX_OBJECT_KEYS = 5000;
    private static final int MAX_ARRAY_ITEMS = 10000;
    private static final Pattern ACCOUNT_ID = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$");
    private static final Pattern LOCAL_PATH = Pattern.compile("^(?:file://|[A-Za-z]:[\\\\/]|/(?:Users|home|var|tmp)/)", Pattern.CASE_INSENSITIVE);
    private static final Set<String> FORBIDDEN_KEYS = Set.of(
            "accesstoken", "refreshtoken", "authorization", "apikey", "secret", "cookie",
            "cookies", "partition", "profileroot", "profilepath", "databaseurl", "credential",
            "credentialref", "privateheaders", "headers", "localpath", "filepath", "fileurl"
    );

    private final DesktopWorkspaceRepository repository;
    private final ObjectMapper objectMapper;

    public DesktopWorkspaceServiceImpl(
            DesktopWorkspaceRepository repository,
            ObjectMapper objectMapper
    ) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional(readOnly = true)
    public DesktopWorkspaceSnapshotResponse snapshot(SessionContext sessionContext) {
        require(sessionContext, "sync.use", "DESKTOP_SYNC_FORBIDDEN");
        return repository.findSnapshot(sessionContext.tenantId(), sessionContext.userId())
                .map(this::snapshotResponse)
                .orElseGet(() -> new DesktopWorkspaceSnapshotResponse(0, Map.of(), null, null));
    }

    @Override
    @Transactional
    public DesktopWorkspaceSnapshotResponse saveSnapshot(
            SessionContext sessionContext,
            DesktopWorkspaceSnapshotRequest request
    ) {
        require(sessionContext, "sync.use", "DESKTOP_SYNC_FORBIDDEN");
        Map<String, Object> snapshot = validateSnapshot(request.snapshot());
        String json = writeJson(snapshot);
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_SNAPSHOT_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "DESKTOP_WORKSPACE_TOO_LARGE", "桌面工作区元数据超过 2 MiB 限制");
        }
        String hash = sha256(json);
        return repository.saveSnapshot(
                        sessionContext.tenantId(),
                        sessionContext.userId(),
                        request.expectedRevision(),
                        snapshot,
                        hash
                )
                .map(this::snapshotResponse)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.CONFLICT,
                        "DESKTOP_WORKSPACE_CONFLICT",
                        "云端工作区已由其他会话更新，请先读取最新版本"
                ));
    }

    @Override
    @Transactional(readOnly = true)
    public List<DesktopDoubaoAccountResponse> doubaoAccounts(SessionContext sessionContext) {
        require(sessionContext, "doubao_account.use", "DOUBAO_ACCOUNT_FORBIDDEN");
        return repository.findDoubaoAccounts(sessionContext.tenantId(), sessionContext.userId())
                .stream().map(this::accountResponse).toList();
    }

    @Override
    @Transactional
    public DesktopDoubaoAccountResponse saveDoubaoAccount(
            SessionContext sessionContext,
            String accountId,
            DesktopDoubaoAccountRequest request
    ) {
        require(sessionContext, "doubao_account.use", "DOUBAO_ACCOUNT_FORBIDDEN");
        String normalizedAccountId = normalizeAccountId(accountId);
        return accountResponse(repository.upsertDoubaoAccount(
                sessionContext.tenantId(),
                sessionContext.userId(),
                normalizedAccountId,
                request.displayName().trim(),
                request.loginState(),
                cleanNullable(request.loginSummary()),
                request.lastCheckedAt()
        ));
    }

    @Override
    @Transactional
    public void removeDoubaoAccount(SessionContext sessionContext, String accountId) {
        require(sessionContext, "doubao_account.use", "DOUBAO_ACCOUNT_FORBIDDEN");
        repository.removeDoubaoAccount(
                sessionContext.tenantId(),
                sessionContext.userId(),
                normalizeAccountId(accountId)
        );
    }

    @Override
    @Transactional
    public DesktopWorkspaceBootstrapData loadForBootstrap(SessionContext sessionContext) {
        require(sessionContext, "desktop.bootstrap", "DESKTOP_BOOTSTRAP_FORBIDDEN");
        List<DesktopDoubaoAccountResponse> accounts = sessionContext.permissions().contains("doubao_account.use")
                ? repository.findDoubaoAccounts(sessionContext.tenantId(), sessionContext.userId())
                    .stream().map(this::accountResponse).toList()
                : List.of();
        List<DesktopWorkspaceBootstrapData.RecentProjectSummary> projects = repository
                .findSnapshot(sessionContext.tenantId(), sessionContext.userId())
                .map(row -> recentProjects(row.snapshot()))
                .orElseGet(List::of);
        List<DesktopWorkspaceBootstrapData.SkillSummary> skills = sessionContext.permissions().contains("skill.use")
                ? repository.findPublishedSkills(100).stream()
                    .map(item -> new DesktopWorkspaceBootstrapData.SkillSummary(
                            item.code(), item.displayName(), item.version(), item.description()
                    )).toList()
                : List.of();
        return new DesktopWorkspaceBootstrapData(accounts, projects, skills);
    }

    private void require(SessionContext context, String permission, String code) {
        if (context.clientType() != ClientType.DESKTOP || !context.permissions().contains(permission)) {
            throw new ApiException(HttpStatus.FORBIDDEN, code, "当前账号没有执行此桌面操作的权限");
        }
    }

    private Map<String, Object> validateSnapshot(Map<String, Object> value) {
        Object normalized = normalizeValue(value, "snapshot", 0);
        if (!(normalized instanceof Map<?, ?> map)) {
            throw invalidSnapshot("快照必须是对象");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) map;
        return result;
    }

    private Object normalizeValue(Object value, String path, int depth) {
        if (depth > MAX_DEPTH) throw invalidSnapshot("快照嵌套层级过深");
        if (value == null || value instanceof Boolean || value instanceof Number) return value;
        if (value instanceof String text) {
            if (text.length() > 32_000) throw invalidSnapshot("快照文本字段过长");
            if (LOCAL_PATH.matcher(text.trim()).find()) throw invalidSnapshot("快照不能包含本地文件路径");
            return text;
        }
        if (value instanceof List<?> list) {
            if (list.size() > MAX_ARRAY_ITEMS) throw invalidSnapshot("快照数组过大");
            List<Object> copy = new ArrayList<>(list.size());
            for (int index = 0; index < list.size(); index++) {
                copy.add(normalizeValue(list.get(index), path + "[" + index + "]", depth + 1));
            }
            return java.util.Collections.unmodifiableList(copy);
        }
        if (value instanceof Map<?, ?> map) {
            if (map.size() > MAX_OBJECT_KEYS) throw invalidSnapshot("快照对象字段过多");
            LinkedHashMap<String, Object> copy = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String key) || key.isBlank()) throw invalidSnapshot("快照字段名无效");
                if (FORBIDDEN_KEYS.contains(normalizeKey(key))) throw invalidSnapshot("快照包含敏感字段：" + key);
                copy.put(key, normalizeValue(entry.getValue(), path + "." + key, depth + 1));
            }
            return java.util.Collections.unmodifiableMap(copy);
        }
        throw invalidSnapshot("快照包含不支持的数据类型：" + path);
    }

    private List<DesktopWorkspaceBootstrapData.RecentProjectSummary> recentProjects(Map<String, Object> snapshot) {
        Object projectsValue = snapshot.get("projects");
        if (!(projectsValue instanceof List<?> projects)) return List.of();
        return projects.stream()
                .filter(Map.class::isInstance)
                .map(Map.class::cast)
                .filter(project -> project.get("deletedAt") == null)
                .map(project -> new DesktopWorkspaceBootstrapData.RecentProjectSummary(
                        text(project.get("id"), 100),
                        text(project.get("name"), 160),
                        parseInstant(project.get("updatedAt"))
                ))
                .filter(project -> !project.id().isBlank() && !project.name().isBlank())
                .sorted((left, right) -> compareInstant(right.updatedAt(), left.updatedAt()))
                .limit(10)
                .toList();
    }

    private int compareInstant(Instant left, Instant right) {
        if (left == null && right == null) return 0;
        if (left == null) return -1;
        if (right == null) return 1;
        return left.compareTo(right);
    }

    private Instant parseInstant(Object value) {
        try { return Instant.parse(String.valueOf(value)); } catch (Exception ignored) { return null; }
    }

    private String text(Object value, int limit) {
        String text = value == null ? "" : String.valueOf(value).trim();
        return text.length() <= limit ? text : text.substring(0, limit);
    }

    private String normalizeAccountId(String value) {
        String accountId = value == null ? "" : value.trim();
        if (!ACCOUNT_ID.matcher(accountId).matches()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DOUBAO_ACCOUNT_INVALID", "豆包账号标识无效");
        }
        return accountId;
    }

    private String cleanNullable(String value) {
        if (value == null) return null;
        String result = value.trim();
        return result.isEmpty() ? null : result;
    }

    private String normalizeKey(String key) {
        return key.replaceAll("[^A-Za-z0-9]", "").toLowerCase(Locale.ROOT);
    }

    private ApiException invalidSnapshot(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "DESKTOP_WORKSPACE_INVALID", message);
    }

    private String writeJson(Map<String, Object> value) {
        try { return objectMapper.writeValueAsString(value); }
        catch (Exception exception) { throw invalidSnapshot("快照无法序列化"); }
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private DesktopWorkspaceSnapshotResponse snapshotResponse(DesktopWorkspaceRepository.SnapshotRow row) {
        return new DesktopWorkspaceSnapshotResponse(row.revision(), row.snapshot(), row.contentHash(), row.updatedAt());
    }

    private DesktopDoubaoAccountResponse accountResponse(DesktopWorkspaceRepository.DoubaoAccountRow row) {
        return new DesktopDoubaoAccountResponse(
                row.accountId(), row.displayName(), row.loginState(), row.loginSummary(),
                row.lastCheckedAt(), row.updatedAt(), row.rowVersion()
        );
    }
}
