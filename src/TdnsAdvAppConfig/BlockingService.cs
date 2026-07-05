using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public sealed record GroupStatus(string Name, bool EnableBlocking);
public sealed record BlockingStatus(bool RootEnableBlocking, IReadOnlyList<GroupStatus> Groups);

public sealed class BlockingService
{
    private readonly TechnitiumClient _client;

    public BlockingService(TechnitiumClient client)
    {
        _client = client;
    }

    public async Task<BlockingStatus> GetStatusAsync(CancellationToken ct = default)
    {
        JsonNode config = await _client.GetAdvancedBlockingConfigAsync(ct);
        return ParseStatus(config);
    }

    public async Task<BlockingStatus> SetGroupEnabledAsync(string groupName, bool enabled, CancellationToken ct = default)
    {
        JsonNode config = await _client.GetAdvancedBlockingConfigAsync(ct);
        JsonArray groups = config["groups"]?.AsArray() ?? throw new InvalidOperationException("Config has no 'groups' array.");

        JsonNode? target = null;
        foreach (JsonNode? group in groups)
        {
            if (string.Equals(group?["name"]?.GetValue<string>(), groupName, StringComparison.Ordinal))
            {
                target = group;
                break;
            }
        }

        if (target is null)
            throw new InvalidOperationException($"Group '{groupName}' was not found.");

        target["enableBlocking"] = JsonValue.Create(enabled);

        await _client.SetAdvancedBlockingConfigAsync(config, ct);

        return ParseStatus(config);
    }

    public async Task<BlockingStatus> SetRootEnabledAsync(bool enabled, CancellationToken ct = default)
    {
        JsonNode config = await _client.GetAdvancedBlockingConfigAsync(ct);

        config["enableBlocking"] = JsonValue.Create(enabled);

        await _client.SetAdvancedBlockingConfigAsync(config, ct);

        return ParseStatus(config);
    }

    private static BlockingStatus ParseStatus(JsonNode config)
    {
        bool rootEnabled = config["enableBlocking"]?.GetValue<bool>() ?? true;

        List<GroupStatus> groups = new();
        JsonArray? groupsArray = config["groups"]?.AsArray();
        if (groupsArray is not null)
        {
            foreach (JsonNode? group in groupsArray)
            {
                if (group is null)
                    continue;

                string name = group["name"]?.GetValue<string>() ?? "";
                bool enabled = group["enableBlocking"]?.GetValue<bool>() ?? true;
                groups.Add(new GroupStatus(name, enabled));
            }
        }

        return new BlockingStatus(rootEnabled, groups);
    }
}
