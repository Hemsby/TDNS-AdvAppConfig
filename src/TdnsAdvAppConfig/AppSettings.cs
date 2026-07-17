using System.Text.Json;

namespace TdnsAdvAppConfig;

public sealed class AppSettings
{
    public string ServerUrl { get; set; } = "";
    public string Token { get; set; } = "";
    public int ListenPort { get; set; } = 8099;
    public string GitHubRepo { get; set; } = "Hemsby/TDNS-AdvAppConfig";
    public bool IgnoreSslErrors { get; set; } = false;

    public string AdminSecret { get; set; } = "";

    public static AppSettings Load(string path)
    {
        if (!File.Exists(path))
            throw new FileNotFoundException($"Config file not found: {path}\nCopy config.example.json to config.json in the same folder and edit it.");

        AppSettings settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException("Config file is empty or invalid.");

        if (string.IsNullOrWhiteSpace(settings.ServerUrl))
            throw new InvalidDataException("Config 'serverUrl' is required.");

        if (string.IsNullOrWhiteSpace(settings.Token))
            throw new InvalidDataException("Config 'token' is required.");

        if (string.IsNullOrWhiteSpace(settings.AdminSecret))
            throw new InvalidDataException("Config 'adminSecret' is required - set a shared secret to protect this addon's own web UI.");

        return settings;
    }
}
