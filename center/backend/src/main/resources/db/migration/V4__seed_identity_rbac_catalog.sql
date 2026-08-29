SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'RBAC migrations must run as lingframe_owner';
    END IF;
END
$$;

INSERT INTO identity.roles (id, code, display_name, description, role_scope, is_system)
VALUES
    ('10000000-0000-4000-8000-000000000001', 'platform_admin', '平台管理员', '平台全局管理角色，只能通过独立平台角色分配获得。', 'platform', true),
    ('10000000-0000-4000-8000-000000000002', 'owner', '租户所有者', '租户最高管理角色，同时可以使用桌面创作能力。', 'tenant', true),
    ('10000000-0000-4000-8000-000000000003', 'admin', '租户管理员', '管理成员、角色、设备、会话和租户功能配置。', 'tenant', true),
    ('10000000-0000-4000-8000-000000000004', 'operator', '运营操作员', '执行租户日常运营并使用桌面创作能力。', 'tenant', true),
    ('10000000-0000-4000-8000-000000000005', 'viewer', '管理中心只读人员', '只读查看租户管理数据，不包含桌面创作权限。', 'tenant', true),
    ('10000000-0000-4000-8000-000000000006', 'member', '普通使用者', '桌面端默认角色，只拥有创作和本人数据使用权限。', 'tenant', true);

INSERT INTO identity.permissions (id, code, display_name, description, client_type)
VALUES
    ('20000000-0000-4000-8000-000000000001', 'desktop.bootstrap', '加载桌面工作台', '读取桌面端启动所需的使用权限和目录摘要。', 'desktop'),
    ('20000000-0000-4000-8000-000000000002', 'project.use', '使用项目', '创建、读取和维护本人当前租户的创作项目。', 'desktop'),
    ('20000000-0000-4000-8000-000000000003', 'asset.use', '使用素材', '上传、预览、复制和删除本人当前租户的素材。', 'desktop'),
    ('20000000-0000-4000-8000-000000000004', 'task.use', '使用任务中心', '提交、查看和处理本人当前租户的创作任务。', 'desktop'),
    ('20000000-0000-4000-8000-000000000005', 'creation.use', '使用创作能力', '使用文本、图片和视频创作功能。', 'desktop'),
    ('20000000-0000-4000-8000-000000000006', 'model.use', '调用模型', '查询并调用当前租户已授权的模型。', 'desktop'),
    ('20000000-0000-4000-8000-000000000007', 'skill.use', '调用 Skill', '查询并调用当前租户已授权的平台 Skill。', 'desktop'),
    ('20000000-0000-4000-8000-000000000008', 'doubao_account.use', '使用豆包账号', '使用当前租户允许的豆包账号执行创作任务。', 'desktop'),
    ('20000000-0000-4000-8000-000000000009', 'credits.self.read', '查看本人积分', '查看当前用户个人积分余额和流水摘要。', 'desktop'),
    ('20000000-0000-4000-8000-000000000010', 'credits.self.recharge', '充值本人积分', '为当前用户个人钱包创建充值订单。', 'desktop'),
    ('20000000-0000-4000-8000-000000000011', 'sync.use', '使用数据同步', '同步当前租户允许的项目元数据和业务数据。', 'desktop'),
    ('20000000-0000-4000-8000-000000000012', 'tenant.read', '查看租户', '查看当前租户基础信息和状态。', 'management_web'),
    ('20000000-0000-4000-8000-000000000013', 'tenant.manage', '管理租户', '修改租户配置、暂停或关闭租户。', 'management_web'),
    ('20000000-0000-4000-8000-000000000014', 'membership.read', '查看成员', '查看当前租户的 Membership。', 'management_web'),
    ('20000000-0000-4000-8000-000000000015', 'membership.invite', '邀请成员', '创建、撤销和重新发送租户邀请。', 'management_web'),
    ('20000000-0000-4000-8000-000000000016', 'membership.manage', '管理成员', '暂停、恢复或移除租户成员。', 'management_web'),
    ('20000000-0000-4000-8000-000000000017', 'role.read', '查看角色', '查看系统角色和权限目录。', 'management_web'),
    ('20000000-0000-4000-8000-000000000018', 'role.assign', '分配角色', '为租户成员分配允许的系统角色。', 'management_web'),
    ('20000000-0000-4000-8000-000000000019', 'permission_policy.read', '查看权限策略', '查看权限覆盖和功能策略。', 'management_web'),
    ('20000000-0000-4000-8000-000000000020', 'permission_policy.manage', '管理权限策略', '创建、撤销权限覆盖和功能策略。', 'management_web'),
    ('20000000-0000-4000-8000-000000000021', 'device.read', '查看设备', '查看当前租户设备和可信状态。', 'management_web'),
    ('20000000-0000-4000-8000-000000000022', 'device.manage', '管理设备', '信任、阻止或解除当前租户设备。', 'management_web'),
    ('20000000-0000-4000-8000-000000000023', 'session.read', '查看会话', '查看当前租户用户会话。', 'management_web'),
    ('20000000-0000-4000-8000-000000000024', 'session.revoke', '撤销会话', '强制撤销当前租户用户会话。', 'management_web'),
    ('20000000-0000-4000-8000-000000000025', 'tenant_model.read', '查看租户模型策略', '查看当前租户可用模型和启停策略。', 'management_web'),
    ('20000000-0000-4000-8000-000000000026', 'tenant_model.manage', '管理租户模型策略', '启停和配置当前租户可用模型。', 'management_web'),
    ('20000000-0000-4000-8000-000000000027', 'tenant_skill.read', '查看租户 Skill 策略', '查看当前租户可用平台 Skill。', 'management_web'),
    ('20000000-0000-4000-8000-000000000028', 'tenant_skill.manage', '管理租户 Skill 策略', '启停和配置当前租户的平台 Skill。', 'management_web'),
    ('20000000-0000-4000-8000-000000000029', 'audit.read', '查看审计', '查看权限允许范围内的安全和业务审计记录。', 'management_web'),
    ('20000000-0000-4000-8000-000000000030', 'user.read', '查看全局用户', '查看平台全局用户信息。', 'management_web'),
    ('20000000-0000-4000-8000-000000000031', 'user.manage', '管理全局用户', '锁定、禁用或恢复平台用户。', 'management_web'),
    ('20000000-0000-4000-8000-000000000032', 'credits.manage', '管理积分', '查询并人工调整用户积分账务。', 'management_web'),
    ('20000000-0000-4000-8000-000000000033', 'model_catalog.read', '查看平台模型目录', '查看平台模型、能力和价格版本。', 'management_web'),
    ('20000000-0000-4000-8000-000000000034', 'model_catalog.manage', '管理平台模型目录', '新增和维护平台模型及服务端凭据引用。', 'management_web'),
    ('20000000-0000-4000-8000-000000000035', 'model_catalog.publish', '发布平台模型目录', '发布可供桌面端读取的模型目录版本。', 'management_web'),
    ('20000000-0000-4000-8000-000000000036', 'skill_catalog.read', '查看平台 Skill 目录', '查看平台 Skill 和版本状态。', 'management_web'),
    ('20000000-0000-4000-8000-000000000037', 'skill_catalog.upload', '上传平台 Skill', '上传待扫描和审核的平台 Skill 包。', 'management_web'),
    ('20000000-0000-4000-8000-000000000038', 'skill_catalog.review', '审核平台 Skill', '审核平台 Skill 的能力、依赖和安全状态。', 'management_web'),
    ('20000000-0000-4000-8000-000000000039', 'skill_catalog.publish', '发布平台 Skill', '签名并发布平台 Skill 版本。', 'management_web'),
    ('20000000-0000-4000-8000-000000000040', 'system.read', '查看系统状态', '查看平台服务状态和只读运行信息。', 'management_web'),
    ('20000000-0000-4000-8000-000000000041', 'system.manage', '管理系统', '执行平台级系统配置和高风险管理操作。', 'management_web');

