package com.onyx.bridge;

import com.onyx.pvp.OnyxPvP;
import org.bukkit.Bukkit;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.plugin.java.JavaPlugin;
import java.lang.reflect.*;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public final class OnyxPvPBridge extends JavaPlugin implements Listener, CommandExecutor {
  private OnyxPvP onyx;
  private Field matchesField, eloField;
  private Method saveElo;
  private final Map<UUID, Snapshot> active = new HashMap<>();
  private final Set<String> sent = new HashSet<>();
  private HttpClient http;
  private String apiUrl, token;

  public void onEnable() {
    onyx = (OnyxPvP) Bukkit.getPluginManager().getPlugin("OnyxPvP");
    if (onyx == null) { getLogger().severe("OnyxPvP is required."); return; }
    try {
      matchesField = OnyxPvP.class.getDeclaredField("matches"); matchesField.setAccessible(true);
      eloField = OnyxPvP.class.getDeclaredField("elo"); eloField.setAccessible(true);
      saveElo = OnyxPvP.class.getDeclaredMethod("saveElo"); saveElo.setAccessible(true);
    } catch (Exception e) { getLogger().severe("Could not hook OnyxPvP internals: " + e); return; }
    apiUrl = getConfig().getString("api-url", "https://onyx-tier-list.onrender.com/api/pvp/match");
    token = getConfig().getString("token", "");
    http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    getServer().getPluginManager().registerEvents(this, this);
    if (getCommand("elo") != null) getCommand("elo").setExecutor(this);
    Bukkit.getScheduler().runTaskTimer(this, this::pollMatches, 1L, 1L);
    getLogger().info("OnyxPvP bridge enabled.");
  }

  @SuppressWarnings("unchecked") private Map<UUID,Object> matches() throws Exception { return (Map<UUID,Object>) matchesField.get(onyx); }
  @SuppressWarnings("unchecked") private Map<UUID,Map<String,Integer>> elo() throws Exception { return (Map<UUID,Map<String,Integer>>) eloField.get(onyx); }
  private Field mf(Class<?> c,String n)throws Exception{Field f=c.getDeclaredField(n);f.setAccessible(true);return f;}
  private Object get(Object o,String n)throws Exception{return mf(o.getClass(),n).get(o);}
  private void set(Object o,String n,Object v)throws Exception{mf(o.getClass(),n).set(o,v);}

  private void pollMatches() {
    try {
      Map<UUID,Object> m=matches();
      Set<Object> now=Collections.newSetFromMap(new IdentityHashMap<>());
      for(Object match:new ArrayList<>(m.values())) {
        if(!now.add(match)) continue;
        Player p1=(Player)get(match,"p1"), p2=(Player)get(match,"p2");
        String mode=(String)get(match,"mode");
        if(p1==null||p2==null) continue;
        int e1=getElo(p1.getUniqueId(),mode), e2=getElo(p2.getUniqueId(),mode);
        active.put(p1.getUniqueId(),new Snapshot(p1,p2,mode,e1,e2));
        active.put(p2.getUniqueId(),new Snapshot(p2,p1,mode,e2,e1));
      }
      Iterator<Map.Entry<UUID,Snapshot>> it=active.entrySet().iterator();
      while(it.hasNext()) {
        Snapshot s=it.next().getValue();
        if(!m.containsKey(s.player.getUniqueId())) {
          int after=getElo(s.player.getUniqueId(),s.mode);
          if(after!=s.beforeElo) {
            boolean victory=after>s.beforeElo;
            s.player.sendTitle(victory ? "§a§lVICTORY" : "§c§lDEFEAT", victory ? "§7+"+(after-s.beforeElo)+" ELO" : "§7"+(after-s.beforeElo)+" ELO", 10, 50, 15);
            sync(s.player,s.mode,after,tier(after));
          }
          it.remove();
        }
      }
    } catch(Exception ignored) {}
  }
  private int getElo(UUID u,String mode)throws Exception{Map<String,Integer> m=elo().get(u);return m==null?1000:m.getOrDefault(mode,1000);}
  private String tier(int e){
    try {
      String best=getConfig().getString("elo.default-tier","LT5"); int bp=Integer.MIN_VALUE;
      var sec=getConfig().getConfigurationSection("elo.tiers"); if(sec!=null) for(String k:sec.getKeys(false)){int p=sec.getInt(k);if(p<=e&&p>bp){bp=p;best=k;}}
      return best;
    }catch(Exception ex){return "LT5";}
  }
  private void sync(Player p,String mode,int elo,String tier){
    if(apiUrl==null||apiUrl.isBlank())return;
    String json="{\"name\":\""+esc(p.getName())+"\",\"uuid\":\""+p.getUniqueId()+"\",\"kit\":\""+esc(mode)+"\",\"elo\":"+elo+",\"rank\":\""+esc(tier)+"\"}";
    HttpRequest.Builder b=HttpRequest.newBuilder().uri(URI.create(apiUrl)).timeout(Duration.ofSeconds(10)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json));
    if(token!=null&&!token.isBlank())b.header("X-Onyx-Token",token);
    http.sendAsync(b.build(),HttpResponse.BodyHandlers.ofString()).thenAccept(r->{if(r.statusCode()<200||r.statusCode()>=300)getLogger().warning("Website sync failed: HTTP "+r.statusCode()+" "+r.body());});
  }
  private static String esc(String s){return s.replace("\\","\\\\").replace("\"","\\\"");}

  @EventHandler(priority=EventPriority.LOWEST)
  public void aliases(PlayerCommandPreprocessEvent e){
    String s=e.getMessage(); String[] a=s.trim().split("\\s+"); if(a.length<2)return;
    String root=a[0].toLowerCase(); if(root.equals("/queue")||root.equals("/onyxpvp")){
      int modeIndex=root.equals("/queue")?1:((a.length>2 && a[1].equalsIgnoreCase("queue"))?2:1);
      if(modeIndex>=a.length)return;
      String mode=a[modeIndex].toLowerCase();
      if(mode.equals("nethop")) a[modeIndex]="nethpot";
      if(mode.equals("pot")) a[modeIndex]="diapot";
      StringBuilder out=new StringBuilder(a[0]); for(int i=1;i<a.length;i++)out.append(' ').append(a[i]); e.setMessage(out.toString());
    }
  }

  public boolean onCommand(CommandSender s,Command c,String label,String[] a){
    if(!s.hasPermission("onyxpvp.admin")){s.sendMessage("§cNo permission.");return true;}
    if(a.length<4||!a[0].equalsIgnoreCase("set")){s.sendMessage("§e/elo set <player> <mode> <amount>");return true;}
    Player p=Bukkit.getPlayerExact(a[1]); if(p==null){s.sendMessage("§cPlayer not found.");return true;}
    int value;try{value=Integer.parseInt(a[3]);}catch(Exception ex){s.sendMessage("§cELO must be a number.");return true;}
    String mode=a[2].toLowerCase();
    try{elo().computeIfAbsent(p.getUniqueId(),k->new HashMap<>()).put(mode,value);saveElo.invoke(onyx);String t=tier(value);s.sendMessage("§aSet "+p.getName()+" "+mode+" ELO to "+value+" ("+t+").");sync(p,mode,value,t);}catch(Exception ex){s.sendMessage("§cFailed: "+ex.getMessage());}
    return true;
  }
  private static final class Snapshot{final Player player,opponent;final String mode;final int beforeElo,opponentElo;Snapshot(Player p,Player o,String m,int e,int oe){player=p;opponent=o;mode=m;beforeElo=e;opponentElo=oe;}}
}
