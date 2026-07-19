/**
 * ============================================================================
 *  VECTOR LOCK — SOLO RUNTIME (embedded copy, identical in every feature pack)
 *  Copyright (c) 2026 p7x939. All Rights Reserved.
 * ----------------------------------------------------------------------------
 *  โหมดทำงานเดี่ยว: ใช้เมื่อไม่พบ Vector Lock Core ในโลก
 *  ให้ API หน้าตาเดียวกับ VLK ทุกอย่าง → โค้ดฟีเจอร์ไม่ต้องรู้ว่าอยู่โหมดไหน
 *
 *  - UI มีแค่ของแอดออนที่ติดตั้ง: 1 ตัว = เปิดฟอร์มตรงๆ, หลายตัว = เมนูเล็กๆ
 *  - แชร์ runtime เดียวกันทุกแพคผ่าน globalThis.__VLK_SOLO__ (config ไม่ชนกัน)
 *  - เซฟค่าลงคีย์เดิม vlk_cfg_* → ลง Core ทีหลัง ค่าที่ตั้งไว้ตามไปด้วย
 *  - แนะนำ Vector Lock Core เมื่อเล่น 2 แอดออนขึ้นไป (รวม tick loop เดียว,
 *    เมนูรวม, หน้า Status, สลับภาษา)
 * ============================================================================
 */

import { world, system, EquipmentSlot, GameMode } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

export function makeSolo(opts) {
    if (globalThis.__VLK_SOLO__) return globalThis.__VLK_SOLO__;
    // mode: "bridge"  = สมาชิก (เมนูรวมอยู่ที่ Core หรือแพคหัวหน้า)
    //       "host"    = หัวหน้าวง solo — โฮสต์เมนูรวมเองด้วยโปรโตคอล bridge ตัวเดิม
    //       "solo"    = เดี่ยวล้วน (ไม่มีใครอื่นเลย)
    const mode = opts && opts.bridge ? "bridge" : (opts && opts.host ? "host" : "solo");
    const S = buildRuntime(mode);
    globalThis.__VLK_SOLO__ = S;
    return S;
}

/* ---- โปรโตคอล vlk:* — เวอร์ชัน + ตัวตรวจ payload (กันแพคอื่นยิง event ปนเข้ามา) ---- */
const VLK_PROTO = 1;
const RE_FEATURE_ID = /^[a-z0-9_-]{1,32}$/i;
const RE_PLAYER_ID = /^-?\d{1,20}$/;
const MAX_REMOTE_FEATURES = 32;
function cleanLabel(s, fallback) {
    return typeof s === "string" && s.length ? s.slice(0, 120) : fallback;
}

/** ยิง scriptevent ข้ามแพค (Bedrock แยก context ต่อแพค — globalThis ไม่แชร์กัน) */
function sendEvent(id, msg) {
    try {
        const d = world.getDimension("minecraft:overworld");
        const cmd = "scriptevent " + id + " " + (msg === undefined || msg === "" ? "1" : msg);
        if (typeof d.runCommand === "function") d.runCommand(cmd);
        else if (typeof d.runCommandAsync === "function") d.runCommandAsync(cmd);
    } catch (_) { }
}

/**
 * หา Vector Lock Core / เพื่อนแพคด้วยกัน แล้วส่งรันไทม์ที่เหมาะสมให้ onReady(vlk):
 *  1. __VLK__ ใน context เดียวกัน (กรณีเกมรวม context) → ใช้ Core ตรงๆ
 *  2. ping/pong เจอ Core คนละ context → โหมด bridge (เมนูรวมอยู่ฝั่ง Core)
 *  3. ไม่มี Core แต่ได้ยิน hello จากแพค solo ด้วยกัน → เลือกหัวหน้า (nonce น้อยสุดชนะ):
 *       ชนะ → โหมด host: โฮสต์เมนูรวมเองเหมือนมินิ-Core
 *       แพ้ → โหมด bridge: ลงทะเบียนปุ่มกับหัวหน้า (โปรโตคอลเดียวกับคุยกับ Core)
 *  4. ไม่มีใครเลย → host เดี่ยว (= solo ปกติ)
 *  ทุกแพคยิง ping+hello พร้อมกันในหน้าต่าง ~3 วิ แล้วสรุปผลพร้อมกัน
 */
