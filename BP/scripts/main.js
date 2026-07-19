/**
 * ============================================================================
 *  VECTOR LOCK: ORE VISION  —  Minecraft Bedrock Add-on
 *  (standalone-capable; VL Core recommended)
 *  Copyright (c) 2026 p7x939. All Rights Reserved.
 * ----------------------------------------------------------------------------
 *  Original work — created, designed, and owned by the author (p7x939).
 *    GitHub : https://github.com/plu007-fix
 *    YouTube: https://www.youtube.com/@p7x939
 *  This source code is proprietary. Unauthorized copying, redistribution,
 *  re-uploading, modification, or claiming this work (in whole or in part,
 *  by any means) as your own is strictly prohibited without the author's
 *  prior written permission.
 * ============================================================================
 */

import { world, BlockVolume, system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { connectVLK } from "./solo.js";

let VLK = globalThis.__VLK__;
let tr, getConfig, uiSave, openMainMenu, closeToMenu, emitSound, Sounds;
function __vlkBind() {
    ({ tr, getConfig, uiSave, openMainMenu, emitSound, Sounds } = VLK);
    closeToMenu = VLK.closeToMenu || VLK.openMainMenu;
}

const MARKER_ENTITY = "vlk:xray_node";
const DISMISS_EVENT = "vlk:dismiss";

const RESCAN_DRIFT_SQ = 4.0;
const PRUNE_PADDING = 6;
const SPAWN_BUDGET = 96;
const GLOBAL_CEILING = 3000;

const SCAN_TARGETS = {
    xrayCoal:      { sym: 1,  ids: ["coal_ore", "deepslate_coal_ore"] },
    xrayCopper:    { sym: 2,  ids: ["copper_ore", "deepslate_copper_ore"] },
    xrayIron:      { sym: 3,  ids: ["iron_ore", "deepslate_iron_ore"] },
    xrayGold:      { sym: 4,  ids: ["gold_ore", "deepslate_gold_ore", "nether_gold_ore"] },
    xrayRedstone:  { sym: 5,  ids: ["redstone_ore", "lit_redstone_ore", "deepslate_redstone_ore", "lit_deepslate_redstone_ore"] },
    xrayLapis:     { sym: 6,  ids: ["lapis_ore", "deepslate_lapis_ore"] },
    xrayDiamond:   { sym: 7,  ids: ["diamond_ore", "deepslate_diamond_ore"] },
    xrayEmerald:   { sym: 8,  ids: ["emerald_ore", "deepslate_emerald_ore"] },
    xrayNetherite: { sym: 9,  ids: ["ancient_debris"] },
    xrayQuartz:    { sym: 10, ids: ["quartz_ore"] },
    xrayChest:     { sym: 11, ids: ["chest", "trapped_chest", "barrel", "ender_chest"] },
    xraySpawner:   { sym: 12, ids: ["mob_spawner", "trial_spawner", "vault"] },
    xrayShulker:   { sym: 13, ids: ["undyed_shulker_box", "white_shulker_box", "orange_shulker_box", "magenta_shulker_box", "light_blue_shulker_box", "yellow_shulker_box", "lime_shulker_box", "pink_shulker_box", "gray_shulker_box", "light_gray_shulker_box", "cyan_shulker_box", "purple_shulker_box", "blue_shulker_box", "brown_shulker_box", "green_shulker_box", "red_shulker_box", "black_shulker_box"] }
};

let xrayOutlineRegistry = new Map();
const scanCursors = new Map();
const claimIndex = new Map();
let globalMarkerCount = 0;

function keyOf(x, y, z) { return x + "/" + y + "/" + z; }
function splitKey(key) { const p = key.split("/"); return { x: +p[0], y: +p[1], z: +p[2] }; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function markersOf(playerId) {
    let m = xrayOutlineRegistry.get(playerId);
    if (!m) { m = new Map(); xrayOutlineRegistry.set(playerId, m); }
    return m;
}
function cursorOf(playerId) {
    let c = scanCursors.get(playerId);
    if (!c) { c = { anchor: null, sig: "", pending: [] }; scanCursors.set(playerId, c); }
    return c;
}

function classify(typeId) {
    for (const flag in SCAN_TARGETS) {
        const t = SCAN_TARGETS[flag];
        for (let i = 0; i < t.ids.length; i++) {
            if (typeId.endsWith(t.ids[i])) return t;
        }
    }
    return null;
}

function dropMarker(playerId, key, markers) {
    const ent = markers.get(key);
    if (ent) {

        try {
            if (ent.isValid()) {
                if (typeof ent.remove === "function") ent.remove();
                else ent.triggerEvent(DISMISS_EVENT);
            }
        } catch (e) { }
        markers.delete(key);
        globalMarkerCount = globalMarkerCount > 0 ? globalMarkerCount - 1 : 0;
    }
    const owners = claimIndex.get(key);
    if (owners) {
        owners.delete(playerId);
        if (owners.size === 0) claimIndex.delete(key);
    }
}

function xrayRemoveAllForPlayer(playerId) {
    try {
        const markers = xrayOutlineRegistry.get(playerId);
        if (markers) {
            for (const key of Array.from(markers.keys())) dropMarker(playerId, key, markers);
            xrayOutlineRegistry.delete(playerId);
        }
        scanCursors.delete(playerId);
    } catch (e) { }
}

function xrayRemoveAtLocation(key) {
    try {
        const owners = claimIndex.get(key);
        if (!owners || owners.size === 0) return;
        for (const playerId of Array.from(owners)) {
            const markers = xrayOutlineRegistry.get(playerId);
            if (markers) dropMarker(playerId, key, markers);
        }
    } catch (e) { }
}

function maintainMarkers(player, markers, radius) {
    if (markers.size === 0) return;
    const loc = player.location;
    const dim = player.dimension;
    const limitSq = (radius + PRUNE_PADDING) * (radius + PRUNE_PADDING);
    const stale = [];
    markers.forEach((ent, key) => {
        if (!ent || !ent.isValid()) { stale.push(key); return; }
        const p = splitKey(key);
        const dx = (p.x + 0.5) - loc.x, dy = (p.y + 0.5) - loc.y, dz = (p.z + 0.5) - loc.z;
        if (dx * dx + dy * dy + dz * dz > limitSq) { stale.push(key); return; }

        let block;
        try { block = dim.getBlock({ x: p.x, y: p.y, z: p.z }); } catch (e) { return; }
        if (block === undefined) return;
        if (!classify(block.typeId)) stale.push(key);
    });
    for (let i = 0; i < stale.length; i++) dropMarker(player.id, stale[i], markers);
}

function refillPending(player, radius, activeIds, markers, cursor, perPlayerCap) {
    const loc = player.location;
    const from = { x: loc.x + radius, y: loc.y + radius, z: loc.z + radius };
    const to   = { x: loc.x - radius, y: loc.y - radius, z: loc.z - radius };
    const pending = [];
    const room = perPlayerCap - markers.size;
    if (room <= 0) { cursor.pending = pending; return; }
    try {
        const hits = player.dimension.getBlocks(new BlockVolume(from, to), { includeTypes: activeIds }, true);
        for (const bl of hits.getBlockLocationIterator()) {
            const key = keyOf(bl.x, bl.y, bl.z);
            if (markers.has(key)) continue;
            pending.push({ key: key, x: bl.x, y: bl.y, z: bl.z });
            if (pending.length >= room + SPAWN_BUDGET) break;
        }
    } catch (e) { }
    cursor.pending = pending;
}

function drainPending(player, markers, cursor, perPlayerCap) {
    const pending = cursor.pending;
    if (!pending || pending.length === 0) return;
    const dim = player.dimension;
    let budget = Math.min(SPAWN_BUDGET, perPlayerCap - markers.size, GLOBAL_CEILING - globalMarkerCount);
    while (budget > 0 && pending.length > 0) {
        const job = pending.shift();
        if (markers.has(job.key)) continue;
        let block;
        try { block = dim.getBlock({ x: job.x, y: job.y, z: job.z }); } catch (e) { continue; }
        if (!block) continue;
        const cat = classify(block.typeId);
        if (!cat) continue;
        try {
            const node = dim.spawnEntity(MARKER_ENTITY, { x: job.x + 0.5, y: job.y + 0.5, z: job.z + 0.5 });
            node.setProperty("vlk:sym", cat.sym);
            markers.set(job.key, node);
            globalMarkerCount++;
            let owners = claimIndex.get(job.key);
            if (!owners) { owners = new Set(); claimIndex.set(job.key, owners); }
            owners.add(player.id);
            budget--;
        } catch (e) {  }
    }
}

function oreXrayForPlayer(player, st) {
    if (!st.oreXrayEnabled) { xrayRemoveAllForPlayer(player.id); return; }
    try {

        const activeIds = [];
        let sig = "";
        let activeCount = 0;
        for (const flag in SCAN_TARGETS) {
            if (st[flag]) {
                const t = SCAN_TARGETS[flag];
                activeCount++;

                for (let i = 0; i < t.ids.length; i++) activeIds.push("minecraft:" + t.ids[i]);
                sig += flag + ",";
            }
        }
        if (activeCount === 0) { xrayRemoveAllForPlayer(player.id); return; }

        const markers = markersOf(player.id);
        const cursor = cursorOf(player.id);
        const radius = clamp(Math.floor(st.xrayRadius || 20), 1, 50);
        const perPlayerCap = st.xrayMaxOutlines || 250;
        sig += "r" + radius;

        maintainMarkers(player, markers, radius);

        const loc = player.location;
        const a = cursor.anchor;
        const drifted = !a || ((a.x - loc.x) ** 2 + (a.y - loc.y) ** 2 + (a.z - loc.z) ** 2) >= RESCAN_DRIFT_SQ;
        const stillFilling = cursor.pending && cursor.pending.length > 0;
        if ((sig !== cursor.sig || drifted) && !stillFilling) {
            cursor.sig = sig;
            cursor.anchor = { x: loc.x, y: loc.y, z: loc.z };
            if (markers.size < perPlayerCap && globalMarkerCount < GLOBAL_CEILING) {
                refillPending(player, radius, activeIds, markers, cursor, perPlayerCap);
            }
        }

        drainPending(player, markers, cursor, perPlayerCap);
    } catch (e) { }
}

/* ghost markers: entity ที่ค้างจากเซสชันก่อน (world reload ทำให้ registry ในสคริปต์ว่าง
 * แต่ entity ยังอยู่ในเซฟ) — กวาดตัวที่ไม่มีเจ้าของใน claimIndex ทิ้งเป็นระยะ */
let sweepCountdown = 0;
function sweepOrphanMarkers(player) {
    try {
        const ents = player.dimension.getEntities({
            type: MARKER_ENTITY, location: player.location, maxDistance: 60
        });
        for (const e of ents) {
            try {
                const l = e.location;
                const key = keyOf(Math.floor(l.x), Math.floor(l.y), Math.floor(l.z));
                if (claimIndex.has(key)) continue;
                if (typeof e.remove === "function") e.remove();
                else e.triggerEvent(DISMISS_EVENT);
            } catch (_) { }
        }
    } catch (_) { }
}

world.afterEvents.playerBreakBlock.subscribe((ev) => {
    try { const l = ev.block.location; xrayRemoveAtLocation(keyOf(l.x, l.y, l.z)); } catch (e) { }
});
world.afterEvents.blockExplode.subscribe((ev) => {
    try { const l = ev.block.location; xrayRemoveAtLocation(keyOf(l.x, l.y, l.z)); } catch (e) { }
});

const XRAY_KEYS = ["xrayCoal","xrayCopper","xrayIron","xrayGold","xrayRedstone","xrayLapis",
    "xrayDiamond","xrayEmerald","xrayNetherite","xrayQuartz","xrayChest","xraySpawner","xrayShulker"];
const XRAY_LABELS = ["xr_coal","xr_copper","xr_iron","xr_gold","xr_redstone","xr_lapis",
    "xr_diamond","xr_emerald","xr_netherite","xr_quartz","xr_chest","xr_spawner","xr_shulker"];

function openXrayForm(player) {
    const st = getConfig(player);
    emitSound(player, Sounds.click, 1.2, 0.6);
    const f = new ModalFormData();
    f.title(tr(player, "xrayTitle"));
    f.toggle(tr(player, "xr.enabled"), st.oreXrayEnabled);
    for (let i = 0; i < XRAY_KEYS.length; i++) f.toggle(tr(player, XRAY_LABELS[i]), st[XRAY_KEYS[i]]);
    f.slider(tr(player, "xr.radius"), 1, 50, 1, st.xrayRadius);
    f.slider(tr(player, "xr.max"), 50, 500, 25, st.xrayMaxOutlines);
    f.show(player).then((r) => {
        if (r.canceled) return; // Esc/X = ปิดจริง ไม่เด้งกลับ (กันลูปฟอร์มเปิดวนไม่รู้จบ)
        const v = r.formValues;
        st.oreXrayEnabled = v[0];
        for (let i = 0; i < XRAY_KEYS.length; i++) st[XRAY_KEYS[i]] = v[i + 1];
        st.xrayRadius = v[14]; st.xrayMaxOutlines = v[15];
        if (!st.oreXrayEnabled) xrayRemoveAllForPlayer(player.id);
        uiSave(player); closeToMenu(player);
    }).catch(() => { });
}

function __vlkRegister() {
    __vlkBind();
    VLK.defineFeature({
    id: "orexray",
    strings: {
        en: {
            m_vision: "§d§l◆ Ore Vision\n§8See-through prism scan",
            xrayTitle: "§d§lORE VISION",
            "xr.enabled": "§fEnabled\n§8Master switch for prism scan",
            "xr.radius": "§fScan Radius\n§8See-through distance",
            "xr.max": "§fMax Markers\n§8Cap on shown markers",
            xr_coal: "§8Coal", xr_copper: "§6Copper", xr_iron: "§fIron",
            xr_gold: "§eGold", xr_redstone: "§cRedstone", xr_lapis: "§9Lapis",
            xr_diamond: "§bDiamond", xr_emerald: "§aEmerald", xr_netherite: "§8Netherite",
            xr_quartz: "§fQuartz", xr_chest: "§6Chest / Barrel", xr_spawner: "§2Spawner / Vault",
            xr_shulker: "§dShulker Box",
            st_xray: "Ore Vision", st_markers: "Ore markers"
        },
        th: {
            m_vision: "§d§l◆ มองทะลุแร่\n§8สแกนพริซึมทะลุกำแพง",
            xrayTitle: "§d§lมองทะลุแร่",
            "xr.enabled": "§fเปิดใช้งาน\n§8สวิตช์หลักของสแกนพริซึม",
            "xr.radius": "§fรัศมีสแกน\n§8ระยะมองทะลุ",
            "xr.max": "§fมาร์กเกอร์สูงสุด\n§8จำกัดจำนวนที่แสดง",
            xr_coal: "§8ถ่านหิน", xr_copper: "§6ทองแดง", xr_iron: "§fเหล็ก",
            xr_gold: "§eทองคำ", xr_redstone: "§cเรดสโตน", xr_lapis: "§9ลาพิส",
            xr_diamond: "§bเพชร", xr_emerald: "§aมรกต", xr_netherite: "§8เนเธอไรต์",
            xr_quartz: "§fควอตซ์", xr_chest: "§6หีบ / บาเรล", xr_spawner: "§2สปอว์นเนอร์ / วอลต์",
            xr_shulker: "§dกล่องชูลเกอร์",
            st_xray: "มองทะลุแร่", st_markers: "มาร์กเกอร์แร่"
        }
    },
    defaults: {
        oreXrayEnabled: true,
        xrayCoal: true, xrayCopper: true, xrayIron: true, xrayGold: true,
        xrayRedstone: true, xrayLapis: true, xrayDiamond: true, xrayEmerald: true,
        xrayNetherite: true, xrayQuartz: true, xrayChest: true, xraySpawner: true, xrayShulker: true,
        xrayRadius: 20,
        xrayMaxOutlines: 250
    },
    rate: 10,
    tickOrder: 110,
    tick: (player, st) => {
        // นับตามจำนวนครั้งที่ถูกเรียก (ไม่อิง masterTick — รองรับ phase/eco ของ engine)
        if (--sweepCountdown <= 0) { sweepCountdown = 30; sweepOrphanMarkers(player); }
        oreXrayForPlayer(player, st);
    },
    cleanup: (playerId) => xrayRemoveAllForPlayer(playerId),
    menu: { label: "m_vision", open: openXrayForm },
    order: 20,
    status: (player, st) => {
        const reg = xrayOutlineRegistry.get(player.id);
        return "§7" + tr(player, "st_xray") + ": " + (st.oreXrayEnabled ? tr(player, "on") : tr(player, "off")) +
               " §8| §7" + tr(player, "st_markers") + ": §f" + (reg ? reg.size : 0);
    }
});
}

/* ---- boot: connectVLK จัดการเอง —
 *  Core ใน context เดียวกัน → ใช้ตรง / Core คนละแพค → bridge ผ่าน scriptevent /
 *  ไม่มี Core → โหมดเดี่ยวเต็มรูปแบบ ---- */
connectVLK((vlk) => {
    VLK = vlk;
    __vlkRegister();
});
