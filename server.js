
function sendJSON(res, data, status=200){
  res.writeHead(status, {"Content-Type":"application/json"});
  res.end(JSON.stringify(data));
}
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");
const { Pool } = require("pg");

function loadDotEnv(){
  const file=path.join(__dirname,".env");
  if(!fs.existsSync(file)) return;
  for(const line of fs.readFileSync(file,"utf8").split(/\r?\n/)){
    const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if(!m || process.env[m[1]]) continue;
    let v=m[2]; if((v.startsWith("\"")&&v.endsWith("\""))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
    process.env[m[1]]=v;
  }
}
loadDotEnv();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATABASE_URL = process.env.DATABASE_URL || "";
if(!DATABASE_URL){
  console.error("DATABASE_URL is required. Configure a PostgreSQL database before starting Onyx.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
});
let dbCache = {players:[], tests:[]};
let dbReady = false;
let playedCache = {players:[]};
const ONYX_INGEST_TOKEN = process.env.ONYX_INGEST_TOKEN || "";
const MCPVP_DATA = "https://www.mcpvp.com/tiers/data";
const MCPVP_HTML = "https://www.mcpvp.com/tiers";

const MOJANG_PROFILE = "https://sessionserver.mojang.com/session/minecraft/profile/";
const MOJANG_NAME = "https://api.mojang.com/users/profiles/minecraft/";
const SKIN_CACHE_MS = 1000 * 60 * 60 * 24;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "";
const sessions = new Map();

// ONYX tier points: the official points awarded by each tier.
// These are server-authoritative so every page/API uses the same values.
const TIER_POINTS = Object.freeze({
  LT5: 1,
  HT5: 2,
  LT4: 3,
  HT4: 4,
  LT3: 6,
  HT3: 10,
  LT2: 20,
  HT2: 30,
  LT1: 45,
  HT1: 60
});
function normalizeTier(value){ return String(value||"").trim().toUpperCase(); }
function pointsForTier(tier){
  const key=normalizeTier(tier);
  return Object.prototype.hasOwnProperty.call(TIER_POINTS,key) ? TIER_POINTS[key] : 0;
}

function hashSession(token){ return crypto.createHmac("sha256",SESSION_SECRET||"missing-secret").update(token).digest("hex"); }
function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||"").split(";")){
    const i=part.indexOf("="); if(i<0) continue;
    out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function secureCompare(a,b){
  const aa=Buffer.from(String(a)); const bb=Buffer.from(String(b));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function verifyPassword(password, stored){
  const [scheme,saltHex,hashHex]=String(stored||"").split("$");
  if(scheme!=="scrypt"||!saltHex||!hashHex) return false;
  try{
    const derived=crypto.scryptSync(String(password),Buffer.from(saltHex,"hex"),64);
    return secureCompare(derived.toString("hex"),hashHex);
  }catch{return false;}
}
function requireAdmin(req,res){
  const token=parseCookies(req).onyx_admin;
  if(!token) return false;
  const key=hashSession(token);
  const session=sessions.get(key);
  if(!session || session.expires<Date.now()){ sessions.delete(key); return false; }
  return true;
}
function authError(res){ return sendJSON(res,{error:"admin authentication required"},401); }
function adminOrIngest(req,res){
  if(requireAdmin(req,res)) return true;
  if(!ONYX_INGEST_TOKEN) return false;
  const supplied=req.headers["x-onyx-token"] || "";
  return supplied === ONYX_INGEST_TOKEN;
}


function getJSON(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{
      "User-Agent":"ONYX-TierList/1.3",
      "Accept":"application/json"
    }},res=>{
      let body=""; res.setEncoding("utf8");
      res.on("data",c=>body+=c);
      res.on("end",()=>{
        if(res.statusCode<200 || res.statusCode>=300)
          return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("Invalid JSON")); }
      });
    });
    req.setTimeout(10000,()=>req.destroy(new Error("timeout")));
    req.on("error",reject);
  });
}

function textureSkinURL(profile){
  const textures=(profile.properties||[]).find(p=>p.name==="textures");
  if(!textures?.value) return "";
  try{
    const decoded=JSON.parse(Buffer.from(textures.value,"base64").toString("utf8"));
    return decoded?.textures?.SKIN?.url || "";
  }catch{return "";}
}