-- 平台管理员只获得管理中心权限。桌面使用能力仍由其当前租户 Membership 角色提供。
INSERT INTO identity.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM identity.roles AS r
CROSS JOIN identity.permissions AS p
WHERE r.code = 'platform_admin'
  AND p.client_type = 'management_web';

-- owner/admin/operator/member 都是桌面使用者；viewer 是纯管理中心只读角色。
INSERT INTO identity.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM identity.roles AS r
CROSS JOIN identity.permissions AS p
WHERE r.code IN ('owner', 'admin', 'operator', 'member')
  AND p.client_type = 'desktop';

INSERT INTO identity.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM identity.roles AS r
CROSS JOIN identity.permissions AS p
WHERE r.code = 'owner'
  AND p.code IN (
      'tenant.read', 'tenant.manage',
      'membership.read', 'membership.invite', 'membership.manage',
      'role.read', 'role.assign',
      'permission_policy.read', 'permission_policy.manage',
      'device.read', 'device.manage',
      'session.read', 'session.revoke',
      'tenant_model.read', 'tenant_model.manage',
      'tenant_skill.read', 'tenant_skill.manage',
      'audit.read'
  );

INSERT INTO identity.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM identity.roles AS r
CROSS JOIN identity.permissions AS p
WHERE r.code = 'admin'
  AND p.code IN (
      'tenant.read',
      'membership.read', 'membership.invite', 'membership.manage',
      'role.read', 'role.assign',
      'permission_policy.read', 'permission_policy.manage',
      'device.read', 'device.manage',
      'session.read', 'session.revoke',
      'tenant_model.read', 'tenant_model.manage',
      'tenant_skill.read', 'tenant_skill.manage',
      'audit.read'
  );

INSERT INTO identity.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM identity.roles AS r
CROSS JOIN identity.permissions AS p
WHERE r.code = 'operator'
  AND p.code IN (
      'tenant.read', 'membership.read', 'role.read', 'permission_policy.read',
      'device.read', 'session.read',
      'tenant_model.read', 'tenant_model.manage',
      'tenant_skill.read', 'tenant_skill.manage',
      'audit.read'
  );

INSERT INTO identity.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM identity.roles AS r
CROSS JOIN identity.permissions AS p
WHERE r.code = 'viewer'
  AND p.code IN (
      'tenant.read', 'membership.read', 'role.read', 'permission_policy.read',
      'device.read', 'session.read', 'tenant_model.read', 'tenant_skill.read', 'audit.read'
  );
