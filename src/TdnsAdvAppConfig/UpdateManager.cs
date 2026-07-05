using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public sealed record ReleaseCheckResult(string CurrentVersion, string? LatestVersion, bool UpdateAvailable, string? DownloadUrl, string? ReleaseNotesUrl, string? Error);

public sealed class UpdateManager
{
    private readonly HttpClient _http;
    private readonly string _repo;
    private readonly string _currentVersion;

    public UpdateManager(AppSettings settings, string currentVersion)
    {
        _repo = settings.GitHubRepo;
        _currentVersion = currentVersion;
        _http = new HttpClient();
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("TDNS-AdvAppConfig");
    }

    public static string CurrentRid
    {
        get
        {
            if (OperatingSystem.IsWindows())
                return "win-x64";

            return RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "linux-arm64" : "linux-x64";
        }
    }

    public async Task<ReleaseCheckResult> CheckAsync(CancellationToken ct = default)
    {
        try
        {
            using HttpResponseMessage response = await _http.GetAsync($"https://api.github.com/repos/{_repo}/releases/latest", ct);
            if (!response.IsSuccessStatusCode)
                return new ReleaseCheckResult(_currentVersion, null, false, null, null, $"GitHub API returned {(int)response.StatusCode}");

            JsonNode? release = JsonNode.Parse(await response.Content.ReadAsStringAsync(ct));
            string? tag = release?["tag_name"]?.GetValue<string>();
            if (tag is null)
                return new ReleaseCheckResult(_currentVersion, null, false, null, null, "No releases found.");

            string latestVersion = tag.TrimStart('v');
            bool updateAvailable = IsNewer(latestVersion, _currentVersion);

            string assetSuffix = $"{CurrentRid}.zip";
            string? downloadUrl = null;
            JsonArray? assets = release?["assets"]?.AsArray();
            if (assets is not null)
            {
                foreach (JsonNode? asset in assets)
                {
                    string? name = asset?["name"]?.GetValue<string>();
                    if (name is not null && name.EndsWith(assetSuffix, StringComparison.OrdinalIgnoreCase))
                    {
                        downloadUrl = asset?["browser_download_url"]?.GetValue<string>();
                        break;
                    }
                }
            }

            return new ReleaseCheckResult(_currentVersion, latestVersion, updateAvailable, downloadUrl, release?["html_url"]?.GetValue<string>(), null);
        }
        catch (Exception ex)
        {
            return new ReleaseCheckResult(_currentVersion, null, false, null, null, ex.Message);
        }
    }

    private static bool IsNewer(string latest, string current)
    {
        if (Version.TryParse(latest, out Version? l) && Version.TryParse(current, out Version? c))
            return l > c;

        return string.CompareOrdinal(latest, current) > 0;
    }
}