async function lookupMojangSkin(player){
  let uuid=String(player?.uuid||"").replace(/-/g,"").trim();
  let profile=null;

  // If the plugin supplied a UUID, use it. Otherwise resolve the Java username first.
  if(/^[0-9a-f]{32}$/i.test(uuid)){
    try { profile=await getJSON(MOJANG_PROFILE+uuid); } catch {}
  } else if(player?.name){
    try{
      const basic=await getJSON(MOJANG_NAME+encodeURIComponent(String(player.name).trim()));
      uuid=String(basic.id||"").replace(/-/g,"").trim();
      if(/^[0-9a-f]{32}$/i.test(uuid)){
        profile=await getJSON(MOJANG_PROFILE+uuid);
      }
    }catch{}
  }

  if(profile && /^[0-9a-f]{32}$/i.test(uuid)){
    return {
      premium:true,
      uuid,
      skinUrl:textureSkinURL(profile),
      skinFetchedAt:new Date().toISOString(),
      mojangName:profile.name || player.name || ""
    };
  }

  return {
    premium:false,
    uuid: uuid || player?.uuid || "",
    skinUrl:"",
    skinFetchedAt:new Date().toISOString()
  };
}

async function enrichSkin(player){
  if(!player) return player;
  const fetched=player.skinFetchedAt ? Date.parse(player.skinFetchedAt) : 0;
  if(player.skinFetchedAt && Date.now()-fetched<SKIN_CACHE_MS && player.uuid) return player;
  Object.assign(player,await lookupMojangSkin(player));
  return player;
}

async function enrichSkinList(list){
  for(let i=0;i<list.length;i+=5)
    await Promise.all(list.slice(i,i+5).map(enrichSkin));
  return list;
}

function readDB(){
  return dbCache;
}
async function writeDB(db){
  dbCache = db;
  await pool.query(
    `INSERT INTO onyx_store (id, data, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(db)]
  );
}
function readPlayedDB(){
  return playedCache;
}
async function writePlayedDB(db){
  playedCache = db;
  await pool.query(
    `INSERT INTO played_store (id, data, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(db)]
  );
}

function normalizeStoredTierPoints(db){
  let changed=false;
  const kitAliases={crystal:"vanilla",nethpot:"nethop",diapot:"pot",nodebuff:"pot",builduhc:"uhc"};
  for(const player of (db.players||[])){
    if(!player.rankings) player.rankings={};
    let total=0;
    for(const [storedKit, ranking] of Object.entries({...player.rankings})){
      const normalizedKit=kitAliases[String(storedKit).trim().toLowerCase()] || storedKit;
      if(normalizedKit!==storedKit){
        if(!player.rankings[normalizedKit]) player.rankings[normalizedKit]=ranking;
        delete player.rankings[storedKit];
        changed=true;
      }
      const pts=pointsForTier(ranking?.rank);
      if(pts && Number(ranking.points)!==pts){ ranking.points=pts; changed=true; }
      total += Number(ranking?.points||0);
    }
    if(Number(player.points||0)!==total){ player.points=total; changed=true; }
  }
  for(const test of (db.tests||[])){
    const normalizedKit=kitAliases[String(test?.kit||"").trim().toLowerCase()] || test.kit;
    if(normalizedKit!==test.kit){ test.kit=normalizedKit; changed=true; }
    const pts=pointsForTier(test?.rank);
    if(pts && Number(test.points)!==pts){ test.points=pts; changed=true; }
  }
  return changed;
}

