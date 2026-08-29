(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  if (root) root.lingframeTextQualityCore = value;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const VERSION = 1;
  const MAX_TEXT_LENGTH = 500000;
  const MAX_ISSUES = 500;
  const CATEGORY_META = Object.freeze({
    continuity: Object.freeze({label:"连续性", description:"人物、时间线、场景与道具前后关系"}),
    spelling: Object.freeze({label:"错别字", description:"常见错词、重复词和用字提醒"}),
    format: Object.freeze({label:"格式段落", description:"标点、空白、段落和剧本/分镜字段"}),
    risk: Object.freeze({label:"表达风险", description:"敏感、绝对化、侵权暗示和广告风险"})
  });
  const EXPORT_FORMATS = Object.freeze({
    txt: Object.freeze({label:"TXT 正文", extension:"txt", mime:"text/plain;charset=utf-8"}),
    markdown: Object.freeze({label:"Markdown", extension:"md", mime:"text/markdown;charset=utf-8"}),
    json: Object.freeze({label:"JSON 工程稿", extension:"json", mime:"application/json;charset=utf-8"}),
    screenplay: Object.freeze({label:"剧本格式", extension:"screenplay.txt", mime:"text/plain;charset=utf-8"}),
    storyboard: Object.freeze({label:"分镜表 CSV", extension:"storyboard.csv", mime:"text/csv;charset=utf-8"})
  });

  const TYPO_RULES = Object.freeze([
    ["做为", "作为"], ["即使是", "即使（如语义无需“是”）"], ["必竟", "毕竟"], ["毕竞", "毕竟"],
    ["按排", "安排"], ["安份", "安分"], ["报歉", "抱歉"], ["抱怨报复", "抱怨、报复（请核对语义）"],
    ["爆光", "曝光"], ["辩别", "辨别"], ["部暑", "部署"], ["布署", "部署"],
    ["仓桑", "沧桑"], ["重迭", "重叠"], ["粗旷", "粗犷"], ["耽阁", "耽搁"],
    ["担误", "耽误"], ["抵毁", "诋毁"], ["渡假", "度假"], ["防碍", "妨碍"],
    ["幅射", "辐射"], ["付合", "符合"], ["哈蜜瓜", "哈密瓜"], ["寒喧", "寒暄"],
    ["侯车", "候车"], ["既然是", "既然（请核对是否赘词）"], ["娇揉造作", "矫揉造作"], ["竟争", "竞争"],
    ["决对", "绝对"], ["刻服", "克服"], ["宽洪大量", "宽宏大量"], ["腊烛", "蜡烛"],
    ["兰球", "篮球"], ["滥芋充数", "滥竽充数"], ["了望", "瞭望"], ["零晨", "凌晨"],
    ["流览", "浏览"], ["罗唆", "啰嗦"], ["麻疯", "麻风"], ["冒然", "贸然"],
    ["名信片", "明信片"], ["默守成规", "墨守成规"], ["呕气", "怄气"], ["迫不急待", "迫不及待"],
    ["启封", "起封（如指拆封；请核对语义）"], ["起迄", "起讫"], ["迁徒", "迁徙"], ["如法泡制", "如法炮制"],
    ["松驰", "松弛"], ["题纲", "提纲"], ["通辑", "通缉"], ["推委", "推诿"],
    ["污告", "诬告"], ["无尚", "无上"], ["弦律", "旋律"], ["渲泄", "宣泄"],
    ["延申", "延伸"], ["一愁莫展", "一筹莫展"], ["尤如", "犹如"], ["原故", "缘故"],
    ["再接再励", "再接再厉"], ["帐蓬", "帐篷"], ["照像", "照相"], ["震憾", "震撼"],
    ["姿式", "姿势"], ["走头无路", "走投无路"], ["坐阵", "坐镇"], ["帐号", "账号"]
  ]);

  const RISK_RULES = Object.freeze([
    {code:"ad-absolute", severity:"high", pattern:/(国家级|世界级|最高级|最佳|第一品牌|行业第一|全网第一|唯一|顶级|极品|绝无仅有|史无前例)/g, title:"绝对化或排名表达", suggestion:"改为有证据支持、范围明确且可核验的描述。"},
    {code:"ad-guarantee", severity:"high", pattern:/(保证通过|保证成功|百分之百|100\s*%\s*(?:有效|成功|通过)|永久有效|永不|零风险|无任何风险|绝对安全)/gi, title:"保证性承诺", suggestion:"说明适用条件、限制和真实依据，避免无条件保证。"},
    {code:"medical-claim", severity:"high", pattern:/(包治百病|药到病除|根治|彻底治愈|无副作用|立刻见效|七天瘦|快速治愈)/g, title:"医疗或功效承诺风险", suggestion:"删除未经审查的疗效承诺，并交由专业合规人员复核。"},
    {code:"finance-claim", severity:"high", pattern:/(稳赚不赔|保本保收益|零风险投资|躺赚| guaranteed return)/gi, title:"金融收益承诺风险", suggestion:"不要承诺收益或淡化风险；补充清晰、真实的风险说明。"},
    {code:"scarcity-pressure", severity:"medium", pattern:/(仅限今天|最后\d+名|不买就亏|马上抢|错过不再|点击立即领取)/g, title:"紧迫或诱导表达", suggestion:"核对活动真实性、适用条件和有效期，避免误导性催促。"},
    {code:"infringement-implication", severity:"medium", pattern:/(官方同款|一比一复刻|高仿|盗版|破解授权|免授权商用|随意使用名人肖像)/g, title:"侵权或授权暗示", suggestion:"确认商标、版权、肖像和素材授权，不要把未授权内容描述为可自由使用。"},
    {code:"discrimination", severity:"medium", pattern:/(只限男性|只限女性|拒绝孕妇|地域歧视|种族优越)/g, title:"歧视性表达风险", suggestion:"核对表达必要性和合法依据，改用中性、包容且与场景相关的条件。"}
  ]);

  const clean = (value, max = MAX_TEXT_LENGTH) => String(value ?? "").replace(/\u0000/g, "").slice(0, max);
  const clone = value => JSON.parse(JSON.stringify(value == null ? null : value));
  const normalizeName = value => clean(value, 300).trim().replace(/[\s·•・]/g, "").toLowerCase();
  const splitNames = value => clean(value, 3000).split(/[、，,；;\/|和与及\s]+/).map(item => item.trim()).filter(Boolean);
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function fingerprint(value) {
    const text = clean(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
  }

  function lineInfo(text, offset) {
    const safeOffset = Math.max(0, Math.min(text.length, Number(offset) || 0));
    const before = text.slice(0, safeOffset);
    const lines = before.split("\n");
    return {line:lines.length, column:(lines[lines.length - 1] || "").length + 1};
  }

  function excerpt(text, start, end) {
    if (!text) return "";
    const from = Math.max(0, start - 24);
    const to = Math.min(text.length, Math.max(end, start + 1) + 36);
    return text.slice(from, to).replace(/\s+/g, " ").trim();
  }

  function createCollector(text, enabled) {
    const issues = [];
    const seen = new Set();
    const add = input => {
      if (!input || !enabled.has(input.category) || issues.length >= MAX_ISSUES) return;
      const start = input.source === "structure" ? -1 : (Number.isFinite(input.start) ? Math.max(0, input.start) : -1);
      const end = Number.isFinite(input.end) ? Math.max(start, input.end) : start;
      const key = `${input.category}|${input.code}|${start}|${input.message || input.title}`;
      if (seen.has(key)) return;
      seen.add(key);
      const position = start >= 0 ? lineInfo(text, start) : {line:0, column:0};
      issues.push({
        id:`issue-${issues.length + 1}-${fingerprint(key).slice(6, 14)}`,
        category:input.category,
        code:clean(input.code, 100),
        severity:["high", "medium", "low", "info"].includes(input.severity) ? input.severity : "medium",
        title:clean(input.title, 200),
        message:clean(input.message || input.title, 1000),
        suggestion:clean(input.suggestion, 1000),
        source:input.source === "structure" ? "structure" : "text",
        start, end, line:position.line, column:position.column,
        excerpt:input.excerpt !== undefined ? clean(input.excerpt, 500) : (start >= 0 ? excerpt(text, start, end) : ""),
        structureRef:input.structureRef ? clone(input.structureRef) : null
      });
    };
    return {issues, add};
  }

  function scanExact(text, collector) {
    TYPO_RULES.forEach(([wrong, suggestion]) => {
      let offset = 0;
      while ((offset = text.indexOf(wrong, offset)) >= 0) {
        collector.add({category:"spelling", code:"common-typo", severity:"medium", title:`疑似错词“${wrong}”`, message:`发现常见错词“${wrong}”。`, suggestion:`建议核对为“${suggestion}”，不要直接批量替换。`, start:offset, end:offset + wrong.length});
        offset += Math.max(1, wrong.length);
      }
    });
    const repeat = /([\u4e00-\u9fff]{1,3})(?:\s*)\1/g;
    let match;
    while ((match = repeat.exec(text))) {
      if (["人人", "天天", "渐渐", "慢慢", "常常", "看看", "想想", "试试", "谢谢", "仅仅", "偏偏", "纷纷", "往往"].includes(match[0].replace(/\s/g, ""))) continue;
      collector.add({category:"spelling", code:"duplicate-word", severity:"low", title:"疑似重复词", message:`“${match[0]}”可能是输入重复，也可能是有意修辞。`, suggestion:"结合上下文人工确认是否保留。", start:match.index, end:match.index + match[0].length});
    }
  }

  function scanFormat(text, type, structure, collector) {
    const rules = [
      {pattern:/[ \t]+$/gm, code:"trailing-space", title:"行尾有多余空白", message:"行尾空格可能造成导出排版差异。", suggestion:"人工确认后删除行尾空格。", severity:"low"},
      {pattern:/\t+/g, code:"tab-character", title:"包含制表符", message:"制表符在不同编辑器中的宽度可能不同。", suggestion:"需要稳定排版时改用统一空格或结构字段。", severity:"low"},
      {pattern:/\n{4,}/g, code:"blank-lines", title:"连续空行过多", message:"发现三行以上连续空行。", suggestion:"核对是否为有意分隔，必要时收敛为空一行。", severity:"low"},
      {pattern:/([。！？!?，,；;：:])\1+/g, code:"repeat-punctuation", title:"标点重复", message:"发现连续重复标点。", suggestion:"核对情绪表达需要，正式稿建议统一标点数量。", severity:"low"},
      {pattern:/[\u4e00-\u9fff][,:;!?][\u4e00-\u9fff]/g, code:"ascii-punctuation", title:"中文句中使用半角标点", message:"中文上下文中出现半角英文标点。", suggestion:"核对目标平台格式，必要时改为中文全角标点。", severity:"low", position:1}
    ];
    rules.forEach(rule => {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(text))) {
        const start = match.index + (rule.position || 0);
        collector.add({category:"format", code:rule.code, severity:rule.severity, title:rule.title, message:rule.message, suggestion:rule.suggestion, start, end:start + (rule.position ? 1 : match[0].length)});
        if (!match[0].length) rule.pattern.lastIndex += 1;
      }
    });

    const pairs = [["“", "”", "中文双引号"], ["‘", "’", "中文单引号"], ["（", "）", "圆括号"], ["《", "》", "书名号"], ["【", "】", "方头括号"]];
    pairs.forEach(([open, close, label]) => {
      const openCount = text.split(open).length - 1;
      const closeCount = text.split(close).length - 1;
      if (openCount !== closeCount) collector.add({category:"format", code:"unbalanced-pair", severity:"medium", title:`${label}未配对`, message:`${label}左侧 ${openCount} 个、右侧 ${closeCount} 个。`, suggestion:"逐处核对配对关系；本检查不会自动补齐。", start:-1, end:-1, source:"text"});
    });

    let cursor = 0;
    text.split(/\n{2,}/).forEach(paragraph => {
      const start = text.indexOf(paragraph, cursor);
      cursor = Math.max(cursor, start + paragraph.length);
      if (paragraph.trim().length > 1200) collector.add({category:"format", code:"long-paragraph", severity:"low", title:"段落过长", message:`当前段落约 ${paragraph.trim().length} 字，阅读和修订成本较高。`, suggestion:"按语义、动作或论点人工拆分段落。", start, end:start + Math.min(paragraph.length, 80)});
    });

    const templateId = structure?.templateId || "";
    const outline = Array.isArray(structure?.outline) ? structure.outline : [];
    if ((type === "剧本" || templateId === "script") && outline.length) {
      outline.filter(node => !node.parentId).forEach(node => {
        if (!clean(node?.fields?.sceneHeading, 500).trim()) collector.add({category:"format", code:"script-scene-heading", severity:"medium", title:"剧本场景缺少场景标头", message:`“${node.title || "未命名场景"}”尚未填写内/外景、地点和日/夜。`, suggestion:"在结构创作中补充场景标头后再导出剧本格式。", source:"structure", start:-1, end:-1, structureRef:{kind:"outline", id:node.id, title:node.title}});
      });
    }
    if ((type === "分镜" || templateId === "storyboard") && outline.length) {
      outline.forEach((node, index) => {
        const fields = node?.fields || {};
        const missing = ["visual", "duration"].filter(key => !clean(fields[key], 1000).trim());
        if (missing.length) collector.add({category:"format", code:"storyboard-required-fields", severity:"medium", title:"分镜关键字段不完整", message:`第 ${index + 1} 个镜头“${node.title || "未命名"}”缺少${missing.includes("visual") ? "画面" : ""}${missing.length > 1 ? "和" : ""}${missing.includes("duration") ? "时长" : ""}。`, suggestion:"在结构创作中补齐关键字段后再导出分镜表。", source:"structure", start:-1, end:-1, structureRef:{kind:"outline", id:node.id, title:node.title}});
      });
    }
  }

  function scanRisk(text, collector) {
    RISK_RULES.forEach(rule => {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(text))) {
        collector.add({category:"risk", code:rule.code, severity:rule.severity, title:rule.title, message:`发现“${match[0]}”，可能需要合规、事实或授权复核。`, suggestion:rule.suggestion, start:match.index, end:match.index + match[0].length});
        if (!match[0].length) rule.pattern.lastIndex += 1;
      }
    });
  }

  function chineseNumber(value) {
    if (/^\d+$/.test(value)) return Number(value);
    const digits = {零:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9};
    if (value === "十") return 10;
    if (value.includes("十")) {
      const [left, right] = value.split("十");
      return (left ? digits[left] || 0 : 1) * 10 + (right ? digits[right] || 0 : 0);
    }
    return digits[value];
  }

  function timeRank(value) {
    const text = clean(value, 300).trim();
    if (!text) return null;
    const date = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(text);
    if (date) return Number(date[1]) * 10000 + Number(date[2]) * 100 + Number(date[3]);
    const day = /第\s*([\d一二两三四五六七八九十]+)\s*(?:天|日)/.exec(text);
    if (day) {
      const number = chineseNumber(day[1]);
      if (Number.isFinite(number)) return number * 10000;
    }
    const clock = /(\d{1,2})[:：](\d{2})/.exec(text);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
    const chapter = /第\s*([\d一二两三四五六七八九十]+)\s*(?:章|幕|集|场)/.exec(text);
    if (chapter) {
      const number = chineseNumber(chapter[1]);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function scanPropContinuity(text, collector) {
    const terminalPattern = /([\u4e00-\u9fffA-Za-z0-9]{1,12}?)(?:已经|被|彻底|突然|当场)?(损坏|破碎|摧毁|烧毁|丢失|遗失|不见)/g;
    let terminal;
    while ((terminal = terminalPattern.exec(text))) {
      const prop = terminal[1].replace(/^(把|将|那把|这把|一个|一件|那件|这件)/, "");
      if (prop.length < 2) continue;
      const remaining = text.slice(terminal.index + terminal[0].length);
      const actions = "拿出|取出|使用|握着|完好|递给|重新出现|再次出现";
      const candidates = [
        new RegExp(`${escapeRegExp(prop)}.{0,12}(${actions})`, "g").exec(remaining),
        new RegExp(`(${actions}).{0,12}${escapeRegExp(prop)}`, "g").exec(remaining)
      ].filter(Boolean).sort((a, b) => a.index - b.index);
      const active = candidates[0];
      if (!active) continue;
      const between = remaining.slice(0, active.index);
      const restored = new RegExp(`${escapeRegExp(prop)}.{0,16}(修复|修好|找回|寻回|捡回|替换|重建|重新获得)`).test(between);
      if (!restored) {
        const start = terminal.index + terminal[0].length + active.index;
        collector.add({category:"continuity", code:"prop-state", severity:"medium", title:"道具状态可能不连续", message:`“${prop}”在前文已${terminal[2]}，后文又出现“${active[1]}”状态。`, suggestion:"核对中间是否缺少找回、修复、替换或状态转换说明。", start, end:start + active[0].length});
      }
    }
  }

  function scanAppearance(text, characters, collector) {
    const groups = [
      ["黑发", "白发", "金发", "红发", "蓝发", "银发"],
      ["黑眼", "蓝眼", "绿眼", "红眼", "金瞳", "紫瞳"],
      ["红裙", "白裙", "黑裙", "蓝裙"],
      ["长发", "短发"]
    ];
    characters.forEach(character => {
      const name = clean(character?.name, 200).trim();
      const appearance = clean(character?.appearance, 2000);
      if (!name || !appearance) return;
      groups.forEach(group => {
        const declared = group.find(item => appearance.includes(item));
        if (!declared) return;
        group.filter(item => item !== declared).forEach(conflict => {
          const pattern = new RegExp(`${escapeRegExp(name)}[^。！？\\n]{0,28}${escapeRegExp(conflict)}`, "g");
          let match;
          while ((match = pattern.exec(text))) collector.add({category:"continuity", code:"character-appearance", severity:"medium", title:"人物外观可能冲突", message:`人物卡中“${name}”为“${declared}”，正文附近出现“${conflict}”。`, suggestion:"核对是否为换装、染发、光线影响或设定变化，并补充过渡说明。", start:match.index, end:match.index + match[0].length, structureRef:{kind:"character", id:character.id, title:name}});
        });
      });
    });
  }

  function scanContinuity(text, structure, collector) {
    scanPropContinuity(text, collector);
    if (!structure || typeof structure !== "object") return;
    const characters = Array.isArray(structure.characters) ? structure.characters : [];
    const timeline = Array.isArray(structure.timeline) ? structure.timeline : [];
    const outline = Array.isArray(structure.outline) ? structure.outline : [];
    const characterNames = new Map();
    characters.forEach(character => {
      const name = clean(character?.name, 200).trim();
      if (!name) return;
      const normalized = normalizeName(name);
      if (characterNames.has(normalized)) collector.add({category:"continuity", code:"duplicate-character", severity:"medium", title:"人物卡名称重复", message:`人物“${name}”存在多张人物卡，连续性检查可能产生歧义。`, suggestion:"合并重复人物卡，或为不同人物设置可区分的正式名称。", source:"structure", start:-1, end:-1, structureRef:{kind:"character", id:character.id, title:name}});
      else characterNames.set(normalized, character);
      if (text && !text.includes(name)) collector.add({category:"continuity", code:"unused-character", severity:"info", title:"人物尚未在正文出现", message:`人物卡“${name}”暂未在当前正文中出现。`, suggestion:"如这是未登场人物可忽略；否则核对姓名写法或正文遗漏。", source:"structure", start:-1, end:-1, structureRef:{kind:"character", id:character.id, title:name}});
    });
    scanAppearance(text, characters, collector);

    if (characterNames.size) {
      const references = [];
      outline.forEach(node => [node?.fields?.characters, node?.fields?.povCharacter].forEach(value => splitNames(value).forEach(name => references.push({name, kind:"outline", item:node}))));
      timeline.forEach(item => splitNames(item?.participants).forEach(name => references.push({name, kind:"timeline", item})));
      references.forEach(reference => {
        if (!reference.name || characterNames.has(normalizeName(reference.name))) return;
        collector.add({category:"continuity", code:"unknown-character-reference", severity:"medium", title:"人物引用未对应人物卡", message:`结构记录引用了“${reference.name}”，但人物卡中没有同名记录。`, suggestion:"核对姓名、别名或补充人物卡。", source:"structure", start:-1, end:-1, structureRef:{kind:reference.kind, id:reference.item?.id, title:reference.item?.title || reference.item?.label || reference.name}});
      });
    }

    let previousRank = null;
    timeline.forEach((item, index) => {
      const rank = timeRank(item?.time);
      if (rank !== null && previousRank !== null && rank < previousRank) collector.add({category:"continuity", code:"timeline-order", severity:"high", title:"时间线顺序可能倒退", message:`第 ${index + 1} 条“${item.label || "未命名事件"}”的时间“${item.time}”早于上一条可解析时间。`, suggestion:"核对事件排序，或使用可比较的日期、第 N 天、章节/场次和时刻写法。", source:"structure", start:-1, end:-1, structureRef:{kind:"timeline", id:item.id, title:item.label}});
      if (rank !== null) previousRank = rank;
      if (!clean(item?.time, 300).trim()) collector.add({category:"continuity", code:"timeline-missing-time", severity:"low", title:"时间线事件缺少时间", message:`“${item?.label || "未命名事件"}”没有时间信息，无法参与顺序检查。`, suggestion:"补充日期、第 N 天、章节/场次或明确时刻。", source:"structure", start:-1, end:-1, structureRef:{kind:"timeline", id:item?.id, title:item?.label}});
    });

    const timelineNames = new Map();
    timeline.forEach(item => {
      const key = normalizeName(item?.label);
      if (!key) return;
      const previous = timelineNames.get(key);
      if (previous && clean(previous.location, 300).trim() && clean(item.location, 300).trim() && previous.location !== item.location) collector.add({category:"continuity", code:"timeline-location", severity:"medium", title:"同名事件地点不一致", message:`时间线事件“${item.label}”分别出现在“${previous.location}”和“${item.location}”。`, suggestion:"核对是否为重复事件、地点移动或命名冲突。", source:"structure", start:-1, end:-1, structureRef:{kind:"timeline", id:item.id, title:item.label}});
      else timelineNames.set(key, item);
    });

    const ids = new Set(outline.map(item => item?.id));
    const sceneNames = new Map();
    outline.forEach(node => {
      if (node?.parentId && !ids.has(node.parentId)) collector.add({category:"continuity", code:"orphan-outline", severity:"high", title:"结构节点失去上级", message:`“${node.title || "未命名节点"}”引用的上级不存在。`, suggestion:"在结构创作中重新指定上级，避免导出顺序异常。", source:"structure", start:-1, end:-1, structureRef:{kind:"outline", id:node.id, title:node.title}});
      const key = normalizeName(node?.title);
      const location = clean(node?.fields?.location || node?.fields?.sceneHeading, 500).trim();
      if (!key || !location) return;
      const previous = sceneNames.get(key);
      if (previous && previous.location !== location) collector.add({category:"continuity", code:"scene-location", severity:"medium", title:"同名场景地点描述不一致", message:`“${node.title}”分别使用“${previous.location}”和“${location}”。`, suggestion:"核对是否为地点变化、重名场景或场景标头不统一。", source:"structure", start:-1, end:-1, structureRef:{kind:"outline", id:node.id, title:node.title}});
      else sceneNames.set(key, {location, node});
    });
  }

  function checkText(input = {}) {
    const text = clean(input.text);
    const categories = Array.isArray(input.categories) && input.categories.length ? input.categories : Object.keys(CATEGORY_META);
    const enabled = new Set(categories.filter(key => CATEGORY_META[key]));
    const collector = createCollector(text, enabled);
    if (enabled.has("spelling")) scanExact(text, collector);
    if (enabled.has("format")) scanFormat(text, clean(input.type, 80), input.structure, collector);
    if (enabled.has("risk")) scanRisk(text, collector);
    if (enabled.has("continuity")) scanContinuity(text, input.structure, collector);
    const severityOrder = {high:0, medium:1, low:2, info:3};
    collector.issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || (a.start < 0 ? 1 : b.start < 0 ? -1 : a.start - b.start));
    const counts = {total:collector.issues.length, high:0, medium:0, low:0, info:0, continuity:0, spelling:0, format:0, risk:0};
    collector.issues.forEach(issue => { counts[issue.severity] += 1; counts[issue.category] += 1; });
    return {
      schemaVersion:VERSION,
      checkedAt:new Date().toISOString(),
      fingerprint:fingerprint(text),
      textLength:text.length,
      truncated:String(input.text ?? "").length > text.length,
      categories:[...enabled],
      counts,
      issues:collector.issues,
      disclaimer:"检查结果仅作辅助定位和风险提示，不会自动修改正文，也不能替代人工校对、法律或平台合规审核。"
    };
  }

  function safeFilename(value) {
    const name = clean(value, 120).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "");
    return name || "未命名创作";
  }

  function safeFieldMap(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const blocked = /(api[-_]?key|cookie|authorization|auth(?:entication)?|token|secret|base[-_]?url|service[-_]?url|account[-_]?profile|credential|password)/i;
    const output = {};
    Object.entries(input).forEach(([key, value]) => {
      if (blocked.test(key)) return;
      if (["string", "number", "boolean"].includes(typeof value) || value == null) output[clean(key, 100)] = clean(value, 8000);
    });
    return output;
  }

  function safeStructure(structure) {
    if (!structure || typeof structure !== "object") return null;
    const fields = safeFieldMap(structure.fields);
    const outline = (Array.isArray(structure.outline) ? structure.outline : []).map(node => ({
      id:clean(node?.id, 100), parentId:clean(node?.parentId, 100), kind:clean(node?.kind, 80), title:clean(node?.title, 300), fields:safeFieldMap(node?.fields)
    }));
    const select = (list, keys) => (Array.isArray(list) ? list : []).map(item => Object.fromEntries(keys.map(key => [key, clean(item?.[key], 8000)])));
    return {
      templateId:clean(structure.templateId, 80),
      type:clean(structure.type, 80),
      fields,
      outline,
      characters:select(structure.characters, ["name", "role", "goal", "conflict", "appearance", "voice", "relationships", "notes"]),
      world:select(structure.world, ["name", "category", "rule", "description", "notes"]),
      timeline:select(structure.timeline, ["label", "time", "location", "participants", "event", "consequence"]),
      variables:select(structure.variables, ["name", "placeholder", "value", "notes"])
    };
  }

  function structureMarkdown(structure) {
    const safe = safeStructure(structure);
    if (!safe) return "";
    const lines = [];
    const fields = Object.entries(safe.fields).filter(([, value]) => String(value ?? "").trim());
    if (fields.length) {
      lines.push("## 结构字段", "");
      fields.forEach(([key, value]) => lines.push(`- ${key}：${clean(value, 8000)}`));
      lines.push("");
    }
    if (safe.outline.length) {
      lines.push("## 结构目录", "");
      safe.outline.forEach(node => {
        lines.push(`### ${node.title || node.kind || "未命名节点"}`);
        Object.entries(node.fields || {}).filter(([, value]) => String(value ?? "").trim()).forEach(([key, value]) => lines.push(`- ${key}：${clean(value, 8000)}`));
        lines.push("");
      });
    }
    [["人物卡", safe.characters, "name"], ["世界观", safe.world, "name"], ["时间线", safe.timeline, "label"], ["提示词变量", safe.variables, "name"]].forEach(([label, list, titleKey]) => {
      if (!list.length) return;
      lines.push(`## ${label}`, "");
      list.forEach(item => {
        lines.push(`### ${item[titleKey] || "未命名"}`);
        Object.entries(item).filter(([key, value]) => key !== titleKey && String(value ?? "").trim()).forEach(([key, value]) => lines.push(`- ${key}：${value}`));
        lines.push("");
      });
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function screenplayText(input) {
    const content = clean(input.content);
    const structure = safeStructure(input.structure);
    if (!structure || structure.templateId !== "script" || !structure.outline.length) return content;
    const lines = [`片名：${clean(input.title, 300) || "未命名创作"}`, `类型：${clean(input.type, 80) || "剧本"}`, ""];
    const roots = structure.outline.filter(node => !node.parentId);
    roots.forEach((scene, index) => {
      const fields = scene.fields || {};
      lines.push(`场次 ${index + 1}  ${clean(fields.sceneHeading, 500) || scene.title || "未命名场景"}`);
      if (fields.characters) lines.push(`出场人物：${fields.characters}`);
      if (fields.action) lines.push("", clean(fields.action, 8000));
      if (fields.dialogueGoal) lines.push("", `对白目标：${clean(fields.dialogueGoal, 8000)}`);
      if (fields.notes) lines.push("", `备注：${clean(fields.notes, 8000)}`);
      structure.outline.filter(node => node.parentId === scene.id).forEach(child => {
        lines.push("", `[${child.title || child.kind || "节拍"}]`);
        if (child.fields?.action) lines.push(clean(child.fields.action, 8000));
        if (child.fields?.dialogueGoal) lines.push(`对白目标：${clean(child.fields.dialogueGoal, 8000)}`);
      });
      lines.push("", "---", "");
    });
    if (content.trim()) lines.push("正文参考", "", content);
    return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
  }

  const csvCell = value => `"${clean(value, 20000).replace(/"/g, '""')}"`;
  function storyboardCsv(input) {
    const structure = safeStructure(input.structure);
    const headers = ["镜头号", "标题", "景别", "机位/运镜", "时长", "画面内容", "对白/字幕", "声音/音乐", "生成提示词", "备注"];
    let rows = [];
    if (structure?.outline?.length) {
      rows = structure.outline.map((node, index) => {
        const fields = node.fields || {};
        return [index + 1, node.title || node.kind, fields.shotSize, fields.camera, fields.duration, fields.visual || fields.summary, fields.dialogue, fields.sound, fields.prompt, fields.notes];
      });
    } else {
      rows = clean(input.content).split(/\n{2,}/).map(item => item.trim()).filter(Boolean).map((paragraph, index) => [index + 1, `镜头 ${index + 1}`, "", "", "", paragraph, "", "", "", "由正文段落生成的待整理行"]);
    }
    return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}`;
  }

  function buildExport(format, input = {}) {
    const meta = EXPORT_FORMATS[format];
    if (!meta) throw new Error("不支持的文本导出格式");
    const title = clean(input.title, 300) || "未命名创作";
    const type = clean(input.type, 80);
    const content = clean(input.content);
    const safe = safeStructure(input.structure);
    let output = "";
    if (format === "txt") output = content;
    if (format === "markdown") {
      const sections = [`# ${title}`, "", `> 创作类型：${type || "未分类"}`, "", content];
      const appendix = input.includeStructure === false ? "" : structureMarkdown(safe);
      if (appendix) sections.push("", appendix);
      output = sections.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
    }
    if (format === "json") {
      output = JSON.stringify({
        schemaVersion:1,
        exportedAt:new Date().toISOString(),
        title,
        type,
        projectId:clean(input.projectId, 200),
        conversationId:clean(input.conversationId, 200),
        content,
        structure:safe
      }, null, 2);
    }
    if (format === "screenplay") output = screenplayText({...input, title, type, content, structure:safe});
    if (format === "storyboard") output = storyboardCsv({...input, title, type, content, structure:safe});
    const suffix = meta.extension.includes(".") ? meta.extension : `${meta.extension}`;
    return {format, label:meta.label, filename:`${safeFilename(title)}.${suffix}`, mime:meta.mime, content:output};
  }

  return Object.freeze({
    VERSION, MAX_TEXT_LENGTH, MAX_ISSUES, CATEGORY_META, EXPORT_FORMATS, TYPO_RULES, RISK_RULES,
    fingerprint, checkText, safeFilename, safeStructure, structureMarkdown, screenplayText, storyboardCsv, buildExport, clone
  });
});