export function connectVLK(onReady) {
    if (globalThis.__VLK__) return onReady(globalThis.__VLK__);
    const WAIT_TICKS = 60; // ~3 วิ
    let done = false;
    let pong = false;
    // เลือกหัวหน้าด้วย nonce สุ่ม — ทุกแพคได้ยิน hello ครบในหน้าต่างเดียวกัน จึงสรุปตรงกัน
    const myNonce = Math.floor(Math.random() * 0xffffffff).toString(36) + "-" + Date.now().toString(36);
    let minPeer = null;
    const onEv = system.afterEvents.scriptEventReceive.subscribe((ev) => {
        try {
            if (ev.id === "vlk:pong") { pong = true; return; }
            if (ev.id === "vlk:hello") {
                const n = (ev.message || "").trim();
                if (n && (minPeer === null || n < minPeer)) minPeer = n;
            }
        } catch (_) { }
    });
    let tries = 0;
    const timer = system.runInterval(() => {
        try {
            if (done) return;
            if (globalThis.__VLK__) return finish(globalThis.__VLK__);
            if (pong) return finish(makeSolo({ bridge: true }));
            tries++;
            if (tries % 20 === 1) { // ยิงซ้ำทุก 1 วิ กันช่วงโลกเพิ่งโหลด
                sendEvent("vlk:ping", "1");
                sendEvent("vlk:hello", myNonce);
            }
            if (tries >= WAIT_TICKS) {
                // ไม่เจอ Core — ตัดสินหัวหน้าวง (ตัวเองอยู่ในวงเสมอ เพราะรับ hello ตัวเองด้วย)
                const isHost = minPeer === null || myNonce <= minPeer;
                finish(makeSolo(isHost ? { host: true } : { bridge: true }));
            }
        } catch (_) { }
    }, 1);
    function finish(vlk) {
        done = true;
        system.clearRun(timer);
        try { system.afterEvents.scriptEventReceive.unsubscribe(onEv); } catch (_) { }
        onReady(vlk);
    }
}