async function initDatabase(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS onyx_store (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS played_store (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const onyxResult = await pool.query("SELECT data FROM onyx_store WHERE id = 1");
  const playedResult = await pool.query("SELECT data FROM played_store WHERE id = 1");

  if(onyxResult.rowCount){
    dbCache = onyxResult.rows[0].data || {players:[], tests:[]};
  }else{
    const seedPath = path.join(ROOT, "onyx-db.json");
    try{
      dbCache = JSON.parse(fs.readFileSync(seedPath, "utf8"));
      if(!dbCache.players) dbCache.players=[];
      if(!dbCache.tests) dbCache.tests=[];
    }catch{
      dbCache = {players:[], tests:[]};
    }
    await writeDB(dbCache);
  }

  if(playedResult.rowCount){
    playedCache = playedResult.rows[0].data || {players:[]};
  }else{
    const seedPath = path.join(ROOT, "played-players.json");
    try{
      playedCache = JSON.parse(fs.readFileSync(seedPath, "utf8"));
      if(!playedCache.players) playedCache.players=[];
    }catch{
      playedCache = {players:[]};
    }
    await writePlayedDB(playedCache);
  }

  if(normalizeStoredTierPoints(dbCache)){
    await writeDB(dbCache);
  }

  console.log(`Persistent PostgreSQL storage ready: ${dbCache.players.length} ONYX players, ${playedCache.players.length} played players.`);
}
function getText(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{
      "User-Agent":"Mozilla/5.0 AceTierList/1.0",
      "Accept":"application/json,text/html;q=0.9,*/*;q=0.8"
    }},res=>{
      let body=""; res.setEncoding("utf8");
      res.on("data",c=>body+=c);
      res.on("end",()=>{
        if(res.statusCode>=300&&res.statusCode<400&&res.headers.location)
          return getText(new URL(res.headers.location,url).href).then(resolve,reject);
        if(res.statusCode<200||res.statusCode>=300) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(body);
      });
    });
    req.setTimeout(20000,()=>req.destroy(new Error("timeout")));
    req.on("error",reject);
  });
}
function tier(v){
  if(v==null)return null;
  if(typeof v==="string")return v;
  if(typeof v==="object")return tier(v.tier??v.rank??v.name??v.value);
  return null;
}
function normalizeMcpvp(payload){
  const out=[], seen=new Set();
  function add(raw, forced){
    if(!raw||typeof raw!=="object"||Array.isArray(raw))return;
    const name=forced||raw.name||raw.username||raw.player||raw.ign;
    if(!name)return;
    const r=raw.rankings||raw.kitRanks||raw.kits||raw.tiers||{};
    const pick=names=>{for(const n of names)if(r[n]!=null)return tier(r[n]);return null};
    const k=name.toLowerCase(); if(seen.has(k))return; seen.add(k);
    out.push({
      name:String(name),
      points:Number(raw.points??raw.totalPoints??raw.score??raw.rating??0),
      region:String(raw.region??raw.reg??"—"),
      rankings:{
        vanilla:pick(["vanilla","Vanilla"]), sword:pick(["sword","Sword"]),
        axe:pick(["axe","Axe"]), pot:pick(["pot","Pot","potion","Potion"]),
        nethop:pick(["nethop","NethOP","nethpot","NethPot"]), smp:pick(["smp","SMP"]),
        uhc:pick(["uhc","UHC"]), mace:pick(["mace","Mace"])
      }
    });
  }
  function walk(x,key){
    if(!x||typeof x!=="object")return;
    if(Array.isArray(x)){x.forEach(v=>walk(v,""));return;}
    if(x.name||x.username||x.player||x.ign)add(x);
    if(key&&/^[A-Za-z0-9_]{2,20}$/.test(key))add(x,key);
    for(const [k,v] of Object.entries(x))if(v&&typeof v==="object")walk(v,k);
  }
  walk(payload,"");
  return out;
}
async function mcpvpPlayers(){
  try{
    const raw=await getText(MCPVP_DATA);
    const p=normalizeMcpvp(JSON.parse(raw));
    if(p.length)return p;
  }catch(e){console.warn("MCPVP JSON:",e.message);}
  return [];
}

function body(req){
  return new Promise(resolve=>{
    let d="";req.on("data",c=>d+=c);req.on("end",()=>{try{resolve(d?JSON.parse(d):{})}catch{resolve({})}});
  });
}
const mime={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".svg":"image/svg+xml"};

