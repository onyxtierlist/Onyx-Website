package com.onyx.tierlist;

import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.entity.Player;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public final class OnyxPlayedSync extends JavaPlugin implements Listener {
    private HttpClient http;
    private String apiUrl;
    private String token;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        apiUrl = getConfig().getString("api-url", "https://onyx-tier-list.onrender.com/api/players/played");
        token = getConfig().getString("token", "");
        http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();

        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("ONYX PLAYED sync enabled. POSTing joins to " + apiUrl);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        String name = player.getName();
        String uuid = player.getUniqueId().toString();

        String json = "{\"name\":\"" + escape(name) + "\",\"uuid\":\"" + uuid + "\"}";
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(apiUrl))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json));

        if (token != null && !token.isBlank()) {
            builder.header("X-Onyx-Token", token);
        }

        http.sendAsync(builder.build(), HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    if (response.statusCode() >= 200 && response.statusCode() < 300) {
                        getLogger().info("Added/updated " + name + " in the ONYX PLAYED database.");
                    } else {
                        getLogger().warning("ONYX sync failed for " + name + ": HTTP " + response.statusCode() + " " + response.body());
                    }
                })
                .exceptionally(error -> {
                    getLogger().warning("Could not sync " + name + " to ONYX: " + error.getMessage());
                    return null;
                });
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