function buildRuntime(mode) {
    const bridge = mode === "bridge"; // สมาชิก: เมนูรวมอยู่ที่ Core/หัวหน้า
    const host = mode === "host";     // หัวหน้าวง solo: โฮสต์เมนูรวมเอง

    /* ------------------------------- state ------------------------------- */

    const SAVE_PREFIX = "vlk_";
    const KEY_CFG = (id) => SAVE_PREFIX + "cfg_" + id;
    const KEY_PTS = (id) => SAVE_PREFIX + "pts_" + id;
    const OWNER_TAG = "vlk_owner";
    const MAX_WAYPOINTS = 20;

    const configStore = new Map();
    const waypointsCache = new Map();
    const uiOpenState = new Map();
    const _featureDefaults = {};
    const _shared = new Map();

    function readJson(key) {
        try {
            const raw = world.getDynamicProperty(key);
            if (typeof raw === "string" && raw.length) return JSON.parse(raw);
        } catch (_) { }
        return null;
    }
    function writeJson(key, value) {
        try { world.setDynamicProperty(key, JSON.stringify(value)); } catch (_) { }
    }

    function contributeDefaults(obj) {
        try { Object.assign(_featureDefaults, obj); } catch (_) { }
    }
    function defaultSettings() {
        const base = { lang: "en", particles: true, sounds: true, maxWaypoints: 20 };
        return Object.assign(base, _featureDefaults);
    }
    function readConfig(playerId) {
        const stored = readJson(KEY_CFG(playerId));
        const base = defaultSettings();
        return stored ? Object.assign(base, stored) : base;
    }
    function getConfig(player) {
        let cfg = configStore.get(player.id);
        if (!cfg) { cfg = readConfig(player.id); configStore.set(player.id, cfg); }
        return cfg;
    }
    const _cfgSyncPending = new Set();
    function persistConfig(playerId) {
        const data = configStore.get(playerId);
        if (!data) return;
        writeJson(KEY_CFG(playerId), data);
        // แจ้งแพค VLK อื่น (คนละ context) ให้ reload cache — กันค่าทับกันข้ามแพค
        // debounce: รวบการเซฟถี่ๆ ใน 1 วิ เหลือ broadcast เดียว (scriptevent มี overhead)
        if (_cfgSyncPending.has(playerId)) return;
        _cfgSyncPending.add(playerId);
        system.runTimeout(() => {
            _cfgSyncPending.delete(playerId);
            sendEvent("vlk:cfgsync", playerId);
        }, 20);
    }

    function isModOwner(player) {
        try { return !!player && player.hasTag(OWNER_TAG); } catch (_) { return false; }
    }
    function grantOwner(player) {
        try { if (player && !player.hasTag(OWNER_TAG)) player.addTag(OWNER_TAG); return true; } catch (_) { return false; }
    }
    function revokeOwner(player) {
        try { if (player && player.hasTag(OWNER_TAG)) player.removeTag(OWNER_TAG); return true; } catch (_) { return false; }
    }

    function loadWaypoints(playerId) { return readJson(KEY_PTS(playerId)) || []; }
    function saveWaypoints(playerId) {
        const data = waypointsCache.get(playerId);
        if (data) writeJson(KEY_PTS(playerId), data);
    }
    function getWaypoints(player) {
        let list = waypointsCache.get(player.id);
        if (!list) { list = loadWaypoints(player.id); waypointsCache.set(player.id, list); }
        return list;
    }
    function addWaypoint(player, name, loc, dimensionId) {
        try {
            const cap = getConfig(player).maxWaypoints || MAX_WAYPOINTS;
            const list = getWaypoints(player);
            while (list.length >= cap) list.shift();
            list.push({ name, x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z), dim: dimensionId });
            saveWaypoints(player.id);
            return true;
        } catch (_) { return false; }
    }
    function deleteWaypoint(player, index) {
        try {
            const list = getWaypoints(player);
            if (index < 0 || index >= list.length) return false;
            list.splice(index, 1);
            saveWaypoints(player.id);
            return true;
        } catch (_) { return false; }
    }
    function getDimensionById(dimensionId) {
        try { return world.getDimension(dimensionId); } catch (_) { return null; }
    }
    function sharedMap(name) {
        let m = _shared.get(name);
        if (!m) { m = new Map(); _shared.set(name, m); }
        return m;
    }

    /* ------------------------------- i18n -------------------------------- */

    const LANGS = ["th", "en"];
    const T = {
        en: {
            brand: "VECTOR LOCK",
            back: "§7◄ Back", close: "§c◆ Close", saved: "§a✔ Saved",
            on: "§aON", off: "§cOFF",
            soloSub: "§7Standalone mode §8— §7install §dVL Core §7to unify 2+ add-ons",
            openHint: "§7Sneak + Compass to open settings",
            tmTitle: "§a§lTARGET MODE",
            tm_all: "All mobs", tm_hostile: "Hostile only",
            tm_passive: "Passive only", tm_players: "Players only",
            a_target: "§a§l◆ Target Mode\n§8What the aim will pick"
        },
        th: {
            brand: "VECTOR LOCK",
            back: "§7◄ กลับ", close: "§c◆ ปิด", saved: "§a✔ บันทึกแล้ว",
            on: "§aเปิด", off: "§cปิด",
            soloSub: "§7โหมดเดี่ยว §8— §7ลง §dVL Core §7เพื่อรวม 2+ แอดออนเป็นระบบเดียว",
            openHint: "§7ย่อ + เข็มทิศ เพื่อเปิดตั้งค่า",
            tmTitle: "§a§lโหมดเป้าหมาย",
            tm_all: "ทุกตัว", tm_hostile: "เฉพาะศัตรู",
            tm_passive: "เฉพาะสัตว์", tm_players: "เฉพาะผู้เล่น",
            a_target: "§a§l◆ โหมดเป้าหมาย\n§8เลือกว่าจะเล็งอะไร"
        }
    };
    function i18nExtend(table) {
        try {
            for (const lang in table) {
                if (!T[lang]) T[lang] = {};
                Object.assign(T[lang], table[lang]);
            }
        } catch (_) { }
    }
    function langOf(player) {
        try {
            const l = getConfig(player).lang;
            return LANGS.includes(l) ? l : "en";
        } catch (_) { return "en"; }
    }
    function tr(playerOrLang, key, ...args) {
        const lang = typeof playerOrLang === "string" ? (LANGS.includes(playerOrLang) ? playerOrLang : "en") : langOf(playerOrLang);
        const table = T[lang] || T.en;
        let s = table[key];
        if (s === undefined) s = (T.en[key] !== undefined ? T.en[key] : key);
        if (args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m));
        return s;
    }

    /* ------------------------------- utils ------------------------------- */

    const Sounds = {
        lock: "random.levelup", hit: "mob.irongolem.hit", menu: "random.pop",
        click: "random.click", save: "note.pling", kill: "random.totem",
        shot: "random.bowhit", headshot: "mob.enderdragon.hit"
    };
    function emitSound(player, id, pitch, volume) {
        try {
            if (!getConfig(player).sounds) return;
            player.playSound(id, { pitch: pitch ?? 1, volume: volume ?? 1 });
        } catch (_) { }
    }
    function emitParticle(dimension, at, particleId) {
        try { dimension.spawnParticle(particleId, { x: at.x, y: at.y + 0.5, z: at.z }); } catch (_) { }
    }
    function delta(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
    function vectorDistance(a, b) {
        const d = delta(a, b);
        return Math.hypot(d.x, d.y, d.z);
    }
    function normalize(v) {
        const m = Math.hypot(v.x, v.y, v.z);
        if (m < 1e-6) return null;
        return { x: v.x / m, y: v.y / m, z: v.z / m };
    }
    function hasLineOfSight(dimension, from, to) {
        try {
            const seg = delta(to, from);
            const reach = Math.hypot(seg.x, seg.y, seg.z);
            if (reach < 0.25) return true;
            const dir = { x: seg.x / reach, y: seg.y / reach, z: seg.z / reach };
            const blocked = dimension.getBlockFromRay(from, dir, {
                maxDistance: Math.max(reach - 0.3, 0.1),
                includeLiquidBlocks: false,
                includePassableBlocks: false
            });
            return !blocked;
        } catch (_) { return true; }
    }
    function angleBetweenDirections(from, aimDir, to) {
        try {
            const toTarget = normalize(delta(to, from));
            const facing = normalize(aimDir);
            if (!toTarget || !facing) return 0;
            let dot = toTarget.x * facing.x + toTarget.y * facing.y + toTarget.z * facing.z;
            if (dot > 1) dot = 1; else if (dot < -1) dot = -1;
            return Math.acos(dot) * 180 / Math.PI;
        } catch (_) { return 0; }
    }
    function mainHandItem(player) {
        const inv = player.getComponent("minecraft:inventory");
        if (!inv || !inv.container) return null;
        return inv.container.getItem(player.selectedSlotIndex) || null;
    }
    const BOW_LIKE = new Set(["minecraft:bow", "minecraft:crossbow"]);
    function isHoldingRangedWeapon(player) {
        try {
            const it = mainHandItem(player);
            return !!it && BOW_LIKE.has(it.typeId);
        } catch (_) { return false; }
    }
    function hasShieldInOffhand(player) {
        try {
            const eq = player.getComponent("minecraft:equippable");
            const off = eq && eq.getEquipment(EquipmentSlot.Offhand);
            return !!off && off.typeId === "minecraft:shield";
        } catch (_) { return false; }
    }
    function consumeItemOfType(player, typeId) {
        try {
            if (player.getGameMode() === GameMode.creative) return true;
            let inv = player.getComponent("minecraft:inventory");
            if (!inv || !inv.container) return false;
            for (let i = 0; i < inv.container.size; i++) {
                let it = inv.container.getItem(i);
                if (it && it.typeId === typeId) {
                    if (it.amount <= 1) inv.container.setItem(i, undefined);
                    else { it.amount -= 1; inv.container.setItem(i, it); }
                    return true;
                }
            }
            return false;
        } catch (e) { return false; }
    }
    function consumeSelectedItem(player, slotIndex) {
        try {
            if (player.getGameMode() === GameMode.creative) return true;
            let inv = player.getComponent("minecraft:inventory");
            if (!inv || !inv.container) return false;
            let item = inv.container.getItem(slotIndex);
            if (!item) return false;
            if (item.amount <= 1) inv.container.setItem(slotIndex, undefined);
            else { item.amount -= 1; inv.container.setItem(slotIndex, item); }
            return true;
        } catch (e) { return false; }
    }
    function reduceToolDurability(player) {
        try {
            let inv = player.getComponent("minecraft:inventory");
            if (!inv || !inv.container) return;
            let slotIndex = player.selectedSlotIndex;
            let item = inv.container.getItem(slotIndex);
            if (!item) return;
            let durability = item.getComponent("minecraft:durability");
            if (!durability) return;
            durability.damage = Math.min(durability.damage + 1, durability.maxDurability);
            if (durability.damage >= durability.maxDurability) inv.container.setItem(slotIndex, undefined);
            else inv.container.setItem(slotIndex, item);
        } catch (e) { }
    }
    function getForwardDirection(player) {
        try {
            let view = player.getViewDirection();
            let angle = Math.atan2(view.z, view.x);
            let octant = Math.round(angle / (Math.PI / 4));
            let snapAngle = octant * (Math.PI / 4);
            let x = Math.round(Math.cos(snapAngle));
            let z = Math.round(Math.sin(snapAngle));
            if (x === 0 && z === 0) return { x: 0, z: 1 };
            return { x: x, z: z };
        } catch (e) { return { x: 0, z: 0 }; }
    }

    /* ----------------------------- targeting ----------------------------- */

    const TargetModes = [
        { key: "all",     name: "All",      color: "§a", icon: "◈", category: "any" },
        { key: "hostile", name: "Hostile",  color: "§c", icon: "☠", category: "threat" },
        { key: "passive", name: "Passive",  color: "§e", icon: "❀", category: "wildlife" },
        { key: "players", name: "Players",  color: "§b", icon: "☺", category: "player" }
    ];
    const MODE_CATEGORY = TargetModes.map(m => m.category);
    const THREATS = [
        "zombie", "husk", "drowned", "zombie_villager",
        "skeleton", "stray", "bogged", "wither_skeleton",
        "creeper", "spider", "cave_spider", "silverfish", "endermite",
        "slime", "magma_cube", "ghast", "blaze",
        "enderman", "warden",
        "witch", "pillager", "vindicator", "evoker", "ravager", "vex",
        "piglin", "piglin_brute", "hoglin", "zoglin",
        "phantom", "breeze", "elder_guardian", "guardian"
    ];
    const WILDLIFE = [
        "pig", "cow", "sheep", "chicken", "rabbit", "goat",
        "horse", "donkey", "mule", "llama", "camel",
        "cat", "wolf", "fox", "parrot", "panda", "polar_bear",
        "bee", "frog", "turtle", "sniffer", "armadillo",
        "axolotl", "dolphin",
        "snow_golem", "iron_golem"
    ];
    const MOB_REGISTRY = {};
    for (const m of THREATS) MOB_REGISTRY["minecraft:" + m] = "threat";
    for (const m of WILDLIFE) MOB_REGISTRY["minecraft:" + m] = "wildlife";
    const NON_TARGETABLE = new Set([
        "minecraft:item", "minecraft:xp_orb", "minecraft:experience_bottle",
        "minecraft:arrow", "minecraft:spectral_arrow", "minecraft:trident",
        "minecraft:snowball", "minecraft:egg", "minecraft:ender_pearl",
        "minecraft:fireball", "minecraft:small_fireball", "minecraft:dragon_fireball",
        "minecraft:wither_skull", "minecraft:shulker_bullet", "minecraft:llama_spit",
        "minecraft:wind_charge_projectile", "minecraft:breeze_wind_charge_projectile",
        "minecraft:evoker_fangs", "minecraft:area_effect_cloud",
        "minecraft:boat", "minecraft:chest_boat", "minecraft:minecart",
        "minecraft:armor_stand", "minecraft:painting", "minecraft:item_frame",
        "minecraft:falling_block", "minecraft:tnt", "minecraft:lightning_bolt"
    ]);
    function isValidTarget(entity, st, ownerId) {
        try {
            if (!entity || !entity.isValid() || entity.id === ownerId) return false;
            const id = entity.typeId;
            if (!id || NON_TARGETABLE.has(id)) return false;
            switch (MODE_CATEGORY[st.targetMode]) {
                case "player":   return id === "minecraft:player";
                case "threat":   return MOB_REGISTRY[id] === "threat";
                case "wildlife": return MOB_REGISTRY[id] === "wildlife";
                default:         return true;
            }
        } catch (_) { return false; }
    }
    const EYE = 1.5, TORSO = 1.0;
    function getAimPoint(entity, atHead) {
        try {
            const loc = entity && entity.isValid() && entity.location;
            if (!loc) return null;
            return { x: loc.x, y: loc.y + (atHead ? EYE : TORSO), z: loc.z };
        } catch (_) { return null; }
    }
    const VERTICAL_LIMIT = 15;
    const OFFAXIS_WEIGHT = 0.1;
    function findNearestTarget(dimension, origin, st, ownerId, selfId, aimDir) {
        try {
            const reach = st.range;
            const pool = dimension.getEntities({ location: origin, maxDistance: reach });
            let best = null;
            let bestScore = Infinity;
            for (const ent of pool) {
                try {
                    if (!ent || !ent.isValid()) continue;
                    if (ent.id === ownerId || ent.id === selfId) continue;
                    if (!isValidTarget(ent, st, ownerId)) continue;
                    const loc = ent.location;
                    if (!loc) continue;
                    if (Math.abs(loc.y - origin.y) > VERTICAL_LIMIT) continue;
                    const dist = vectorDistance(origin, loc);
                    if (dist > reach) continue;
                    let offAxis = 0;
                    if (aimDir) {
                        offAxis = angleBetweenDirections(origin, aimDir, loc);
                        if (st.lockAngle && st.lockAngle < 180 && offAxis > st.lockAngle) continue;
                    }
                    if (st.requireLineOfSight) {
                        const eye = { x: loc.x, y: loc.y + TORSO, z: loc.z };
                        if (!hasLineOfSight(dimension, origin, eye)) continue;
                    }
                    const score = dist + offAxis * OFFAXIS_WEIGHT;
                    if (score < bestScore) { bestScore = score; best = ent; }
                } catch (_) { continue; }
            }
            return best;
        } catch (_) { return null; }
    }

    /* --------------------- registry + scheduler + lifecycle --------------------- */

    const _ticks = [];
    const _cleanups = [];
    const _menu = [];
    const _onInitialSpawn = [];
    const _onRespawn = [];

    /* engine governor — ชุดเดียวกับ Core kernel */
    const TICK_BUDGET_MS = 8;      // งบเวลาสคริปต์ต่อ master tick
    const LAG_SPIKE_MS = 130;      // ช่วงห่างระหว่าง tick ยืดเกินนี้ = เกมกำลังกระตุก
    const GOVERN_EVERY = 100;      // ประเมินโหลดทุก ~5 วิ
    const FAIL_LIMIT = 5;
    const QUARANTINE_TICKS = 200;
    const LOAD_REPORT_EVERY = 200; // โหมด bridge: รายงานโหลดให้ Core ทุก ~10 วิ

    let lastTickAt = 0;
    let loadAvgMs = 0;
    let ecoLevel = 0;

    /** กระจายเฟสจาก hash ของ id — ฟีเจอร์/แพค rate เท่ากันไม่ยิงงานพร้อมกันใน tick เดียว */
    function phaseOf(id, rate) {
        if (rate <= 1) return 0;
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
        return ((h % rate) + rate) % rate;
    }

    /** rate จริงตามระดับ eco — rate 1 (คอมแบต) ลดเฉพาะตอนหนักมาก, critical ไม่ลด */
    function ecoScaledRate(f) {
        if (ecoLevel === 0 || f.critical) return f.rate;
        if (f.rate === 1) return ecoLevel === 2 ? 2 : 1;
        return f.rate * (ecoLevel === 1 ? 2 : 4);
    }

    function defineFeature(spec) {
        if (!spec || !spec.id) return;
        if (spec.strings) i18nExtend(spec.strings);
        if (spec.defaults) contributeDefaults(spec.defaults);
        if (typeof spec.tick === "function") {
            const rate = spec.rate || 1;
            _ticks.push({
                id: spec.id,
                rate: rate,
                tickOrder: spec.tickOrder ?? 100,
                ownerOnly: spec.ownerOnly !== false,
                critical: !!spec.critical,
                phase: phaseOf(spec.id, rate),
                avgMs: 0,
                failStreak: 0,
                suspendedUntil: 0,
                tick: spec.tick
            });
            _ticks.sort((a, b) => a.tickOrder - b.tickOrder);
        }
        if (typeof spec.cleanup === "function") _cleanups.push(spec.cleanup);
        if (typeof spec.onInitialSpawn === "function") _onInitialSpawn.push(spec.onInitialSpawn);
        if (typeof spec.onRespawn === "function") _onRespawn.push(spec.onRespawn);
        if (spec.menu) {
            _menu.push({ order: spec.order ?? 100, id: spec.id, ...spec.menu });
            _menu.sort((a, b) => a.order - b.order);
            if (bridge) {
                // ขอปุ่มบนเมนูรวมของ Core/หัวหน้า (ส่งเฉพาะข้อความ — ฟังก์ชันข้าม context ไม่ได้)
                const en = spec.strings && spec.strings.en ? spec.strings.en[spec.menu.label] : spec.id;
                const th = spec.strings && spec.strings.th ? spec.strings.th[spec.menu.label] : en;
                const payload = JSON.stringify({ v: VLK_PROTO, id: spec.id, order: spec.order ?? 100, en: en, th: th });
                sendEvent("vlk:reg", payload);
                // ปลายทางอาจติดตั้ง listener ช้ากว่าเราส่งครั้งแรก → ส่งซ้ำกันตกหล่น (ปลายทาง dedup ด้วย id)
                system.runTimeout(() => { try { sendEvent("vlk:reg", payload); } catch (_) { } }, 20);
                system.runTimeout(() => { try { sendEvent("vlk:reg", payload); } catch (_) { } }, 60);
            }
        }
        /* spec.status: โหมดเดี่ยวไม่มีหน้า Status — เก็บเฉยๆ ไม่ใช้ */
    }

    let masterTick = 0;
    system.runInterval(function () {
        try {
            masterTick++;
            const startedAt = Date.now();
            const gap = lastTickAt ? startedAt - lastTickAt : 0;
            lastTickAt = startedAt;

            // เกมกำลังกระตุก → พักงานเรา 1 tick ให้เกมหายใจก่อน
            if (gap > LAG_SPIKE_MS) return;
            if (_ticks.length === 0) return;

            const players = world.getAllPlayers();
            if (players.length === 0) return;

            for (let p = 0; p < players.length; p++) {
                const player = players[p];
                if (!player || !player.isValid()) continue;
                const owner = isModOwner(player);
                let st = null;
                for (let i = 0; i < _ticks.length; i++) {
                    const f = _ticks[i];
                    if (f.suspendedUntil > masterTick) continue; // โดนพักชั่วคราว (พังซ้ำ)
                    const rate = ecoScaledRate(f);
                    if ((masterTick - f.phase) % rate !== 0) continue;
                    if (f.ownerOnly) {
                        if (!owner) continue;
                        if (!st) st = getConfig(player);
                    }
                    const t0 = Date.now();
                    try {
                        f.tick(player, st, masterTick);
                        f.failStreak = 0;
                    } catch (_) {
                        if (++f.failStreak >= FAIL_LIMIT) {
                            f.suspendedUntil = masterTick + QUARANTINE_TICKS;
                            f.failStreak = 0;
                        }
                    }
                    f.avgMs = f.avgMs * 0.9 + (Date.now() - t0) * 0.1;
                }
            }

            // ประเมินโหลดรวมแล้วปรับ eco อัตโนมัติ
            loadAvgMs = loadAvgMs * 0.95 + (Date.now() - startedAt) * 0.05;
            if (masterTick % GOVERN_EVERY === 0) {
                if (loadAvgMs > TICK_BUDGET_MS) ecoLevel = Math.min(2, ecoLevel + 1);
                else if (loadAvgMs < TICK_BUDGET_MS * 0.5) ecoLevel = Math.max(0, ecoLevel - 1);
            }

            // โหมด bridge: รายงานโหลดให้ Core เอาไปโชว์รวมในหน้า Status
            if (bridge && masterTick % LOAD_REPORT_EVERY === 0) {
                const id = _ticks.map((f) => f.id).join("+") || "unknown";
                sendEvent("vlk:load", JSON.stringify({ id: id, ms: +loadAvgMs.toFixed(3), eco: ecoLevel }));
            }
        } catch (_) { }
    }, 1);

    // safety net กัน memory รั่ว: กวาด state ของผู้เล่นที่หลุดไปโดยไม่เกิด playerLeave
    system.runInterval(() => {
        try {
            const online = new Set();
            for (const p of world.getAllPlayers()) online.add(p.id);
            const sweepMap = (m) => {
                for (const id of Array.from(m.keys())) {
                    if (online.has(id)) continue;
                    if (m === configStore) {
                        for (const drop of _cleanups) { try { drop(id); } catch (_) { } }
                    }
                    m.delete(id);
                }
            };
            sweepMap(configStore);
            sweepMap(uiOpenState);
            sweepMap(waypointsCache);
        } catch (_) { }
    }, 600);

    world.afterEvents.playerSpawn.subscribe((event) => {
        try {
            const player = event.player;
            if (!player) return;
            if (event.initialSpawn) {
                configStore.set(player.id, readConfig(player.id));
                grantOwner(player);
                if (!bridge) { // โหมด bridge: Core เป็นคนทัก welcome เอง
                    system.runTimeout(() => {
                        try { player.sendMessage("§b§l" + tr(player, "brand") + " §r" + tr(player, "openHint")); } catch (_) { }
                    }, 40);
                }
                for (const fn of _onInitialSpawn) { try { fn(player); } catch (_) { } }
            } else if (isModOwner(player)) {
                for (const fn of _onRespawn) { try { fn(player); } catch (_) { } }
            }
        } catch (_) { }
    });

    world.afterEvents.playerLeave.subscribe((event) => {
        try {
            const id = event.player && event.player.id;
            if (!id) return;
            configStore.delete(id);
            uiOpenState.delete(id);
            waypointsCache.delete(id);
            for (const drop of _cleanups) { try { drop(id); } catch (_) { } }
        } catch (_) { }
    });

    /* ------------------------------ solo UI ------------------------------ */

    function uiSave(player) {
        persistConfig(player.id);
        emitSound(player, Sounds.save, 1.2, 0.8);
        player.sendMessage(tr(player, "saved"));
    }

    function openMainMenu(player) {
        try {
            if (bridge) { sendEvent("vlk:back", player.id); return; } // เมนูรวมอยู่ฝั่ง Core
            if (_menu.length === 0) return;
            if (uiOpenState.get(player.id)) return;
            uiOpenState.set(player.id, true);
            emitSound(player, Sounds.menu, 1.5, 0.8);
            const f = new ActionFormData();
            f.title("§b§l« §f" + tr(player, "brand") + " §b§l»");
            f.body(tr(player, "soloSub"));
            for (const e of _menu) f.button(tr(player, e.label));
            f.button(tr(player, "close"));
            f.show(player).then((r) => {
                uiOpenState.set(player.id, false);
                if (r.canceled || r.selection === _menu.length) return;
                try { _menu[r.selection].open(player); } catch (_) { }
            }).catch(() => uiOpenState.set(player.id, false));
        } catch (_) { }
    }

    function openTargetModePicker(player, onBack) {
        const st = getConfig(player);
        emitSound(player, Sounds.click, 1.2, 0.6);
        const back = typeof onBack === "function" ? onBack : openMainMenu;
        const f = new ActionFormData();
        f.title(tr(player, "tmTitle"));
        let body = "";
        for (let i = 0; i < TargetModes.length; i++) {
            const mark = st.targetMode === i ? "§a► " : "§8○ ";
            body += mark + TargetModes[i].color + tr(player, "tm_" + TargetModes[i].key) + "\n";
        }
        f.body(body);
        for (let i = 0; i < TargetModes.length; i++) {
            const chk = st.targetMode === i ? "§a✔ " : "§8   ";
            f.button(chk + TargetModes[i].color + TargetModes[i].icon + " " + tr(player, "tm_" + TargetModes[i].key));
        }
        f.button(tr(player, "back"));
        f.show(player).then((r) => {
            if (r.canceled) return; // Esc/X = ปิดจริง ไม่เด้งกลับ
            if (r.selection === TargetModes.length) return back(player);
            st.targetMode = r.selection;
            uiSave(player);
            back(player);
        }).catch(() => { });
    }

    /** จุดกลับหลังเซฟ/กด Back: bridge → เมนูรวมของ Core, หลายฟีเจอร์ → เมนูเดี่ยว,
     *  ฟีเจอร์เดียว → ปิดคือปิด (ไม่เด้งฟอร์มเดิมวนซ้ำ) */
    function closeToMenu(player) {
        if (bridge) { sendEvent("vlk:back", player.id); return; }
        if (_menu.length > 1) openMainMenu(player);
    }

    world.beforeEvents.itemUse.subscribe((event) => {
        try {
            if (bridge) return;             // โหมด bridge: Core เป็นเจ้าของปุ่มเปิดเมนู
            if (globalThis.__VLK__) return; // Core โผล่มาทีหลัง → ให้ Core จัดการเมนู
            const player = event.source;
            const item = event.itemStack;
            if (!player || player.typeId !== "minecraft:player" || !item) return;
            if (!isModOwner(player)) return;
            if (item.typeId === "minecraft:compass" && player.isSneaking) {
                system.run(() => {
                    // ฟีเจอร์เดียว: เปิดฟอร์มตรงๆ (ทางลัดเฉพาะตอนกดเปิดเอง ไม่ใช่ตอน back)
                    if (_menu.length === 1) { try { _menu[0].open(player); } catch (_) { } }
                    else openMainMenu(player);
                });
            }
        } catch (_) { }
    });

    /* ---------------------- bridge: รับ event จาก Core ---------------------- */

    system.afterEvents.scriptEventReceive.subscribe((ev) => {
        try {
            if (ev.id === "vlk:cfgsync") {
                // มีแพคไหนเซฟ config → reload cache กันค่าทับกันข้ามแพค
                const pid = (ev.message || "").trim();
                if (RE_PLAYER_ID.test(pid) && configStore.has(pid)) configStore.set(pid, readConfig(pid));
                return;
            }
            if (bridge && ev.id === "vlk:open") {
                // Core/หัวหน้าบอกว่าผู้เล่นกดปุ่มของฟีเจอร์เรา → เปิดฟอร์มใน context นี้
                const d = JSON.parse(ev.message);
                if (!d || !RE_FEATURE_ID.test(d.id || "") || !RE_PLAYER_ID.test(String(d.player || ""))) return;
                const entry = _menu.find((e) => e.id === d.id);
                if (!entry) return;
                const player = world.getAllPlayers().find((p) => p.id === d.player);
                if (player) system.run(() => { try { entry.open(player); } catch (_) { } });
            }
        } catch (_) { }
    });

    /* --------- host: ทำหน้าที่มินิ-Core ให้แพค solo ด้วยกัน (ไม่มี Core) --------- */

    if (host) {
        const _remote = new Set();
        system.afterEvents.scriptEventReceive.subscribe((ev) => {
            try {
                if (ev.id === "vlk:ping") {
                    // ตอบ ping เหมือน Core — แพคที่โหลดช้า/ตกรอบเลือกหัวหน้า
                    // จะเข้าวงเป็นสมาชิกได้เสมอ (กันหัวหน้าซ้อน/แพคกำพร้า)
                    sendEvent("vlk:pong", "host");
                    return;
                }
                if (ev.id === "vlk:reg") {
                    // สมาชิกขอปุ่มบนเมนูรวมของเรา — โปรโตคอลเดียวกับ bridge.js ฝั่ง Core
                    const d = JSON.parse(ev.message);
                    if (!d || d.v !== VLK_PROTO) return;
                    if (!RE_FEATURE_ID.test(d.id || "")) return;
                    if (_remote.has(d.id) || _remote.size >= MAX_REMOTE_FEATURES) return;
                    if (_menu.some((e) => e.id === d.id)) return; // กันชนกับฟีเจอร์ของตัวเอง
                    _remote.add(d.id);
                    const key = "m_" + d.id;
                    defineFeature({
                        id: d.id,
                        order: typeof d.order === "number" ? d.order : 100,
                        strings: {
                            en: { [key]: cleanLabel(d.en, d.id) },
                            th: { [key]: cleanLabel(d.th, cleanLabel(d.en, d.id)) }
                        },
                        menu: {
                            label: key,
                            open: (player) => sendEvent("vlk:open", JSON.stringify({ id: d.id, player: player.id }))
                        }
                    });
                    return;
                }
                if (ev.id === "vlk:back") {
                    const pid = (ev.message || "").trim();
                    if (!RE_PLAYER_ID.test(pid)) return;
                    const player = world.getAllPlayers().find((p) => p.id === pid);
                    if (player) system.run(() => { try { openMainMenu(player); } catch (_) { } });
                }
            } catch (_) { }
        });
    }

    /* runtime นี้สร้างหลังโลกเริ่ม tick ไปแล้ว (รอ ping/pong) —
       ผู้เล่นที่ spawn ไปก่อนหน้าจะพลาด initialSpawn → เก็บตกให้ครบ */
    system.run(() => {
        try { for (const p of world.getAllPlayers()) grantOwner(p); } catch (_) { }
    });

    /* ------------------------------ API ------------------------------ */

    return {
        version: "2.1.3-" + mode,
        solo: true,
        bridge: bridge,
        host: host,
        defineFeature,
        getMenuEntries: () => _menu.slice(),
        getStatusProviders: () => [],
        sharedMap,
        start: () => { },

        getConfig, persistConfig, isModOwner, grantOwner, revokeOwner,
        uiOpenState, addWaypoint, deleteWaypoint, getWaypoints, getDimensionById,

        Sounds, emitSound, emitParticle, vectorDistance, hasLineOfSight,
        angleBetweenDirections, isHoldingRangedWeapon, hasShieldInOffhand,
        consumeItemOfType, reduceToolDurability, consumeSelectedItem, getForwardDirection,

        TargetModes, MODE_CATEGORY, MOB_REGISTRY, NON_TARGETABLE,
        isValidTarget, getAimPoint, findNearestTarget,

        tr, langOf, i18nExtend,
        openMainMenu, closeToMenu, openTargetModePicker, uiSave
    };
}