const server = http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(FRONTEND_ORIGIN && origin===FRONTEND_ORIGIN){
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else if(!FRONTEND_ORIGIN){
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Onyx-Token");
  if(req.method === "OPTIONS"){ res.writeHead(204); return res.end(); }
  try{
    const u=new URL(req.url,`http://${req.headers.host}`);
    const db=readDB();

    // Public deployment health check. This route is intentionally available
    // before authentication so Render/Railway health checks can verify that
    // the Node process is alive. Database status is reported separately.
    if(u.pathname==="/health" && req.method==="GET"){
      return sendJSON(res,{
        ok:true,
        service:"onyx-tier-list",
        database: dbReady ? "ready" : "not_ready"
      }, dbReady ? 200 : 503);
    }

    if(u.pathname==="/api/auth/login" && req.method==="POST"){
      const x=await body(req);
      if(!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH || !SESSION_SECRET) return sendJSON(res,{error:"admin auth is not configured on this server"},503);
      if(!secureCompare(String(x.username||""),ADMIN_USERNAME) || !verifyPassword(String(x.password||""),ADMIN_PASSWORD_HASH))
        return sendJSON(res,{error:"invalid username or password"},401);
      const raw=crypto.randomBytes(32).toString("base64url");
      sessions.set(hashSession(raw),{expires:Date.now()+1000*60*60*12});
      const crossSite=!!FRONTEND_ORIGIN;
      res.setHeader("Set-Cookie",`onyx_admin=${encodeURIComponent(raw)}; HttpOnly; Path=/; Max-Age=43200; SameSite=${crossSite?"None":"Lax"}${crossSite?"; Secure":""}`);
      return sendJSON(res,{ok:true});
    }
    if(u.pathname==="/api/auth/logout" && req.method==="POST"){
      const token=parseCookies(req).onyx_admin; if(token) sessions.delete(hashSession(token));
      res.setHeader("Set-Cookie","onyx_admin=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
      return sendJSON(res,{ok:true});
    }
    if(u.pathname==="/api/auth/me" && req.method==="GET") return sendJSON(res,{authenticated:requireAdmin(req,res)});

    // Ranked PvP sync: Minecraft OnyxPvP sends {name, uuid, kit, elo, rank} after a match/admin ELO change.
    // This endpoint uses the same private ingest token as the PLAYED sync and writes to PostgreSQL-backed ONYX data.
    if(u.pathname==="/api/pvp/match" && req.method==="POST"){
      if(!adminOrIngest(req,res)) return authError(res);
      const x=await body(req);
      if(!x.name || !x.kit || x.elo==null || !x.rank) throw new Error("name, kit, elo and rank required");
      const name=String(x.name).trim();
      const uuid=String(x.uuid||"");
      const rawKit=String(x.kit).trim().toLowerCase();
      const kitMap={
        nethpot:"nethop",nethop:"nethop",
        diapot:"pot",pot:"pot",nodebuff:"pot",
        builduhc:"uhc",uhc:"uhc",
        crystal:"vanilla"
      };
      const kit=kitMap[rawKit] || rawKit;
      const elo=Number(x.elo);
      const rank=String(x.rank);

      const played=readPlayedDB();
      let playedPlayer=played.players.find(v =>
        String(v.name||"").toLowerCase()===name.toLowerCase() ||
        (uuid && String(v.uuid||"").replace(/-/g,"").toLowerCase()===uuid.replace(/-/g,"").toLowerCase())
      );
      if(!playedPlayer){
        playedPlayer={id:Date.now().toString(36),name,uuid,region:"—",firstSeenAt:new Date().toISOString(),lastSeenAt:new Date().toISOString(),joins:0};
        played.players.push(playedPlayer);
      }else{
        playedPlayer.name=name || playedPlayer.name;
        playedPlayer.uuid=uuid || playedPlayer.uuid;
        playedPlayer.lastSeenAt=new Date().toISOString();
      }
      await writePlayedDB(played);

      let p=db.players.find(v =>
        String(v.name||"").toLowerCase()===name.toLowerCase() ||
        (uuid && String(v.uuid||"").replace(/-/g,"").toLowerCase()===uuid.replace(/-/g,"").toLowerCase())
      );
      if(!p){
        p={id:playedPlayer.uuid || ("onyx_"+Date.now()),name:playedPlayer.name,uuid:playedPlayer.uuid||uuid,region:playedPlayer.region||"—",points:0,rankings:{},testedAt:new Date().toISOString()};
        db.players.push(p);
      }
      p.name=playedPlayer.name||p.name;
      p.uuid=playedPlayer.uuid||p.uuid;
      if(!p.rankings)p.rankings={};
      p.rankings[kit]={rank,points:pointsForTier(rank),tester:"OnyxPvP",date:new Date().toISOString(),notes:"Ranked PvP sync"};
      p.points=Object.values(p.rankings).reduce((sum,v)=>sum+Number(v?.points||0),0);
      if(!Array.isArray(db.tests))db.tests=[];
      db.tests.push({playerId:p.id,kit,rank,points:pointsForTier(rank),tester:"OnyxPvP",date:new Date().toISOString(),notes:"Ranked PvP sync"});
      await writeDB(db);
      return sendJSON(res,{ok:true,player:p,kit,elo,rank});
    }

    // Discord tier-test bot sync. This is intentionally server-to-server only:
    // the bot must provide ONYX_INGEST_TOKEN, which is never exposed to browsers.
    if(u.pathname==="/api/integrations/discord/result" && req.method==="POST"){
      if(!ONYX_INGEST_TOKEN || !secureCompare(req.headers["x-onyx-token"] || "",ONYX_INGEST_TOKEN))
        return sendJSON(res,{error:"invalid ONYX token"},401);
      const x=await body(req);
      if(!x.name || !x.kit || !x.rank) throw new Error("name, kit and rank required");
      const name=String(x.name).trim();
      const uuid=String(x.uuid||"").replace(/-/g,"").trim();
      const rawKit=String(x.kit).trim().toLowerCase();
      const kitAliases={nethpot:"nethop",nethop:"nethop",diapot:"pot",pot:"pot",nodebuff:"pot",builduhc:"uhc",uhc:"uhc",crystal:"vanilla"};
      const kit=kitAliases[rawKit] || rawKit;
      const rank=normalizeTier(x.rank);
      const tierPoints=pointsForTier(rank);
      if(!tierPoints) throw new Error("Invalid tier. Use LT5, HT5, LT4, HT4, LT3, HT3, LT2, HT2, LT1, or HT1.");

      // Discord test results are allowed to create/update the matching PLAYED
      // record: a player has completed an official test, so the identity is known.
      const played=readPlayedDB();
      let playedPlayer=played.players.find(v =>
        String(v.name||"").toLowerCase()===name.toLowerCase() ||
        (uuid && String(v.uuid||"").replace(/-/g,"").toLowerCase()===uuid.toLowerCase())
      );
      if(!playedPlayer){
        playedPlayer={id:uuid || ("played_"+Date.now()),name,uuid,region:String(x.region||"—"),firstSeenAt:new Date().toISOString(),lastSeenAt:new Date().toISOString(),joins:0};
        played.players.push(playedPlayer);
      }else{
        playedPlayer.name=name;
        playedPlayer.uuid=uuid || playedPlayer.uuid || "";
        playedPlayer.region=String(x.region||playedPlayer.region||"—");
        playedPlayer.lastSeenAt=new Date().toISOString();
      }

      let p=db.players.find(v =>
        String(v.name||"").toLowerCase()===name.toLowerCase() ||
        (uuid && String(v.uuid||"").replace(/-/g,"").toLowerCase()===uuid.toLowerCase())
      );
      if(!p){
        p={id:uuid || ("onyx_"+Date.now()),name,uuid,region:playedPlayer.region||"—",points:0,rankings:{},testedAt:new Date().toISOString()};
        db.players.push(p);
      }else{
        p.name=name;
        p.uuid=uuid || p.uuid || "";
        p.region=playedPlayer.region || p.region || "—";
      }
      if(!p.rankings) p.rankings={};
      p.rankings[kit]={rank,points:tierPoints,tester:String(x.tester||"Discord"),date:new Date().toISOString(),notes:"Discord tier-test sync"};
      p.points=Object.values(p.rankings).reduce((sum,v)=>sum+Number(v?.points||0),0);
      if(!Array.isArray(db.tests)) db.tests=[];
      db.tests.push({playerId:p.id,kit,rank,points:tierPoints,tester:String(x.tester||"Discord"),date:new Date().toISOString(),notes:"Discord tier-test sync",discordId:String(x.discordId||"")});
      await writePlayedDB(played);
      await writeDB(db);
      return sendJSON(res,{ok:true,player:p});
    }

    // PLAYED database: every player who has joined/played on the ONYX server.
    if(u.pathname==="/api/players/played" && req.method==="GET"){
      const played=readPlayedDB();
      await enrichSkinList(played.players);
      await writePlayedDB(played);
      res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
      return res.end(JSON.stringify(played.players));
    }

    // Mark a player as having played on the server.
    // Your Minecraft server/plugin can POST {name, uuid, region} here when a player joins.
    if(u.pathname==="/api/players/played" && req.method==="POST"){
      const adminOK=requireAdmin(req,res);
      if(!adminOK && !ONYX_INGEST_TOKEN) return authError(res);
      if(!adminOK && ONYX_INGEST_TOKEN){
        const supplied=req.headers["x-onyx-token"] || "";
        if(supplied !== ONYX_INGEST_TOKEN){
          res.writeHead(401,{"Content-Type":"application/json"});
          return res.end(JSON.stringify({error:"invalid ONYX token"}));
        }
      }
      const x=await body(req);
      if(!x.name)throw new Error("name required");
      const played=readPlayedDB();
      const incomingName=String(x.name).trim();
      const incomingUuid=String(x.uuid||"").replace(/-/g,"").toLowerCase();
      const sameIdentity=(v)=>{
        const vuuid=String(v.uuid||"").replace(/-/g,"").toLowerCase();
        return (incomingUuid && vuuid && incomingUuid===vuuid) ||
               String(v.name||"").trim().toLowerCase()===incomingName.toLowerCase();
      };
      let matches=played.players.filter(sameIdentity);
      let p=matches[0];
      if(!p){
        p={
          id:Date.now().toString(36),
          name:incomingName,
          uuid:x.uuid||"",
          region:x.region||"—",
          firstSeenAt:new Date().toISOString(),
          lastSeenAt:new Date().toISOString(),
          joins:1
        };
        played.players.push(p);
      }else{
        p.name=incomingName || p.name;
        p.uuid=x.uuid||p.uuid;
        p.region=x.region??p.region;
        p.lastSeenAt=new Date().toISOString();
        p.joins=Number(p.joins||0)+1;
        // Collapse any legacy duplicate records for this same player.
        if(matches.length>1){
          for(const dup of matches.slice(1)){
            p.joins += Number(dup.joins||0);
            if(!p.firstSeenAt || (dup.firstSeenAt && dup.firstSeenAt<p.firstSeenAt)) p.firstSeenAt=dup.firstSeenAt;
            if(!p.uuid && dup.uuid) p.uuid=dup.uuid;
            if((!p.skinUrl || !p.skinFetchedAt) && dup.skinUrl){ p.skinUrl=dup.skinUrl; p.skinFetchedAt=dup.skinFetchedAt; }
          }
          const ids=new Set(matches.slice(1).map(v=>v.id));
          played.players=played.players.filter(v=>!ids.has(v.id));
        }
      }
      await enrichSkin(p);
      await writePlayedDB(played);
      res.writeHead(200,{"Content-Type":"application/json"});
      return res.end(JSON.stringify(p));
    }

    // Tier-tested database: only players actually tested by ONYX appear in rankings.
    if(u.pathname==="/api/onyx/players" && req.method==="GET"){
      const played=readPlayedDB();
      const playedByName=new Map(played.players.map(p=>[String(p.name||"").toLowerCase(),p]));
      for(const p of db.players){
        const source=playedByName.get(String(p.name||"").toLowerCase());
        if(source){
          p.uuid=p.uuid||source.uuid||"";
          if(source.premium!==undefined) p.premium=source.premium;
          if(source.skinUrl) p.skinUrl=source.skinUrl;
          if(source.skinFetchedAt) p.skinFetchedAt=source.skinFetchedAt;
        }
      }
      await enrichSkinList(db.players);
      // Copy newly resolved skin data back into the played cache.
      for(const p of db.players){
        const source=playedByName.get(String(p.name||"").toLowerCase());
        if(source){
          source.uuid=p.uuid||source.uuid||"";
          source.premium=p.premium;
          source.skinUrl=p.skinUrl||"";
          source.skinFetchedAt=p.skinFetchedAt;
        }
      }
      await writePlayedDB(played);
      await writeDB(db);
      res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
      return res.end(JSON.stringify(db.players));
    }

    if(u.pathname==="/api/onyx/player" && req.method==="POST"){
      if(!requireAdmin(req,res)) return authError(res);
      const x=await body(req);
      if(!x.name)throw new Error("name required");

      // A tier-tested player must already exist in the PLAYED database.
      const played=readPlayedDB();
      let playedPlayer=played.players.find(v=>v.name.toLowerCase()===String(x.name).toLowerCase());
      if(!playedPlayer){
        throw new Error("Player is not in the PLAYED database. They must play on the server first.");
      }

      let p=db.players.find(v=>v.name.toLowerCase()===String(x.name).toLowerCase());
      if(!p){
        p={
          id:Date.now().toString(36),
          name:playedPlayer.name,
          uuid:playedPlayer.uuid||x.uuid||"",
          region:playedPlayer.region||x.region||"—",
          points:0,
          rankings:{},
          testedAt:new Date().toISOString()
        };
        db.players.push(p);
      } else {
        p.uuid=playedPlayer.uuid||p.uuid;
        p.region=playedPlayer.region||p.region;
      }
      await writeDB(db);
      res.writeHead(200,{"Content-Type":"application/json"});
      return res.end(JSON.stringify(p));
    }

    if(u.pathname==="/api/onyx/test" && req.method==="POST"){
      if(!requireAdmin(req,res)) return authError(res);
      const x=await body(req);
      if(!x.playerId||!x.kit||!x.rank)throw new Error("playerId, kit and rank required");
      let p=db.players.find(v=>v.id===x.playerId);
      const played=readPlayedDB();

      // Allow username/UUID as well as the internal ONYX player ID.
      if(!p && x.playerId){
        const key=String(x.playerId).trim().toLowerCase();
        const playedPlayer=played.players.find(v =>
          String(v.name||"").toLowerCase()===key ||
          String(v.uuid||"").toLowerCase()===key
        );
        if(playedPlayer){
          p={
            id: playedPlayer.uuid || ("onyx_"+Date.now()),
            name: playedPlayer.name,
            uuid: playedPlayer.uuid || "",
            region: playedPlayer.region || "",
            rankings: {}
          };
          db.players.push(p);
        }
      }

      if(!p)throw new Error("Player not found in PLAYED database. Add the player to PLAYED first.");
      const playedPlayer=played.players.find(v =>
        String(v.name||"").toLowerCase()===String(p.name||"").toLowerCase() ||
        (p.uuid && String(v.uuid||"").toLowerCase()===String(p.uuid).toLowerCase())
      );
      if(!playedPlayer)throw new Error("Player is not in the PLAYED database.");
      if(!p.rankings)p.rankings={};
      const normalizedRank=normalizeTier(x.rank);
       const normalizedKitAliases={
         nethpot:"nethop",nethop:"nethop",
         diapot:"pot",pot:"pot",nodebuff:"pot",
         builduhc:"uhc",uhc:"uhc",
         crystal:"vanilla"
       };
       const normalizedKit=normalizedKitAliases[String(x.kit).trim().toLowerCase()] || String(x.kit).trim().toLowerCase();
       const tierPoints=pointsForTier(normalizedRank);
      if(!tierPoints) throw new Error("Invalid tier. Use LT5, HT5, LT4, HT4, LT3, HT3, LT2, HT2, LT1, or HT1.");
      p.rankings[normalizedKit]={rank:normalizedRank,points:tierPoints,tester:x.tester||"ONYX",date:new Date().toISOString(),notes:x.notes||""};
      p.points=Object.values(p.rankings).reduce((s,v)=>s+Number(v.points||0),0);
      db.tests.push({playerId:p.id,kit:normalizedKit,rank:normalizedRank,points:tierPoints,tester:x.tester||"ONYX",date:new Date().toISOString(),notes:x.notes||""});
      await writeDB(db); res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify(p));
    }

    if(u.pathname==="/api/tiers/points" && req.method==="GET"){
      return sendJSON(res,TIER_POINTS);
    }

    if(u.pathname==="/api/mcpvp/players" && req.method==="GET"){
      const p=await mcpvpPlayers();
      res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
      return res.end(JSON.stringify(p));
    }

    if(u.pathname==="/api/onyx/tests" && req.method==="GET"){
      res.writeHead(200,{"Content-Type":"application/json"});return res.end(JSON.stringify(db.tests));
    }


    // ---------- ADMIN REMOVE PLAYER ----------
    if(u.pathname==="/api/admin/players" && req.method==="DELETE"){
      if(!requireAdmin(req,res)) return authError(res);
      // Admin session authentication above is sufficient for dashboard deletes.
      // Do NOT require the server-to-server ingest token here: the browser admin
      // dashboard must never receive that private token.
      const x=await body(req);
      const key=String(x.identifier||"").trim().toLowerCase();
      const database=String(x.database||"").toLowerCase();

      if(!key)throw new Error("Player name, UUID, or ONYX ID required.");
      if(!["played","onyx","both"].includes(database))throw new Error("Invalid database.");

      let removedPlayed=false, removedOnyx=false;

      if(database==="played" || database==="both"){
        const played=readPlayedDB();
        const before=played.players.length;
        played.players=played.players.filter(p =>
          String(p.name||"").toLowerCase()!==key &&
          String(p.uuid||"").toLowerCase()!==key
        );
        removedPlayed=played.players.length < before;
        if(removedPlayed)await writePlayedDB(played);
      }

      if(database==="onyx" || database==="both"){
        const tierDB=readDB();
        const matching=tierDB.players.filter(p =>
          String(p.id||"").toLowerCase()===key ||
          String(p.name||"").toLowerCase()===key ||
          String(p.uuid||"").toLowerCase()===key
        );
        if(matching.length){
          const ids=new Set(matching.map(p=>p.id));
          tierDB.players=tierDB.players.filter(p=>!ids.has(p.id));
          // Remove the associated test records as well, so deleted players
          // don't leave orphaned tier-test history.
          tierDB.tests=(tierDB.tests||[]).filter(t=>!ids.has(t.playerId));
          await writeDB(tierDB);
          removedOnyx=true;
        }
      }

      if(!removedPlayed && !removedOnyx)
        throw new Error("Player not found in the selected database.");

      return sendJSON(res,{
        ok:true,
        removedPlayed,
        removedOnyx
      });
    }

    if(u.pathname==="/admin.html" && !requireAdmin(req,res)) {
      const login=fs.readFileSync(path.join(ROOT,"admin-login.html"),"utf8");
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}); return res.end(login);
    }
    let file=u.pathname==="/"?"/index.html":u.pathname;
    file=path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
    const full=path.join(ROOT,file);
    if(!full.startsWith(ROOT)||!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);return res.end("Not found");}
    res.writeHead(200,{"Content-Type":mime[path.extname(full)]||"application/octet-stream"});
    fs.createReadStream(full).pipe(res);
  }catch(e){
    console.error(e);res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:e.message}));
  }
});

initDatabase()
  .then(()=>{
    dbReady = true;
    server.listen(PORT,()=>console.log(`Onyx Tier List running at http://localhost:${PORT}`));
  })
  .catch(err=>{
    dbReady = false;
    console.error("Failed to initialize PostgreSQL storage:", err);
    console.error("Render fix: check DATABASE_URL in the Web Service environment. "
      + "A stale/deleted Render PostgreSQL hostname causes getaddrinfo ENOTFOUND. "
      + "Copy the CURRENT database connection URL from the active PostgreSQL service.");
    // Keep the HTTP process alive so /health reports the real database state.
    // API/database routes will still fail until DATABASE_URL is corrected.
    server.listen(PORT,()=>console.log(`Onyx Tier List HTTP process running at http://localhost:${PORT}; database is NOT ready.`));
  });
